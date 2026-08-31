// Centralized API calls for Cortex Dashboard
import type { 
  AccountBalance, 
  BalanceHistoryEntry, 
  ChannelMessageItem,
  TradeSignal 
} from './liveStream';

export interface BalanceResponse {
  success: boolean;
  balance: AccountBalance | null;
  history?: BalanceHistoryEntry[];
  error?: string;
}

export interface TestSignalRequest {
  rawText?: string;
  action?: string;
  ticker?: string;
  duration?: number;
}

export interface TestSignalResponse {
  success: boolean;
  taskId?: string;
  signal?: TradeSignal;
  error?: string;
}

export interface GenericResponse {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

const API_BASE = '';

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let errorMsg = `HTTP error! status: ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.error) {
        errorMsg = errJson.error;
      }
    } catch {}
    throw new Error(errorMsg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async refreshBalance(): Promise<BalanceResponse> {
    return fetchApi<BalanceResponse>(`${API_BASE}/api/balance/refresh`, { method: 'POST' });
  },

  async saveChannels(channels: { id: string; name: string }[]): Promise<GenericResponse> {
    return fetchApi<GenericResponse>(`${API_BASE}/api/settings/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels })
    });
  },

  async setStartupDefault(type: 'Live' | 'Demo'): Promise<boolean> {
    const data = await fetchApi<GenericResponse>(`${API_BASE}/api/settings/default-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultType: type })
    });
    return !!data.success;
  },


  async setActiveChannel(channelId: string): Promise<boolean> {
    const data = await fetchApi<GenericResponse>(`${API_BASE}/api/channel/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId })
    });
    return !!data.success;
  },

  async sendTestSignal(payload: TestSignalRequest): Promise<TestSignalResponse> {
    return fetchApi<TestSignalResponse>(`${API_BASE}/api/signal/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },


  async forceFetchChannelMessages(): Promise<{ success: boolean; messages: ChannelMessageItem[] }> {
    return fetchApi<{ success: boolean; messages: ChannelMessageItem[] }>(`${API_BASE}/api/channel/messages/fetch`, {
      method: 'POST'
    });
  },


  async pingTelegramConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    return fetchApi<{ success: boolean; latencyMs: number; error?: string }>(`${API_BASE}/api/connection/ping`, {
      method: 'POST'
    });
  },

  async reconnectTelegram(): Promise<{ success: boolean }> {
    return fetchApi<{ success: boolean }>(`${API_BASE}/api/connection/reconnect`, {
      method: 'POST'
    });
  },

  async clearQueue(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>(`${API_BASE}/api/queue/clear`, { method: 'POST' });
  },

  async togglePauseQueue(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>(`${API_BASE}/api/queue/pause`, { method: 'POST' });
  }
};
