// Centralized API calls for Cortex Dashboard

export interface BalanceResponse {
  success: boolean;
  balance: {
    accountType: string;
    formattedBalance: string;
    numericValue: number;
    timestamp: string;
  } | null;
  history?: unknown[];
  error?: string;
}

export interface SettingsResponse {
  defaultAccount: string;
  availableChannels?: { id: string; name: string; }[];
  success?: boolean;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: unknown;
}

// In development, Vite will proxy /api to the backend. In production, it's served from the same host.
const API_BASE = ''; 

async function fetchApi(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  return res.json();
}

export const api = {
  async fetchBalance(): Promise<BalanceResponse> {
    return fetchApi(`${API_BASE}/api/balance`);
  },

  async refreshBalance(): Promise<BalanceResponse> {
    return fetchApi(`${API_BASE}/api/balance/refresh`);
  },

  async fetchLogs(): Promise<LogEntry[]> {
    return fetchApi(`${API_BASE}/logs`);
  },

  async fetchSettings(): Promise<SettingsResponse> {
    return fetchApi(`${API_BASE}/api/settings`);
  },

  async setStartupDefault(type: 'Live' | 'Demo'): Promise<boolean> {
    const data = await fetchApi(`${API_BASE}/api/settings/default-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultType: type })
    });
    return !!data.success;
  },

  async setActiveAccount(type: 'Live' | 'Demo'): Promise<boolean> {
    const data = await fetchApi(`${API_BASE}/api/switch-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeType: type })
    });
    return !!data.success;
  },

  async fetchActiveChannel(): Promise<string | null> {
    const data = await fetchApi(`${API_BASE}/api/channel`);
    return data.currentChannel || null;
  },

  async setActiveChannel(channelId: string): Promise<boolean> {
    const data = await fetchApi(`${API_BASE}/api/channel/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId })
    });
    return !!data.success;
  }
};
