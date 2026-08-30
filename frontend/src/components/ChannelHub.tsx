import { useState, useMemo } from 'react';
import { 
  Radio, 
  MessageSquare, 
  Activity, 
  RefreshCw, 
  Copy, 
  Check, 
  Search, 
  Wifi, 
  Zap, 
  ShieldCheck, 
  ArrowUpRight, 
  ArrowDownRight,
  SlidersHorizontal,
  Server
} from 'lucide-react';
import type { 
  ChannelMessageItem, 
  ConnectionLogEntry, 
  SystemTelemetryState, 
  ChannelPreset 
} from '../services/liveStream';
import { api } from '../services/api';

interface ChannelHubProps {
  activeChannel: string | null;
  availableChannels: ChannelPreset[];
  telemetry: SystemTelemetryState | null;
  channelMessages: ChannelMessageItem[];
  connectionLogs: ConnectionLogEntry[];
  onOpenTestModalWithText?: (text: string) => void;
  onOpenChannelManager: () => void;
  onChannelChange: (id: string) => void;
}

export function ChannelHub({
  activeChannel,
  availableChannels,
  telemetry,
  channelMessages,
  connectionLogs,
  onOpenTestModalWithText,
  onOpenChannelManager,
}: ChannelHubProps) {
  const [msgFilter, setMsgFilter] = useState<'all' | 'signals' | 'chat'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logFilter, setLogFilter] = useState<'ALL' | 'PING' | 'CONNECT' | 'RESOLVE' | 'ERROR'>('ALL');
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [pingResult, setPingResult] = useState<{ latencyMs: number; time: string } | null>(null);

  const activePreset = availableChannels.find(c => c.id === activeChannel);
  const activeTitle = telemetry?.channelTitle || activePreset?.name || 'Active VIP Channel';
  const isConnected = telemetry?.status === 'Connected';

  // Filter messages
  const filteredMessages = useMemo(() => {
    return channelMessages.filter((msg) => {
      const matchesFilter =
        msgFilter === 'all'
          ? true
          : msgFilter === 'signals'
          ? msg.isSignal
          : !msg.isSignal;

      const matchesSearch =
        !searchQuery ||
        msg.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        msg.senderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        msg.messageId.toString().includes(searchQuery);

      return matchesFilter && matchesSearch;
    });
  }, [channelMessages, msgFilter, searchQuery]);

  // Filter connection logs
  const filteredLogs = useMemo(() => {
    return connectionLogs.filter((log) => {
      if (logFilter === 'ALL') return true;
      if (logFilter === 'ERROR') return log.type === 'ERROR';
      return log.type === logFilter;
    });
  }, [connectionLogs, logFilter]);

  const handleCopyMessage = (msg: ChannelMessageItem) => {
    navigator.clipboard.writeText(msg.text);
    setCopiedMsgId(msg.messageId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const handleForceFetchMessages = async () => {
    setIsFetchingMessages(true);
    try {
      await api.forceFetchChannelMessages();
    } catch (err) {
      console.error('Failed to force fetch channel messages', err);
    } finally {
      setIsFetchingMessages(false);
    }
  };

  const handleManualPing = async () => {
    setIsPinging(true);
    try {
      const res = await api.pingTelegramConnection();
      if (res.success) {
        setPingResult({ latencyMs: res.latencyMs, time: new Date().toLocaleTimeString() });
      }
    } catch (err) {
      console.error('Failed to ping MTProto', err);
    } finally {
      setIsPinging(false);
    }
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await api.reconnectTelegram();
    } catch (err) {
      console.error('Failed to reconnect', err);
    } finally {
      setIsReconnecting(false);
    }
  };

  const getSignalBadge = (action: string) => {
    const act = action.toUpperCase();
    if (['UP', 'CALL', 'BUY', 'HIGHER'].includes(act)) {
      return {
        bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        icon: <ArrowUpRight className="w-3.5 h-3.5" />,
        label: act,
      };
    }
    if (['DOWN', 'PUT', 'SELL', 'LOWER'].includes(act)) {
      return {
        bg: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        icon: <ArrowDownRight className="w-3.5 h-3.5" />,
        label: act,
      };
    }
    return {
      bg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
      icon: <Zap className="w-3.5 h-3.5" />,
      label: act,
    };
  };

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Top Banner & Control Center */}
      <div className="flex-none bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
        {/* Left: Active Channel Info */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold text-zinc-100 tracking-wide font-mono">
                {activeTitle}
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 font-semibold">
                ID: {activeChannel || 'Unconfigured'}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  isConnected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {isConnected ? '● SOCKET CONNECTED' : '○ CONNECTING'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono">
              {telemetry?.channelType || 'Telegram VIP Broadcast'} • {channelMessages.length} Messages in Live Buffer
            </p>
          </div>
        </div>

        {/* Right: Quick Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Pull Latest Messages */}
          <button
            onClick={handleForceFetchMessages}
            disabled={isFetchingMessages}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded-xl border border-zinc-700 text-xs font-mono transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetchingMessages ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Pull Latest Posts</span>
          </button>

          {/* Manual Ping */}
          <button
            onClick={handleManualPing}
            disabled={isPinging}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded-xl border border-zinc-700 text-xs font-mono transition-all active:scale-95 disabled:opacity-50"
          >
            <Activity className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin text-cyan-400' : 'text-cyan-400'}`} />
            <span>Ping Socket</span>
            {pingResult && <span className="text-emerald-400 font-semibold">({pingResult.latencyMs}ms)</span>}
          </button>

          {/* Force Reconnect */}
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded-xl border border-zinc-700 text-xs font-mono transition-all active:scale-95 disabled:opacity-50"
          >
            <Wifi className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin text-amber-400' : 'text-amber-400'}`} />
            <span>Reconnect</span>
          </button>

          {/* Channel Manager */}
          <button
            onClick={onOpenChannelManager}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-mono font-semibold transition-all active:scale-95"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Switch Channel</span>
          </button>
        </div>
      </div>

      {/* Main Split Grid Layout */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ======================================================== */}
        {/* LEFT / MAIN COLUMN: REAL-TIME CHANNEL MESSAGES FEED */}
        {/* ======================================================== */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col h-full overflow-hidden">
          {/* Messages Header & Filters */}
          <div className="flex-none flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-emerald-400">
                <MessageSquare className="w-4 h-4" />
              </div>
              <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-200 font-mono">
                Channel Posts Stream
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-400">
                {filteredMessages.length} Posts
              </span>
            </div>

            {/* Filter Buttons & Search */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center p-0.5 bg-zinc-900 rounded-lg border border-zinc-800">
                <button
                  onClick={() => setMsgFilter('all')}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                    msgFilter === 'all'
                      ? 'bg-zinc-800 text-emerald-400 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  ALL
                </button>
                <button
                  onClick={() => setMsgFilter('signals')}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                    msgFilter === 'signals'
                      ? 'bg-zinc-800 text-emerald-400 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  SIGNALS ONLY
                </button>
                <button
                  onClick={() => setMsgFilter('chat')}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                    msgFilter === 'chat'
                      ? 'bg-zinc-800 text-emerald-400 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  CHAT / OTHER
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter posts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none w-28 sm:w-36"
                />
              </div>
            </div>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto space-y-3 pt-3 pr-1 custom-scrollbar">
            {filteredMessages.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-zinc-500 space-y-2">
                <MessageSquare className="w-8 h-8 opacity-40 animate-pulse" />
                <p className="text-xs font-mono">No messages match the current filter.</p>
                <button
                  onClick={handleForceFetchMessages}
                  className="px-3 py-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg border border-zinc-700 transition-colors"
                >
                  Pull From Telegram Now
                </button>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                const timeStr = new Date(msg.date).toLocaleTimeString();
                const isCopied = copiedMsgId === msg.messageId;

                return (
                  <div
                    key={msg.id || msg.messageId}
                    className={`p-4 rounded-xl border transition-all space-y-2.5 ${
                      msg.isSignal
                        ? 'bg-emerald-950/15 border-emerald-500/30 hover:border-emerald-500/50 shadow-sm'
                        : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {/* Header: Sender, ID, Time */}
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-zinc-200">{msg.senderName}</span>
                        <span className="text-zinc-500 text-[10px]">#{msg.messageId}</span>
                        {msg.isSignal && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            SIGNAL DETECTED
                          </span>
                        )}
                      </div>
                      <span className="text-zinc-500 text-[11px]">{timeStr}</span>
                    </div>

                    {/* Parsed Signal Breakdown (if signal) */}
                    {msg.isSignal && msg.signal && (
                      <div className="p-2.5 bg-zinc-950/80 border border-emerald-500/20 rounded-lg flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                              getSignalBadge(msg.signal.action).bg
                            }`}
                          >
                            {getSignalBadge(msg.signal.action).icon}
                            <span>{msg.signal.action}</span>
                          </div>
                          <span className="font-mono font-bold text-zinc-100 text-xs uppercase">
                            {msg.signal.ticker || 'SYS_ACTION'}
                          </span>
                          {msg.signal.durationMinutes && (
                            <span className="text-[10px] font-mono text-zinc-400">
                              ({msg.signal.durationMinutes}m)
                            </span>
                          )}
                        </div>
                        {msg.signal.price && (
                          <span className="text-[11px] font-mono text-zinc-300">
                            Entry: {msg.signal.price}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Message Body */}
                    <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed font-normal bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/60">
                      {msg.text}
                    </pre>

                    {/* Message Action Footer */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => handleCopyMessage(msg)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg border border-zinc-800 text-[10px] font-mono transition-colors"
                      >
                        {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>

                      {onOpenTestModalWithText && (
                        <button
                          onClick={() => onOpenTestModalWithText(msg.text)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30 text-[10px] font-mono transition-colors font-semibold"
                        >
                          <Zap className="w-3 h-3" />
                          <span>Simulate Signal</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* RIGHT COLUMN: CONNECTION DIAGNOSTICS & TELEGRAM LOGS */}
        {/* ======================================================== */}
        <div className="lg:col-span-5 flex flex-col gap-4 overflow-hidden h-full">
          {/* Connection Architecture & Health Card */}
          <div className="flex-none bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-cyan-400">
                  <Server className="w-4 h-4" />
                </div>
                <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-200 font-mono">
                  MTProto Connection Diagnostic
                </h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                  isConnected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {isConnected ? 'ONLINE' : 'CONNECTING'}
              </span>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
              <div className="p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl space-y-0.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Telegram User</span>
                <span className="text-xs font-bold text-zinc-200 truncate block">
                  {telemetry?.accountUsername || 'UserBot Active'}
                </span>
                <span className="text-[9px] text-zinc-500 block">ID: {telemetry?.accountId || 'Cached'}</span>
              </div>

              <div className="p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl space-y-0.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Keep-Alive Ping</span>
                <span className="text-xs font-bold text-emerald-400 block">
                  {telemetry?.lastPingAt ? 'Active (45s cycle)' : 'Initializing'}
                </span>
                <span className="text-[9px] text-zinc-500 block">Cycle: 45s keep-alive</span>
              </div>

              <div className="p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl space-y-0.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Total Processed</span>
                <span className="text-xs font-bold text-emerald-400 block">
                  {telemetry?.messagesProcessed || 0} msgs
                </span>
                <span className="text-[9px] text-zinc-500 block">VIP Signals Pulled</span>
              </div>

              <div className="p-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl space-y-0.5">
                <span className="text-[10px] text-zinc-500 uppercase block">Total Ignored</span>
                <span className="text-xs font-bold text-zinc-400 block">
                  {telemetry?.messagesIgnored || 0} msgs
                </span>
                <span className="text-[9px] text-zinc-500 block">Filtered Non-Target</span>
              </div>
            </div>
          </div>

          {/* Connection Event Logs Console */}
          <div className="flex-1 min-h-0 bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col overflow-hidden">
            <div className="flex-none flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-emerald-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <h3 className="text-xs uppercase tracking-wider font-bold text-zinc-200 font-mono">
                  Connection Audit Log
                </h3>
              </div>

              {/* Log Level Filter Tabs */}
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                {['ALL', 'CONNECT', 'PING', 'RESOLVE', 'ERROR'].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLogFilter(lvl as any)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-medium transition-all ${
                      logFilter === lvl
                        ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Connection Logs Stream */}
            <div className="flex-1 overflow-y-auto pt-3 space-y-1.5 font-mono text-[11px] pr-1 custom-scrollbar">
              {filteredLogs.length === 0 ? (
                <div className="h-36 flex flex-col items-center justify-center text-zinc-500 space-y-1">
                  <Activity className="w-6 h-6 opacity-40 animate-pulse" />
                  <p className="text-[10px]">No connection logs for selected filter.</p>
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const timeStr = new Date(log.timestamp).toLocaleTimeString();
                  const isErr = log.type === 'ERROR';
                  const isPing = log.type === 'PING';
                  const isConn = log.type === 'CONNECT';

                  return (
                    <div
                      key={log.id}
                      className="p-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60 hover:bg-zinc-900/80 transition-colors space-y-0.5"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-500">{timeStr}</span>
                          <span
                            className={`px-1 rounded text-[9px] font-bold ${
                              isErr
                                ? 'bg-rose-500/20 text-rose-400'
                                : isPing
                                ? 'bg-cyan-500/20 text-cyan-400'
                                : isConn
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            {log.type}
                          </span>
                        </div>
                        {log.latencyMs !== undefined && (
                          <span className="text-emerald-400 font-semibold">{log.latencyMs}ms</span>
                        )}
                      </div>
                      <p className={`text-xs ${isErr ? 'text-rose-300' : 'text-zinc-200'}`}>{log.message}</p>
                      {log.details && <p className="text-[10px] text-zinc-500">{log.details}</p>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
