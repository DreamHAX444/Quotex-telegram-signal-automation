/**
 * 24/7 Resilient Real-Time SSE Live Stream Manager
 * Zero-reload architecture with automatic exponential backoff reconnection,
 * latency calculation, channel message streaming, and connection event logging.
 */

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
  accountType: 'Live' | 'Demo' | 'Unknown';
  formattedBalance: string;
  numericValue: number;
  currency: string;
  change?: number;
}

export interface TradeSignal {
  action: string;
  ticker: string;
  price?: number;
  durationMinutes?: number;
  stopLoss?: number;
  takeProfit?: number;
  rawText: string;
  timestamp: string | Date;
}

export interface ExecutedTradeRecord {
  id: string;
  timestamp: string;
  signal: TradeSignal;
  durationMs: number;
  success: boolean;
  error?: string;
  screenshotPath?: string;
  balance?: AccountBalance;
}

export interface ChannelMessageItem {
  id: string;
  messageId: number;
  channelId: string;
  date: string;
  senderName: string;
  text: string;
  isSignal: boolean;
  signal?: TradeSignal;
}

export interface ConnectionLogEntry {
  id: string;
  timestamp: string;
  type: 'CONNECT' | 'DISCONNECT' | 'PING' | 'RECONNECT' | 'RESOLVE' | 'ERROR' | 'INFO';
  message: string;
  details?: string;
  latencyMs?: number;
}

export interface SystemTelemetryState {
  status: string;
  lastCheckedAt: number;
  lastPingAt: number;
  lastMessageAt: number;
  messagesProcessed: number;
  messagesIgnored: number;
  startedAt: number;
  uptimeMs?: number;
  queuePending: number;
  queueSize: number;
  isQueuePaused: boolean;
  accountUsername?: string;
  accountId?: string;
  channelTitle?: string;
  channelType?: string;
  channelMembers?: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: unknown;
}

export interface ChannelPreset {
  id: string;
  name: string;
}

export interface DashboardSettings {
  defaultAccount: 'Live' | 'Demo';
  availableChannels: ChannelPreset[];
}

export interface LiveStateSnapshot {
  connectionState: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  latencyMs: number;
  lastHeartbeat: number;
  balance: AccountBalance | null;
  balanceHistory: BalanceHistoryEntry[];
  telemetry: SystemTelemetryState | null;
  activeChannel: string | null;
  settings: DashboardSettings;
  executions: ExecutedTradeRecord[];
  channelMessages: ChannelMessageItem[];
  connectionLogs: ConnectionLogEntry[];
  logs: LogEntry[];
  reconnectAttempts: number;
}

type Listener = (state: LiveStateSnapshot) => void;

class LiveStreamManager {
  private eventSource: EventSource | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimeout: any = null;
  private reconnectAttempts = 0;

  private state: LiveStateSnapshot = {
    connectionState: 'disconnected',
    latencyMs: 0,
    lastHeartbeat: Date.now(),
    balance: null,
    balanceHistory: [],
    telemetry: null,
    activeChannel: null,
    settings: {
      defaultAccount: 'Demo',
      availableChannels: [
        { id: '-1003922846451', name: 'Test Channel' },
        { id: '-1001771915378', name: 'Main Channel' }
      ]
    },
    executions: [],
    channelMessages: [],
    connectionLogs: [],
    logs: [],
    reconnectAttempts: 0,
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.reconnect(true);
      });
      window.addEventListener('offline', () => {
        this.updateState({ connectionState: 'disconnected' });
      });
    }
  }

  public getState(): LiveStateSnapshot {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    if (!this.eventSource && this.state.connectionState !== 'connecting') {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('Error in live stream listener', err);
      }
    }
  }

  private updateState(partial: Partial<LiveStateSnapshot>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  public connect() {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.updateState({
      connectionState: this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
      reconnectAttempts: this.reconnectAttempts,
    });

    try {
      const es = new EventSource('/api/stream');
      this.eventSource = es;

      es.onopen = () => {
        this.reconnectAttempts = 0;
        this.updateState({
          connectionState: 'connected',
          reconnectAttempts: 0,
          lastHeartbeat: Date.now(),
        });
      };

      es.addEventListener('init', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const serverTime = data.serverTime || Date.now();
          const latency = Math.max(0, Date.now() - serverTime);

          this.updateState({
            connectionState: 'connected',
            latencyMs: latency,
            lastHeartbeat: Date.now(),
            balance: data.balance || this.state.balance,
            balanceHistory: data.balanceHistory || this.state.balanceHistory,
            telemetry: data.telemetry || this.state.telemetry,
            activeChannel: data.activeChannel || this.state.activeChannel,
            settings: data.settings || this.state.settings,
            executions: data.executions || this.state.executions,
            channelMessages: data.channelMessages || this.state.channelMessages,
            connectionLogs: data.connectionLogs || this.state.connectionLogs,
            logs: data.logs || this.state.logs,
          });
        } catch (err) {
          console.error('Error parsing init SSE event', err);
        }
      });

      es.addEventListener('balance', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.updateState({
            balance: data.balance,
            balanceHistory: data.history || (data.balance ? [data.balance, ...this.state.balanceHistory.slice(0, 49)] : this.state.balanceHistory),
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing balance SSE event', err);
        }
      });

      es.addEventListener('telemetry', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.updateState({
            telemetry: data,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing telemetry SSE event', err);
        }
      });

      es.addEventListener('queue', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (this.state.telemetry) {
            this.updateState({
              telemetry: {
                ...this.state.telemetry,
                queuePending: data.pending,
                queueSize: data.size,
                isQueuePaused: data.isPaused,
              },
              lastHeartbeat: Date.now(),
            });
          }
        } catch (err) {
          console.error('Error parsing queue SSE event', err);
        }
      });

      es.addEventListener('task_complete', (e: MessageEvent) => {
        try {
          const record: ExecutedTradeRecord = JSON.parse(e.data);
          const updatedExecutions = [record, ...this.state.executions.filter(x => x.id !== record.id)].slice(0, 50);
          this.updateState({
            executions: updatedExecutions,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing task_complete SSE event', err);
        }
      });

      es.addEventListener('channel_message', (e: MessageEvent) => {
        try {
          const msg: ChannelMessageItem = JSON.parse(e.data);
          const existingIdx = this.state.channelMessages.findIndex(m => m.messageId === msg.messageId && m.channelId === msg.channelId);
          let updatedList: ChannelMessageItem[];
          if (existingIdx >= 0) {
            updatedList = [...this.state.channelMessages];
            updatedList[existingIdx] = msg;
          } else {
            updatedList = [msg, ...this.state.channelMessages].slice(0, 150);
          }
          this.updateState({
            channelMessages: updatedList,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing channel_message SSE event', err);
        }
      });

      es.addEventListener('connection_log', (e: MessageEvent) => {
        try {
          const logItem: ConnectionLogEntry = JSON.parse(e.data);
          const updatedLogs = [logItem, ...this.state.connectionLogs].slice(0, 150);
          this.updateState({
            connectionLogs: updatedLogs,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing connection_log SSE event', err);
        }
      });

      es.addEventListener('channel', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.updateState({
            activeChannel: data.currentChannel,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing channel SSE event', err);
        }
      });

      es.addEventListener('settings', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.updateState({
            settings: data,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing settings SSE event', err);
        }
      });

      es.addEventListener('log', (e: MessageEvent) => {
        try {
          const logEntry: LogEntry = JSON.parse(e.data);
          const updatedLogs = [...this.state.logs, logEntry];
          if (updatedLogs.length > 500) updatedLogs.shift();
          this.updateState({
            logs: updatedLogs,
            lastHeartbeat: Date.now(),
          });
        } catch (err) {
          console.error('Error parsing log SSE event', err);
        }
      });

      es.addEventListener('ping', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const serverTime = data.serverTime || Date.now();
          const latency = Math.max(0, Date.now() - serverTime);
          this.updateState({
            latencyMs: latency,
            lastHeartbeat: Date.now(),
          });
        } catch {}
      });

      es.onerror = () => {
        if (this.eventSource) {
          try {
            this.eventSource.close();
          } catch {}
          this.eventSource = null;
        }
        this.reconnect();
      };
    } catch (err) {
      console.error('Failed to create EventSource', err);
      this.reconnect();
    }
  }

  private reconnect(immediate = false) {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.reconnectAttempts++;
    const delay = immediate ? 0 : Math.min(1000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 8)), 10000);

    this.updateState({
      connectionState: 'reconnecting',
      reconnectAttempts: this.reconnectAttempts,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public clearLogs() {
    this.updateState({ logs: [] });
  }

  public clearConnectionLogs() {
    this.updateState({ connectionLogs: [] });
  }

  public clearChannelMessages() {
    this.updateState({ channelMessages: [] });
  }

  // Optimistic UI updates
  public setOptimisticBalance(balance: AccountBalance) {
    this.updateState({ balance });
  }

  public setOptimisticAccount(type: 'Live' | 'Demo') {
    if (this.state.balance) {
      this.updateState({
        balance: {
          ...this.state.balance,
          accountType: type,
        }
      });
    }
  }

  public setOptimisticChannel(channelId: string) {
    this.updateState({ activeChannel: channelId });
  }

  public setChannelMessages(messages: ChannelMessageItem[]) {
    this.updateState({ channelMessages: messages });
  }
}

export const liveStream = new LiveStreamManager();
