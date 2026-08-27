import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

import { balanceManager } from './balance.js';
import { fetchLiveBalance } from './executor.js';

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
