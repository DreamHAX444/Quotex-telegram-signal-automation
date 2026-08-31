interface SystemStatsType {
  status: string;
  lastCheckedAt: number;
  lastPingAt: number;
  lastMessageAt: number;
  messagesProcessed: number;
  messagesIgnored: number;
  startedAt: number;
  accountUsername?: string | undefined;
  accountId?: string | undefined;
  channelTitle?: string | undefined;
  channelType?: string | undefined;
  channelMembers?: number | undefined;
}

export const systemStats: SystemStatsType = {
  status: 'offline',
  lastCheckedAt: 0,
  lastPingAt: 0,
  lastMessageAt: 0,
  messagesProcessed: 0,
  messagesIgnored: 0,
  startedAt: Date.now(),
};
