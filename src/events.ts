import { EventEmitter } from 'node:events';
import type { AccountBalance, TradeSignal } from './types.js';

interface ExecutedTradeRecord {
  id: string;
  timestamp: string;
  signal: TradeSignal;
  durationMs: number;
  success: boolean;
  error?: string | undefined;
  screenshotPath?: string | undefined;
  balance?: AccountBalance | undefined;
}

export interface ChannelMessageRecord {
  id: string;
  messageId: number;
  channelId: string;
  date: string;
  senderName: string;
  text: string;
  isSignal: boolean;
  signal?: TradeSignal | undefined;
}

interface ConnectionLogRecord {
  id: string;
  timestamp: string;
  type: 'CONNECT' | 'DISCONNECT' | 'PING' | 'RECONNECT' | 'RESOLVE' | 'ERROR' | 'INFO';
  message: string;
  details?: string | undefined;
  latencyMs?: number | undefined;
}

class SystemEventBus extends EventEmitter {
  private executionHistory: ExecutedTradeRecord[] = [];
  private channelMessages: ChannelMessageRecord[] = [];
  private connectionLogs: ConnectionLogRecord[] = [];

  private readonly maxHistoryLength = 50;
  private readonly maxMessagesLength = 150;
  private readonly maxLogsLength = 150;

  constructor() {
    super();
    this.setMaxListeners(0); // Unlimited SSE listeners
  }

  public recordExecution(record: ExecutedTradeRecord): void {
    this.executionHistory.unshift(record);
    if (this.executionHistory.length > this.maxHistoryLength) {
      this.executionHistory.pop();
    }
    this.emit('task:complete', record);
  }

  public getExecutionHistory(): ExecutedTradeRecord[] {
    return [...this.executionHistory];
  }

  public recordChannelMessage(msg: ChannelMessageRecord): void {
    // Avoid duplicate message IDs for the same channel
    const existingIndex = this.channelMessages.findIndex(
      m => m.messageId === msg.messageId && m.channelId === msg.channelId
    );
    if (existingIndex >= 0) {
      this.channelMessages[existingIndex] = msg;
    } else {
      this.channelMessages.unshift(msg);
      if (this.channelMessages.length > this.maxMessagesLength) {
        this.channelMessages.pop();
      }
    }
    this.emit('channel:message', msg);
  }

  public getChannelMessages(): ChannelMessageRecord[] {
    return [...this.channelMessages];
  }

  public clearChannelMessages(): void {
    this.channelMessages = [];
  }

  public recordConnectionLog(log: ConnectionLogRecord): void {
    this.connectionLogs.unshift(log);
    if (this.connectionLogs.length > this.maxLogsLength) {
      this.connectionLogs.pop();
    }
    this.emit('connection:log', log);
  }

  public getConnectionLogs(): ConnectionLogRecord[] {
    return [...this.connectionLogs];
  }
}

export const systemEvents = new SystemEventBus();
