/**
 * Centralized Type Definitions for Telegram Automation System
 */

export type ActionType = 'UP' | 'DOWN' | 'CALL' | 'PUT' | 'BUY' | 'SELL' | 'PREPARE' | 'BALANCE' | 'SWITCH_LIVE' | 'SWITCH_DEMO';

export function isUpAction(action?: ActionType | string | null): boolean {
  if (!action) return false;
  const upper = String(action).toUpperCase().trim();
  return upper === 'UP' || upper === 'CALL' || upper === 'BUY' || upper === 'HIGHER' || upper === 'GREEN';
}

export function isDownAction(action?: ActionType | string | null): boolean {
  if (!action) return false;
  const upper = String(action).toUpperCase().trim();
  return upper === 'DOWN' || upper === 'PUT' || upper === 'SELL' || upper === 'LOWER' || upper === 'RED';
}


export interface AccountBalance {
  accountType: 'Live' | 'Demo' | 'Unknown';
  formattedBalance: string;
  numericValue: number;
  currency: string;
  updatedAt: string;
  source: string;
}

export interface BalanceHistoryEntry {
  timestamp: string;
  accountType: string;
  formattedBalance: string;
  numericValue: number;
  currency: string;
  change?: number | undefined;
}

export interface TradeSignal {
  action: ActionType;
  ticker: string;
  price?: number | undefined;
  durationMinutes?: number | undefined;
  stopLoss?: number | undefined;
  takeProfit?: number | undefined;
  rawText: string;
  timestamp: Date;
}

export interface AutomationTask {
  id: string;
  signal: TradeSignal;
  receivedAt: Date;
}

export interface ExecutionResult {
  success: boolean;
  signal: TradeSignal;
  durationMs: number;
  screenshotPath?: string | undefined;
  error?: string | undefined;
  details?: string | undefined;
  balance?: AccountBalance | undefined;
}

export interface AppConfig {
  apiId: number;
  apiHash: string;
  sessionString: string;
  vipChannelIdRaw: string;
  vipChannelIdBigInt: bigint;
  headless: boolean;
  browserTimeoutMs: number;
  targetUrl: string;
  screenshotsDir: string;
  chromeUserDataDir: string;
  chromeExecutablePath: string;
  chromeProfileName: string;
  autoLaunchChrome: boolean;
}
