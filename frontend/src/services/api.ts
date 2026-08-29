// Centralized API calls for Cortex Dashboard

export interface BalanceResponse {
  success: boolean;
  balance: {
    accountType: string;
    formattedBalance: string;
    numericValue: number;
    timestamp: string;
  } | null;
  history?: any[];
  error?: string;
}

export interface SettingsResponse {
  defaultAccount: string;
  success?: boolean;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: any;
}

// In development, Vite will proxy /api to the backend. In production, it's served from the same host.
const API_BASE = ''; 

export const api = {
  async fetchBalance(): Promise<BalanceResponse> {
    const res = await fetch(`${API_BASE}/api/balance`);
    return res.json();
  },

  async refreshBalance(): Promise<BalanceResponse> {
    const res = await fetch(`${API_BASE}/api/balance/refresh`);
    return res.json();
  },

  async fetchLogs(): Promise<LogEntry[]> {
    const res = await fetch(`${API_BASE}/logs`);
    return res.json();
  },

  async fetchSettings(): Promise<SettingsResponse> {
    const res = await fetch(`${API_BASE}/api/settings`);
    return res.json();
  },

  async setStartupDefault(type: 'Live' | 'Demo'): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/settings/default-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultType: type })
    });
    const data = await res.json();
    return !!data.success;
  },

  async setActiveAccount(type: 'Live' | 'Demo'): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/switch-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeType: type })
    });
    const data = await res.json();
    return !!data.success;
  },

  async fetchActiveChannel(): Promise<string | null> {
    const res = await fetch(`${API_BASE}/api/channel`);
    const data = await res.json();
    return data.currentChannel || null;
  },

  async setActiveChannel(channelId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/channel/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId })
    });
    const data = await res.json();
    return !!data.success;
  }
};
