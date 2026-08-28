import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

import { balanceManager } from './balance.js';
import { fetchLiveBalance, executeAutomation } from './executor.js';

export function startDashboardServer(port = 3000) {
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

    if (pathname === '/') {
      const dashboardPath = path.join(process.cwd(), 'dashboard.html');
      if (fs.existsSync(dashboardPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(dashboardPath));
      } else {
        res.writeHead(404);
        res.end('Dashboard HTML not found.');
      }
    } else if (pathname === '/logs' || pathname === '/api/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logger.getLogs()));
    } else if (pathname === '/api/balance' || pathname === '/balance') {
      const current = balanceManager.getCurrentBalance();
      const history = balanceManager.getBalanceHistory();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          balance: current,
          history,
        })
      );
    } else if (pathname === '/api/balance/refresh') {
      try {
        const fresh = await fetchLiveBalance();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            balance: fresh,
            history: balanceManager.getBalanceHistory(),
          })
        );
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: err?.message || String(err),
          })
        );
      }
    } else if (pathname === '/api/switch-account' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const type = data.activeType; // 'Live' or 'Demo'
          if (type !== 'Live' && type !== 'Demo') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid account type' }));
            return;
          }
          
          // Trigger the switch logic via executor
          const result = await executeAutomation({
            action: type === 'Live' ? 'SWITCH_LIVE' : 'SWITCH_DEMO',
            ticker: '',
            rawText: `Switching to ${type} via Dashboard`,
            timestamp: new Date()
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: result.success }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
        }
      });
    } else if (pathname === '/api/settings/default-account' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const type = data.defaultType;
          
          if (type === 'Live' || type === 'Demo') {
            const settingsPath = path.join(process.cwd(), 'cortex-settings.json');
            fs.writeFileSync(settingsPath, JSON.stringify({ defaultAccount: type }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
        }
      });
    } else if (pathname === '/api/settings' && req.method === 'GET') {
      try {
        const settingsPath = path.join(process.cwd(), 'cortex-settings.json');
        let settings = { defaultAccount: 'Demo' };
        if (fs.existsSync(settingsPath)) {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(settings));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} is in use, trying port ${port + 1}...`);
      startDashboardServer(port + 1);
    } else {
      logger.error('Dashboard server error', e);
    }
  });

  server.listen(port, () => {
    logger.info('=============================================');
    logger.info('📊 Cortex Dashboard is running!');
    logger.info('👉 Open http://localhost:' + port + ' in your browser');
    logger.info('=============================================');
  });
}
