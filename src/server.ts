import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

import { balanceManager } from './balance.js';
import { fetchLiveBalance, executeAutomation } from './executor.js';
import { config, updateVipChannelId } from './config.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { 
      body += chunk.toString(); 
      if (body.length > 10240) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.svg': 'image/svg+xml'
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;
  if (pathname === '/') pathname = '/index.html';
  
  const ext = path.parse(pathname).ext;
  const filePath = path.join(process.cwd(), 'frontend', 'dist', pathname);
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
}

export function startDashboardServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    const jsonResponse = (status: number, data: any) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    try {
      if (pathname === '/logs' || pathname === '/api/logs') {
        jsonResponse(200, logger.getLogs());
      } else if (pathname === '/api/balance' || pathname === '/balance') {
        jsonResponse(200, {
          success: true,
          balance: balanceManager.getCurrentBalance(),
          history: balanceManager.getBalanceHistory(),
        });
      } else if (pathname === '/api/balance/refresh') {
        const fresh = await fetchLiveBalance();
        jsonResponse(200, {
          success: true,
          balance: fresh,
          history: balanceManager.getBalanceHistory(),
        });
      } else if (pathname === '/api/switch-account' && req.method === 'POST') {
        const data = await parseJsonBody(req);
        const type = data.activeType;
        if (type !== 'Live' && type !== 'Demo') {
          return jsonResponse(400, { success: false, error: 'Invalid account type' });
        }
        
        const result = await executeAutomation({
          action: type === 'Live' ? 'SWITCH_LIVE' : 'SWITCH_DEMO',
          ticker: '',
          rawText: `Switching to ${type} via Dashboard`,
          timestamp: new Date()
        });
        jsonResponse(200, { success: result.success });
      } else if (pathname === '/api/settings/default-account' && req.method === 'POST') {
        const data = await parseJsonBody(req);
        const type = data.defaultType;
        if (type === 'Live' || type === 'Demo') {
          const settingsPath = path.join(process.cwd(), 'cortex-settings.json');
          fs.writeFileSync(settingsPath, JSON.stringify({ defaultAccount: type }) + '\n');
        }
        jsonResponse(200, { success: true });
      } else if (pathname === '/api/channel' && req.method === 'GET') {
        jsonResponse(200, { currentChannel: config.vipChannelIdRaw });
      } else if (pathname === '/api/channel/switch' && req.method === 'POST') {
        const data = await parseJsonBody(req);
        if (!data.channel) {
          return jsonResponse(400, { success: false, error: 'Missing channel ID' });
        }
        updateVipChannelId(data.channel);
        jsonResponse(200, { success: true, newChannel: config.vipChannelIdRaw });
      } else if (pathname === '/api/settings' && req.method === 'GET') {
        const settingsPath = path.join(process.cwd(), 'cortex-settings.json');
        let settings = { defaultAccount: 'Demo' };
        if (fs.existsSync(settingsPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (parsed.defaultAccount === 'Live' || parsed.defaultAccount === 'Demo') {
              settings.defaultAccount = parsed.defaultAccount;
            }
          } catch {}
        }
        jsonResponse(200, settings);
      } else {
        serveStatic(req, res);
      }
    } catch (err: any) {
      jsonResponse(500, { success: false, error: err?.message || String(err) });
    }
  });

  server.on('error', (e: any) => {
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
    logger.info('🤖 Cortex Dashboard is running!');
    logger.info('🚀 Open http://localhost:' + port + ' in your browser');
    logger.info('=============================================');
  });
}
