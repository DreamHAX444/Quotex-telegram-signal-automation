/**
 * Simple Developer-Friendly Logger
 */
import { EventEmitter } from 'node:events';

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(0); // Multiple SSE clients may subscribe simultaneously

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'QUEUE' | 'BROWSER' | 'TELEGRAM';

// Basic ANSI colors for terminal
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  
  INFO: '\x1b[36m',     // Cyan
  WARN: '\x1b[33m',     // Yellow
  ERROR: '\x1b[31m',    // Red
  DEBUG: '\x1b[90m',    // Gray
  QUEUE: '\x1b[35m',    // Magenta
  BROWSER: '\x1b[34m',  // Blue
  TELEGRAM: '\x1b[32m'  // Green
};

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: unknown;
}

const logHistory: LogEntry[] = [];

function log(level: LogLevel, message: string, meta?: unknown): void {
  // Simple HH:MM:SS timestamp (better for devs than full date)
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  
  const color = colors[level] || colors.reset;
  const prefix = `${colors.dim}[${timestamp}]${colors.reset} ${color}${level.padEnd(8)}${colors.reset}`;

  let formattedMeta: unknown = meta;
  
  // Route to proper stdout/stderr
  const logFn = level === 'ERROR' ? console.error : 
                level === 'WARN' ? console.warn : 
                level === 'DEBUG' ? console.debug : console.log;

  if (meta !== undefined) {
    if (meta instanceof Error) {
      formattedMeta = meta.stack || meta.message;
      logFn(`${prefix} ${message}\n${colors.dim}${formattedMeta}${colors.reset}`);
    } else {
      logFn(`${prefix} ${message}`, meta);
    }
  } else {
    logFn(`${prefix} ${message}`);
  }

  // Save clean (uncolored) entry for frontend dashboard
  const entry = { timestamp, level, message, meta: formattedMeta };
  logHistory.push(entry);
  if (logHistory.length > 500) {
    logHistory.shift();
  }
  logEmitter.emit('log', entry);
}

export const logger = {
  info: (msg: string, meta?: unknown) => log('INFO', msg, meta),
  warn: (msg: string, meta?: unknown) => log('WARN', msg, meta),
  error: (msg: string, meta?: unknown) => log('ERROR', msg, meta),
  debug: (msg: string, meta?: unknown) => log('DEBUG', msg, meta),
  queue: (msg: string, meta?: unknown) => log('QUEUE', msg, meta),
  browser: (msg: string, meta?: unknown) => log('BROWSER', msg, meta),
  telegram: (msg: string, meta?: unknown) => log('TELEGRAM', msg, meta),
  getLogs: () => logHistory,
};
