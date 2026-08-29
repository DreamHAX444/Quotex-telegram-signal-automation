/**
 * Structured Timestamped Logger
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'QUEUE' | 'BROWSER' | 'TELEGRAM';

const formatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  fractionalSecondDigits: 3, hour12: false
});

function formatTimestamp(): string {
  return formatter.format(new Date()).replace(', ', ' ');
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: unknown;
}

const logHistory: LogEntry[] = [];

function log(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level.padEnd(8)}]`;
  
  let formattedMeta: any = meta;
  if (meta !== undefined) {
    if (meta instanceof Error) {
      console.log(`${prefix} ${message} - ${meta.stack || meta.message}`);
      formattedMeta = meta.stack || meta.message;
    } else {
      console.log(`${prefix} ${message}`, JSON.stringify(meta, null, 2));
    }
  } else {
    console.log(`${prefix} ${message}`);
  }

  logHistory.push({ timestamp, level, message, meta: formattedMeta });
  if (logHistory.length > 500) {
    logHistory.shift();
  }
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
