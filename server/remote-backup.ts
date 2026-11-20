import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const BAILEYS_AUTH_DIR = path.join(DATA_DIR, 'baileys_auth');
const ROOT_FILES_TO_SYNC = ['crm_store.json', 'secrets.enc', '.vault.key'];
const DEBOUNCE_MS = 4000;
const REQUEST_TIMEOUT_MS = 15000;

interface BackupConfig {
  url: string;
  token: string;
}

function cleanEnvValue(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (
    lower === 'later' ||
    lower === 'none' ||
    lower === 'skip' ||
    lower === 'na' ||
    lower === 'n/a' ||
    lower === 'null' ||
    lower === 'undefined' ||
    lower.startsWith('change_me') ||
    lower.startsWith('my_')
  ) {
    return '';
  }
  return trimmed;
}

function getBackupConfig(): BackupConfig | null {
  const url = cleanEnvValue(process.env.BACKUP_SYNC_URL);
  const token = cleanEnvValue(process.env.BACKUP_SYNC_TOKEN);
  if (!url || !token) return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }
  return { url, token };
}

function isSafeRelativeDataPath(relPath: string): boolean {
  if (!relPath || relPath.length > 260) return false;
  if (path.isAbsolute(relPath)) return false;
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return false;
  }
  return true;
}

function shouldSkipFilename(name: string): boolean {
  return (
    name === '.DS_Store' ||
    name.endsWith('.tmp') ||
    name.endsWith('.lock') ||
    name.endsWith('.swp')
  );
}

function collectFilesRecursive(
  dirPath: string,
  basePrefix: string,
  out: Record<string, string>
): void {
  if (!fs.existsSync(dirPath)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (shouldSkipFilename(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = basePrefix ? `${basePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectFilesRecursive(fullPath, relPath, out);
    } else if (entry.isFile()) {
      try {
        const buf = fs.readFileSync(fullPath);
        out[relPath] = buf.toString('base64');
      } catch {
        // skip transient unreadable file
      }
    }
  }
}

function collectDataDirSnapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  if (!fs.existsSync(DATA_DIR)) return files;

  for (const filename of ROOT_FILES_TO_SYNC) {
    const fullPath = path.join(DATA_DIR, filename);
    if (fs.existsSync(fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          files[filename] = fs.readFileSync(fullPath).toString('base64');
        }
      } catch {
        // skip
      }
    }
  }

  collectFilesRecursive(BAILEYS_AUTH_DIR, 'baileys_auth', files);
  return files;
}

let debounceTimer: NodeJS.Timeout | null = null;
let inFlightPromise: Promise<boolean> | null = null;
let pendingAfterFlight = false;
let latestReason = 'auto';
let remoteEndpointUnavailableUntil = 0;

function parseJsonSafely(rawText: string): { ok: true; data: unknown } | { ok: false; isHtml: boolean } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, isHtml: false };
  }
  if (trimmed.startsWith('<')) {
    return { ok: false, isHtml: true };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch {
    return { ok: false, isHtml: false };
  }
}

async function performRemoteUpload(reason: string): Promise<boolean> {
  const cfg = getBackupConfig();
  if (!cfg) return false;

  // Avoid hammering an endpoint that isn't uploaded yet (unless flushing on shutdown)
  if (!reason.startsWith('shutdown') && Date.now() < remoteEndpointUnavailableUntil) {
    return false;
  }

  const files = collectDataDirSnapshot();
  const fileCount = Object.keys(files).length;
  if (fileCount === 0) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'X-Backup-Token': cfg.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'BGB-WhatsApp-CRM-Backup/1.0',
      },
      body: JSON.stringify({
        files,
        updatedAt: new Date().toISOString(),
        reason,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const rawText = await res.text().catch(() => '');
    const parsed = parseJsonSafely(rawText);

    if (!res.ok) {
      if (res.status === 404 || parsed.ok === false) {
        remoteEndpointUnavailableUntil = Date.now() + 60_000;
      }
      console.log(
        `[RemoteBackup] Upload skipped (HTTP ${res.status}, reason: ${reason}). Continuing with local ./data/.`
      );
      return false;
    }

    if (!parsed.ok) {
      remoteEndpointUnavailableUntil = Date.now() + 60_000;
      console.log(
        `[RemoteBackup] Remote endpoint returned ${parsed.isHtml ? 'HTML' : 'non-JSON'} instead of vault JSON (verify crm_vault.php is uploaded at BACKUP_SYNC_URL). Continuing locally.`
      );
      return false;
    }

    const payload = parsed.data as { ok?: boolean } | null;
    if (payload && payload.ok === false) {
      console.log(`[RemoteBackup] Remote vault rejected upload (reason: ${reason}).`);
      return false;
    }

    remoteEndpointUnavailableUntil = 0;
    console.log(
      `[RemoteBackup] Synced ${fileCount} files to remote vault (reason: ${reason}).`
    );
    return true;
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    remoteEndpointUnavailableUntil = Date.now() + 30_000;
    console.log(`[RemoteBackup] Upload deferred (reason: ${reason}): ${msg}`);
    return false;
  }
}

async function runUploadLoop(): Promise<boolean> {
  if (inFlightPromise) {
    pendingAfterFlight = true;
    return inFlightPromise;
  }

  const run = async (): Promise<boolean> => {
    let lastOk = false;
    do {
      pendingAfterFlight = false;
      const reason = latestReason;
      lastOk = await performRemoteUpload(reason);
    } while (pendingAfterFlight);
    return lastOk;
  };

  inFlightPromise = run().finally(() => {
    inFlightPromise = null;
  });

  return inFlightPromise;
}

export function isRemoteBackupConfigured(): boolean {
  return getBackupConfig() !== null;
}

export async function restoreDataDirFromRemote(): Promise<{
  restored: boolean;
  fileCount: number;
}> {
  const cfg = getBackupConfig();
  if (!cfg) {
    return { restored: false, fileCount: 0 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    console.log('[RemoteBackup] Checking remote vault for persisted ./data/ snapshot...');
    const res = await fetch(cfg.url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'X-Backup-Token': cfg.token,
        Accept: 'application/json',
        'User-Agent': 'BGB-WhatsApp-CRM-Backup/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 404) {
      console.log('[RemoteBackup] No remote snapshot found yet (404). Starting with local ./data/.');
      return { restored: false, fileCount: 0 };
    }

    const rawText = await res.text().catch(() => '');

    if (!res.ok) {
      console.log(
        `[RemoteBackup] Restore skipped (HTTP ${res.status}). Continuing with local ./data/.`
      );
      return { restored: false, fileCount: 0 };
    }

    const parsed = parseJsonSafely(rawText);
    if (!parsed.ok) {
      // Shared PHP hosts often return an HTML page (e.g. <!doctype html>) if crm_vault.php
      // has not been uploaded yet or a soft-404 rewrite caught the URL.
      remoteEndpointUnavailableUntil = Date.now() + 60_000;
      console.log(
        `[RemoteBackup] Remote endpoint returned ${parsed.isHtml ? 'HTML' : 'non-JSON'} instead of vault JSON (crm_vault.php may not be uploaded yet). Continuing cleanly with local ./data/.`
      );
      return { restored: false, fileCount: 0 };
    }

    const json = parsed.data as {
      files?: Record<string, unknown>;
      updatedAt?: string;
    };

    if (!json || typeof json !== 'object' || !json.files || typeof json.files !== 'object') {
      console.log('[RemoteBackup] Remote snapshot is empty. Starting fresh.');
      return { restored: false, fileCount: 0 };
    }

    const entries = Object.entries(json.files);
    if (entries.length === 0) {
      console.log('[RemoteBackup] Remote snapshot has 0 files. Starting fresh.');
      return { restored: false, fileCount: 0 };
    }

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(BAILEYS_AUTH_DIR)) {
      fs.mkdirSync(BAILEYS_AUTH_DIR, { recursive: true });
    }

    const resolvedDataRoot = path.resolve(DATA_DIR);
    let written = 0;

    for (const [relPath, rawBase64] of entries) {
      if (typeof rawBase64 !== 'string' || !isSafeRelativeDataPath(relPath)) {
        continue;
      }
      const targetPath = path.resolve(DATA_DIR, relPath);
      if (!targetPath.startsWith(resolvedDataRoot + path.sep)) {
        continue;
      }

      try {
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        const buf = Buffer.from(rawBase64, 'base64');
        const tmpPath = `${targetPath}.restore.tmp`;
        const sensitive = relPath === '.vault.key' || relPath === 'secrets.enc';
        fs.writeFileSync(tmpPath, buf, sensitive ? { mode: 0o600 } : undefined);
        fs.renameSync(tmpPath, targetPath);
        written += 1;
      } catch (fileErr) {
        console.log(
          `[RemoteBackup] Skipped writing restored file ${relPath}:`,
          fileErr instanceof Error ? fileErr.message : fileErr
        );
      }
    }

    remoteEndpointUnavailableUntil = 0;
    console.log(
      `[RemoteBackup] Restored ${written} files into ./data/${json.updatedAt ? ` (snapshot: ${json.updatedAt})` : ''}.`
    );
    return { restored: written > 0, fileCount: written };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[RemoteBackup] Restore skipped (continuing with local ./data/): ${msg}`);
    return { restored: false, fileCount: 0 };
  }
}

export function scheduleRemoteBackup(reason = 'auto'): void {
  if (!getBackupConfig()) return;
  latestReason = reason;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runUploadLoop();
  }, DEBOUNCE_MS);
}

export async function flushRemoteBackupNow(reason = 'flush'): Promise<boolean> {
  if (!getBackupConfig()) return false;
  latestReason = reason;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (inFlightPromise) {
    pendingAfterFlight = true;
    await inFlightPromise;
    return true;
  }

  return runUploadLoop();
}
