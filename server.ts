import http from 'http';
import { parse } from 'url';
import express from 'express';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { syncStoreAndDetectTransitions } from './server/ecommerce';
import { messageRouter } from './server/message-router';
import { flushRemoteBackupNow, restoreDataDirFromRemote } from './server/remote-backup';
import { createApiRouter } from './server/routes';
import { storage } from './server/storage';
import { baileysManager } from './server/whatsapp-baileys';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const bindHost = '0.0.0.0';

// Guard persistent 24x7 process against transient Baileys/network errors resetting sockets
process.on('unhandledRejection', (reason) => {
  console.error('[BGB WhatsApp CRM] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[BGB WhatsApp CRM] Uncaught exception:', err);
});

async function bootstrap() {
  // Restore persisted ./data/ (CRM store, vault key, Baileys WhatsApp auth) from remote backup before booting
  try {
    const restoreResult = await restoreDataDirFromRemote();
    if (restoreResult.restored) {
      storage.reloadFromDisk();
    }
  } catch (err) {
    console.warn('[BGB WhatsApp CRM] Remote backup restore skipped:', err);
  }

  const nextApp = next({ dev, hostname: 'localhost', port });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  const app = express();
  app.disable('x-powered-by');

  const httpServer = http.createServer(app);
  // Prevent connection resets during initial Next.js dev compilation or long-lived proxy keep-alive
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 120_000;

  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: true,
      credentials: true,
    },
  });

  messageRouter.attachSocketServer(io);

  io.on('connection', (socket) => {
    // Emit authoritative server state immediately upon client socket connect
    socket.emit('wa:status', baileysManager.getSnapshot());
  });

  // Mount REST API routes under /api
  app.use('/api', createApiRouter());

  // Next.js App Router fallback (Express 5 regex wildcard with parsedUrl)
  app.all(/.*/, async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '/', true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('[Next.js Handler Error]', err);
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      }
    }
  });

  httpServer.listen(port, bindHost, () => {
    console.log(
      `[BGB WhatsApp CRM] Ready on http://${bindHost}:${port} (${dev ? 'dev' : 'prod'})`
    );

    // Defer startup background tasks briefly so initial pre-warm GET / completes immediately
    setTimeout(() => {
      if (baileysManager.hasSavedCredentials()) {
        console.log(
          '[BGB WhatsApp CRM] Found saved WhatsApp session on disk — auto-reconnecting...'
        );
        baileysManager.connect().catch(() => {});
      }

      syncStoreAndDetectTransitions(async (order) => {
        await messageRouter.sendOrderStageNotification(order);
      })
        .then((summary) => {
          console.log(
            `[BGB Sync] Initial sync completed: ${summary.productsCount} products, ${summary.ordersCount} orders`
          );
        })
        .catch(() => {});
    }, 3000);

    // Scheduled background sync for live product uploads/updates, orders & delivery stage WhatsApp alerts (every 60s)
    const runScheduledSync = () => {
      const configuredMins = storage.getStore().settings.store.syncIntervalMinutes || 1;
      const intervalMs = Math.max(60_000, Math.min(configuredMins, 2) * 60 * 1000);
      setTimeout(async () => {
        try {
          const prevProductCount = storage.getStore().productsCache.length;
          const summary = await syncStoreAndDetectTransitions(async (order) => {
            await messageRouter.sendOrderStageNotification(order);
          });
          if (summary.transitions.length > 0 || summary.productsCount !== prevProductCount) {
            messageRouter.emit('ecommerce:synced', {
              ...summary,
              lastSyncAt: storage.getStore().lastSyncAt,
            });
          }
        } catch {
          // keep timer resilient
        }
        runScheduledSync();
      }, intervalMs);
    };
    runScheduledSync();
  });

  // Graceful shutdown for Render restarts/deploys: persist store & flush remote vault before exiting
  let shuttingDown = false;
  const handleGracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[BGB WhatsApp CRM] Received ${signal} — flushing data & remote backup...`);

    const forceExitTimer = setTimeout(() => {
      console.warn('[BGB WhatsApp CRM] Graceful shutdown timed out; forcing exit.');
      process.exit(0);
    }, 12_000);
    forceExitTimer.unref();

    try {
      storage.persistNow();
    } catch (err) {
      console.error('[BGB WhatsApp CRM] Error persisting store on shutdown:', err);
    }

    try {
      await flushRemoteBackupNow(`shutdown:${signal}`);
    } catch (err) {
      console.error('[BGB WhatsApp CRM] Error flushing remote backup on shutdown:', err);
    }

    try {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    } catch {
      // ignore close errors
    }

    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void handleGracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void handleGracefulShutdown('SIGINT');
  });
}

bootstrap().catch((err) => {
  console.error('[BGB WhatsApp CRM] Fatal startup error:', err);
  process.exit(1);
});
