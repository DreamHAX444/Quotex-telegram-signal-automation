import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger, logEmitter } from './logger.js';
import { balanceManager } from './balance.js';
import { fetchLiveBalance, executeAutomation } from './executor.js';
import { config, updateVipChannelId } from './config.js';
import { automationQueue } from './queue.js';
import type { ActionType, AutomationTask, TradeSignal } from './types.js';
import { systemStats } from './stats.js';
import { systemEvents } from './events.js';
import { parseSignal } from './parser.js';
import { 
  forceFetchChannelMessages, 
  pingTelegramConnection, 
  reconnectTelegramClient 
} from './bot.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const SETTINGS_PATH = path.join(process.cwd(), 'cortex-settings.json');

const DEFAULT_SETTINGS = {
  defaultAccount: 'Demo',
  availableChannels: [
    { id: '-1003922846451', name: 'Test Channel' },
    { id: '-1001771915378', name: 'Main Channel' }
  ]
};

async function loadSettings(): Promise<typeof DEFAULT_SETTINGS> {
  try {
    await fs.promises.access(SETTINGS_PATH);
    const content = await fs.promises.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(content);
    return {
      defaultAccount: (parsed.defaultAccount === 'Live' || parsed.defaultAccount === 'Demo') ? parsed.defaultAccount : DEFAULT_SETTINGS.defaultAccount,
      availableChannels: Array.isArray(parsed.availableChannels) && parsed.availableChannels.length > 0 ? parsed.availableChannels : DEFAULT_SETTINGS.availableChannels
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings: Partial<typeof DEFAULT_SETTINGS>): Promise<void> {
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  await fs.promises.writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  systemEvents.emit('settings:update', merged);
}

async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 32768) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;
  if (pathname === '/') pathname = '/index.html';

  const baseDir = path.join(process.cwd(), 'frontend', 'dist');
  let filePath = path.normalize(path.resolve(baseDir, pathname.replace(/^\/+/, '')));

  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback: serve index.html for non-asset GET requests
      const indexPath = path.join(baseDir, 'index.html');
      fs.readFile(indexPath, (indexErr, indexData) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Cortex Terminal Dashboard Not Built. Run: npm run build inside frontend/');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.parse(filePath).ext.toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (pathname.startsWith('/assets/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server File Read Error');
        return;
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

export function startDashboardServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : '*';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    const jsonResponse = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    try {
      // -------------------------------------------------------------
      // 1. UNIFIED 24/7 REAL-TIME SSE LIVE STREAM (/api/stream)
      // -------------------------------------------------------------
      if (pathname === '/api/stream' || pathname === '/api/logs/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        // Function to push typed SSE message
        const sendEvent = (eventType: string, data: unknown) => {
          res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        // 1. Send immediate full state snapshot on connection
        const settings = await loadSettings();
        const currentBalance = balanceManager.getCurrentBalance();
        const balanceHistory = balanceManager.getBalanceHistory();
        const executions = systemEvents.getExecutionHistory();
        const channelMessages = systemEvents.getChannelMessages();
        const connectionLogs = systemEvents.getConnectionLogs();
        const logs = logger.getLogs();
        const queueStats = automationQueue.getStats();

        sendEvent('init', {
          serverTime: Date.now(),
          telemetry: {
            ...systemStats,
            uptimeMs: Date.now() - systemStats.startedAt,
            queuePending: queueStats.pending,
            queueSize: queueStats.size,
            isQueuePaused: queueStats.isPaused,
          },
          balance: currentBalance,
          balanceHistory,
          activeChannel: config.vipChannelIdRaw,
          settings,
          executions,
          channelMessages,
          connectionLogs,
          logs,
        });

        // 2. Real-time event subscription handlers
        const onBalance = (payload: unknown) => sendEvent('balance', payload);
        const onTelemetry = () => {
          const q = automationQueue.getStats();
          sendEvent('telemetry', {
            ...systemStats,
            uptimeMs: Date.now() - systemStats.startedAt,
            queuePending: q.pending,
            queueSize: q.size,
            isQueuePaused: q.isPaused,
          });
        };
        const onQueue = (payload: unknown) => sendEvent('queue', payload);
        const onTaskStart = (payload: unknown) => sendEvent('task_start', payload);
        const onTaskComplete = (payload: unknown) => sendEvent('task_complete', payload);
        const onSignal = (payload: unknown) => sendEvent('signal', payload);
        const onChannel = (payload: unknown) => sendEvent('channel', payload);
        const onChannelMessage = (payload: unknown) => sendEvent('channel_message', payload);
        const onConnectionLog = (payload: unknown) => sendEvent('connection_log', payload);
        const onSettings = (payload: unknown) => sendEvent('settings', payload);
        const onLog = (payload: unknown) => {
          sendEvent('log', payload);
          res.write(`data: ${JSON.stringify({ type: 'new', log: payload })}\n\n`);
        };

        systemEvents.on('balance:update', onBalance);
        systemEvents.on('telemetry:update', onTelemetry);
        systemEvents.on('queue:update', onQueue);
        systemEvents.on('task:start', onTaskStart);
        systemEvents.on('task:complete', onTaskComplete);
        systemEvents.on('signal:received', onSignal);
        systemEvents.on('channel:switch', onChannel);
        systemEvents.on('channel:message', onChannelMessage);
        systemEvents.on('connection:log', onConnectionLog);
        systemEvents.on('settings:update', onSettings);
        logEmitter.on('log', onLog);

        // 3. Keepalive Heartbeat Ping every 5 seconds
        const keepAlivePing = setInterval(() => {
          try {
            res.write(`event: ping\ndata: ${JSON.stringify({ serverTime: Date.now() })}\n\n`);
          } catch {
            cleanupSSE();
          }
        }, 5000);

        let isCleanedUp = false;
        const cleanupSSE = () => {
          if (isCleanedUp) return;
          isCleanedUp = true;
          clearInterval(keepAlivePing);
          systemEvents.off('balance:update', onBalance);
          systemEvents.off('telemetry:update', onTelemetry);
          systemEvents.off('queue:update', onQueue);
          systemEvents.off('task:start', onTaskStart);
          systemEvents.off('task:complete', onTaskComplete);
          systemEvents.off('signal:received', onSignal);
          systemEvents.off('channel:switch', onChannel);
          systemEvents.off('channel:message', onChannelMessage);
          systemEvents.off('connection:log', onConnectionLog);
          systemEvents.off('settings:update', onSettings);
          logEmitter.off('log', onLog);
        };

        req.on('close', cleanupSSE);
        req.on('error', cleanupSSE);
        res.on('close', cleanupSSE);
        res.on('finish', cleanupSSE);
        res.on('error', cleanupSSE);
        return;
      }

      // -------------------------------------------------------------
      // 2. REST API ENDPOINTS
      // -------------------------------------------------------------
      if (pathname === '/api/channel/messages/fetch' && req.method === 'POST') {
        const messages = await forceFetchChannelMessages(30);
        jsonResponse(200, { success: true, messages });
      } else if (pathname === '/api/connection/ping' && req.method === 'POST') {
        const pingRes = await pingTelegramConnection();
        jsonResponse(200, pingRes);
      } else if (pathname === '/api/connection/reconnect' && req.method === 'POST') {
        const ok = await reconnectTelegramClient();
        jsonResponse(200, { success: ok });
      } else if (pathname === '/api/balance/refresh') {
        const fresh = await fetchLiveBalance();
        jsonResponse(200, {
          success: true,
          balance: fresh,
          history: balanceManager.getBalanceHistory(),
        });
      } else if (pathname === '/api/settings/default-account' && req.method === 'POST') {
        const data = (await parseJsonBody(req)) as { defaultType?: string };
        const type = data.defaultType;
        if (type === 'Live' || type === 'Demo') {
          await saveSettings({ defaultAccount: type });
          return jsonResponse(200, { success: true, defaultAccount: type });
        }
        jsonResponse(400, { success: false, error: 'Invalid default account type' });
      } else if (pathname === '/api/settings/channels' && req.method === 'POST') {
        const data = (await parseJsonBody(req)) as { channels?: { id: string; name: string }[] };
        if (Array.isArray(data.channels)) {
          await saveSettings({ availableChannels: data.channels });
          return jsonResponse(200, { success: true, availableChannels: data.channels });
        }
        jsonResponse(400, { success: false, error: 'Channels must be an array of { id, name } objects' });
      } else if (pathname === '/api/channel/switch' && req.method === 'POST') {
        const data = (await parseJsonBody(req)) as { channel?: string };
        if (!data.channel || typeof data.channel !== 'string') {
          return jsonResponse(400, { success: false, error: 'Missing channel ID' });
        }
        if (!/^-?\d{5,20}$/.test(data.channel.trim())) {
          return jsonResponse(400, { success: false, error: 'Invalid channel ID format. Must be numeric.' });
        }
        await updateVipChannelId(data.channel);
        systemEvents.emit('channel:switch', { currentChannel: config.vipChannelIdRaw });
        jsonResponse(200, { success: true, newChannel: config.vipChannelIdRaw });
      } else if (pathname === '/api/signal/test' && req.method === 'POST') {
        const data = (await parseJsonBody(req)) as { rawText?: string; action?: string; ticker?: string; duration?: number };
        let signal: TradeSignal | null = null;
        if (data.rawText) {
          signal = parseSignal(data.rawText);
        } else if (data.action) {
          signal = {
            action: data.action.toUpperCase() as ActionType,
            ticker: data.ticker || 'EURUSD',
            durationMinutes: data.duration || 1,
            rawText: `MANUAL TEST: ${data.action} ${data.ticker || 'EURUSD'}`,
            timestamp: new Date()
          };
        }

        if (!signal) {
          return jsonResponse(400, { success: false, error: 'Could not parse signal or invalid parameters' });
        }

        const task: AutomationTask = {
          id: 'manual-' + randomUUID(),
          signal,
          receivedAt: new Date()
        };

        systemEvents.emit('signal:received', {
          taskId: task.id,
          signal,
          senderName: 'Manual Dashboard Test',
          timestamp: new Date().toISOString()
        });

        automationQueue.enqueue(task, executeAutomation).then((result) => {
          systemEvents.recordExecution({
            id: task.id,
            timestamp: new Date().toISOString(),
            signal: task.signal,
            durationMs: result.durationMs,
            success: result.success,
            error: result.error,
            screenshotPath: result.screenshotPath,
            balance: result.balance,
          });
        });

        jsonResponse(200, { success: true, taskId: task.id, signal });
      } else if (pathname === '/api/queue/clear' && req.method === 'POST') {
        automationQueue.clear();
        jsonResponse(200, { success: true, queue: automationQueue.getStats() });
      } else if (pathname === '/api/queue/pause' && req.method === 'POST') {
        const stats = automationQueue.getStats();
        if (stats.isPaused) {
          automationQueue.resume();
        } else {
          automationQueue.pause();
        }
        jsonResponse(200, { success: true, queue: automationQueue.getStats() });
      } else {
        serveStatic(req, res);
      }
    } catch (err: unknown) {
      jsonResponse(500, { success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      if (port > 3020) return logger.error('Too many ports in use');
      logger.warn(`Port ${port} is in use, trying port ${port + 1}...`);
      server.close();
      startDashboardServer(port + 1);
    } else {
      logger.error('Dashboard server error', e);
    }
  });

  server.listen(port, () => {
    logger.info('=============================================');
    logger.info('🤖 Cortex 24/7 Live Stream Server is running!');
    logger.info('🚀 Terminal UI: http://localhost:' + port);
    logger.info('=============================================');
  });
}
