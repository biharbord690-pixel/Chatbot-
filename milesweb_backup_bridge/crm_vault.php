<?php
/**
 * Bihar Gramin Bazaar — Remote Vault Backup Bridge for Render Free Tier
 *
 * Upload this file to: public_html/api/crm_vault.php on MilesWeb
 * Endpoint URL:        https://bihargraminbazaar.com/api/crm_vault.php
 *
 * IMPORTANT:
 * Replace $SECRET_TOKEN below with a strong 48+ character random token
 * and set the EXACT same value in Render's BACKUP_SYNC_TOKEN environment variable.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// 1. Configure your secret Bearer token (or set CRM_VAULT_TOKEN in PHP/cPanel env)
$SECRET_TOKEN = getenv('CRM_VAULT_TOKEN') ?: 'REPLACE_WITH_A_STRONG_64_CHAR_SECRET_TOKEN_BEFORE_UPLOAD';

// 2. Read Authorization Bearer (or X-Backup-Token fallback) reliably across Apache/LiteSpeed/CGI/MilesWeb setups
function getBearerToken(): string {
    $authHeader = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = (string) $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $authHeader = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            foreach ($headers as $key => $val) {
                if (strtolower((string) $key) === 'authorization') {
                    $authHeader = (string) $val;
                    break;
                }
            }
        }
    }

    if (preg_match('/^\s*Bearer\s+(.+?)\s*$/i', $authHeader, $matches)) {
        return $matches[1];
    }

    // Fallback for shared Apache hosts that strip Authorization header
    if (!empty($_SERVER['HTTP_X_BACKUP_TOKEN'])) {
        return trim((string) $_SERVER['HTTP_X_BACKUP_TOKEN']);
    }
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            foreach ($headers as $key => $val) {
                if (strtolower((string) $key) === 'x-backup-token') {
                    return trim((string) $val);
                }
            }
        }
    }
    return '';
}

function sendJson(int $statusCode, array $payload): void {
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if (
    $SECRET_TOKEN === '' ||
    strpos($SECRET_TOKEN, 'REPLACE_WITH_') === 0 ||
    strlen($SECRET_TOKEN) < 16
) {
    sendJson(500, [
        'ok' => false,
        'error' => 'Vault token not configured. Set a strong $SECRET_TOKEN in crm_vault.php.',
    ]);
}

$providedToken = getBearerToken();
if ($providedToken === '' || !hash_equals($SECRET_TOKEN, $providedToken)) {
    sendJson(401, [
        'ok' => false,
        'error' => 'Unauthorized',
    ]);
}

// 3. Prepare hidden, web-blocked vault directory (.ht_protected_vault/)
$vaultDir = __DIR__ . '/.ht_protected_vault';
$snapshotFile = $vaultDir . '/snapshot.json';

if (!is_dir($vaultDir)) {
    if (!mkdir($vaultDir, 0750, true) && !is_dir($vaultDir)) {
        sendJson(500, [
            'ok' => false,
            'error' => 'Failed to create protected vault directory.',
        ]);
    }
}

$htaccessPath = $vaultDir . '/.htaccess';
if (!file_exists($htaccessPath)) {
    $htaccessRules = <<<'HTACCESS'
# Block all direct browser access to CRM & WhatsApp session backups
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
Options -Indexes
HTACCESS;
    @file_put_contents($htaccessPath, $htaccessRules . "\n", LOCK_EX);
}

$indexGuardPath = $vaultDir . '/index.php';
if (!file_exists($indexGuardPath)) {
    @file_put_contents($indexGuardPath, "<?php http_response_code(403); exit;\n", LOCK_EX);
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// 4. GET — Return saved JSON snapshot (or empty { files: {} } if none yet)
if ($method === 'GET') {
    if (!file_exists($snapshotFile)) {
        sendJson(200, [
            'ok' => true,
            'files' => new stdClass(),
            'updatedAt' => null,
        ]);
    }

    $raw = @file_get_contents($snapshotFile);
    if ($raw === false || trim($raw) === '') {
        sendJson(200, [
            'ok' => true,
            'files' => new stdClass(),
            'updatedAt' => null,
        ]);
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['files']) || !is_array($decoded['files'])) {
        sendJson(200, [
            'ok' => true,
            'files' => new stdClass(),
            'updatedAt' => null,
        ]);
    }

    http_response_code(200);
    echo $raw;
    exit;
}

// 5. POST — Validate JSON snapshot and atomically write snapshot.json
if ($method === 'POST') {
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || trim($rawBody) === '') {
        sendJson(400, [
            'ok' => false,
            'error' => 'Empty request body.',
        ]);
    }

    // Safety cap: 25 MB max snapshot
    if (strlen($rawBody) > 25 * 1024 * 1024) {
        sendJson(413, [
            'ok' => false,
            'error' => 'Snapshot payload exceeds 25 MB limit.',
        ]);
    }

    $decoded = json_decode($rawBody, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
        sendJson(400, [
            'ok' => false,
            'error' => 'Invalid JSON payload.',
        ]);
    }

    if (!isset($decoded['files']) || !is_array($decoded['files'])) {
        sendJson(400, [
            'ok' => false,
            'error' => 'Missing or invalid "files" object.',
        ]);
    }

    $sanitizedFiles = [];
    foreach ($decoded['files'] as $relPath => $b64Value) {
        if (!is_string($relPath) || !is_string($b64Value)) {
            continue;
        }
        $cleanPath = str_replace('\\', '/', $relPath);
        if (
            $cleanPath === '' ||
            $cleanPath[0] === '/' ||
            strpos($cleanPath, '..') !== false
        ) {
            continue;
        }
        $sanitizedFiles[$cleanPath] = $b64Value;
    }

    $snapshotPayload = [
        'ok' => true,
        'files' => empty($sanitizedFiles) ? new stdClass() : $sanitizedFiles,
        'updatedAt' => isset($decoded['updatedAt']) && is_string($decoded['updatedAt'])
            ? $decoded['updatedAt']
            : gmdate('c'),
        'fileCount' => count($sanitizedFiles),
    ];

    $encoded = json_encode($snapshotPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        sendJson(500, [
            'ok' => false,
            'error' => 'Failed to encode snapshot JSON.',
        ]);
    }

    $tmpFile = $vaultDir . '/snapshot.' . bin2hex(random_bytes(6)) . '.tmp';
    $written = @file_put_contents($tmpFile, $encoded, LOCK_EX);
    if ($written === false) {
        @unlink($tmpFile);
        sendJson(500, [
            'ok' => false,
            'error' => 'Failed to write temporary snapshot file.',
        ]);
    }

    @chmod($tmpFile, 0640);
    if (!@rename($tmpFile, $snapshotFile)) {
        @unlink($tmpFile);
        sendJson(500, [
            'ok' => false,
            'error' => 'Failed to atomically commit snapshot.json.',
        ]);
    }

    sendJson(200, [
        'ok' => true,
        'fileCount' => count($sanitizedFiles),
        'bytes' => $written,
        'updatedAt' => $snapshotPayload['updatedAt'],
    ]);
}

sendJson(405, [
    'ok' => false,
    'error' => 'Method not allowed. Use GET or POST.',
]);
