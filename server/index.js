import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createLeaderboardService } from './leaderboard.js';
import { createMonitorService } from './monitor.js';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

export function createApp(
  monitorService,
  leaderboardService = createLeaderboardService()
) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/status', (_req, res) => {
    res.json(monitorService.getState());
  });

  app.get('/api/live', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    res.write(`data: ${JSON.stringify(monitorService.getState())}\n\n`);

    const unsubscribe = typeof monitorService.subscribe === 'function'
      ? monitorService.subscribe((state) => {
          try {
            res.write(`data: ${JSON.stringify(state)}\n\n`);
          } catch {}
        })
      : () => {};

    _req.on('close', () => {
      unsubscribe();
    });
  });

  app.post('/api/refresh', async (_req, res) => {
    const state = await monitorService.refreshNow();
    res.json(state);
  });

  app.post('/api/telemetry/push', async (req, res) => {
    try {
      const { distanceCm, reportedStatus, gps, sourceLabel } = req.body || {};
      if (distanceCm === undefined || distanceCm === null) {
        return res.status(400).json({ error: 'Parameter distanceCm wajib diisi.' });
      }
      if (typeof monitorService.pushDirectReading === 'function') {
        const state = await monitorService.pushDirectReading({ distanceCm, reportedStatus, gps, sourceLabel });
        return res.json({ ok: true, state });
      }
      res.status(501).json({ error: 'Direct push tidak didukung service.' });
    } catch (err) {
      res.status(500).json({ error: err?.message || 'Gagal memproses telemetry langsung.' });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      const state = await monitorService.updateConfig(req.body || {});
      res.json(state);
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Gagal memperbarui konfigurasi.' });
    }
  });

  app.post('/api/telegram/test', async (_req, res) => {
    const result = await monitorService.sendTestTelegram();
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json(leaderboardService.getSnapshot());
  });

  app.post('/api/leaderboard', (req, res) => {
    try {
      const result = leaderboardService.addEntry(req.body || {});
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Data leaderboard tidak valid.' });
    }
  });

  app.delete('/api/leaderboard', (_req, res) => {
    res.json(leaderboardService.resetEntries());
  });

  if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  return app;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const PORT = Number.parseInt(process.env.PORT || '3001', 10);
  const monitor = createMonitorService();
  const app = createApp(monitor);

  monitor.refreshNow().catch(() => {});
  monitor.startPollingLoop();

  app.listen(PORT, () => {
    console.log(`IoT Flood Monitor API aktif di http://localhost:${PORT}`);
  });
}

