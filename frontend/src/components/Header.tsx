import { useState, useEffect } from 'react';
import { 
  Zap, 
  Activity, 
  RefreshCw, 
  Maximize2, 
  Minimize2, 
  Wifi, 
  WifiOff, 
  Clock,
  SlidersHorizontal,
  Terminal,
  History,
  Radio
} from 'lucide-react';
import type { LiveStateSnapshot } from '../services/liveStream';

interface HeaderProps {
  state: LiveStateSnapshot;
  activeTab: 'overview' | 'channel_hub' | 'trades' | 'logs' | 'telemetry';
  onTabChange: (tab: 'overview' | 'channel_hub' | 'trades' | 'logs' | 'telemetry') => void;
  onRefreshBalance: () => void;
  isRefreshing: boolean;
  onOpenTestModal: () => void;
  onOpenAccountSwitch: (type: 'Live' | 'Demo') => void;
}

export function Header({
  state,
  activeTab,
  onTabChange,
  onRefreshBalance,
  isRefreshing,
  onOpenTestModal,
  onOpenAccountSwitch,
}: HeaderProps) {
  const [localTime, setLocalTime] = useState('');
  const [utcTime, setUtcTime] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const updateClocks = () => {
      const d = new Date();
      setLocalTime(d.toLocaleTimeString('en-US', { hour12: false }));
      setUtcTime(d.toISOString().slice(11, 19) + ' UTC');
    };
    updateClocks();
    const timer = setInterval(updateClocks, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const isDemo = state.balance?.accountType === 'Demo';
  const isLive = state.balance?.accountType === 'Live';
  const isConnected = state.connectionState === 'connected';
  const isReconnecting = state.connectionState === 'reconnecting';

  return (
    <header className="flex-none flex items-center justify-between px-4 sm:px-6 h-14 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md z-30 shadow-lg select-none">
      {/* Brand & Live Stream Indicator */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-2.5 w-2.5">
            {isConnected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isConnected
                  ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]'
                  : isReconnecting
                  ? 'bg-amber-500 animate-pulse shadow-[0_0_10px_#f59e0b]'
                  : 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'
              }`}
            ></span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs sm:text-sm font-bold tracking-wider text-zinc-100 uppercase flex items-center gap-1.5">
              CORTEX <span className="text-emerald-500 font-mono text-[11px]">24/7 LIVE</span>
            </h1>
          </div>
        </div>

        {/* 24/7 Live Stream Status Badge */}
        <div
          className={`hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-mono border transition-all ${
            isConnected
              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
              : isReconnecting
              ? 'bg-amber-950/40 text-amber-400 border-amber-500/30'
              : 'bg-rose-950/40 text-rose-400 border-rose-500/30'
          }`}
        >
          {isConnected ? (
            <>
              <Wifi className="w-3 h-3 text-emerald-400" />
              <span className="font-semibold tracking-wide uppercase">STREAM 24/7 ACTIVE</span>
              <span className="text-zinc-500">|</span>
              <span className="text-emerald-300 font-medium">{state.latencyMs}ms</span>
            </>
          ) : isReconnecting ? (
            <>
              <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
              <span>RECONNECTING... (#{state.reconnectAttempts})</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-rose-400" />
              <span>STREAM DISCONNECTED</span>
            </>
          )}
        </div>
      </div>

      {/* Navigation View Tabs */}
      <nav className="hidden lg:flex items-center gap-1 bg-zinc-900/60 p-1 rounded-xl border border-zinc-800/80">
        <button
          onClick={() => onTabChange('overview')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'overview'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Terminal
        </button>
        <button
          onClick={() => onTabChange('channel_hub')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'channel_hub'
              ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-emerald-400" />
          Channel & Connection
          {state.channelMessages.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-emerald-500/20 text-emerald-400 font-bold">
              {state.channelMessages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => onTabChange('trades')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'trades'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Trades
          {state.executions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-emerald-500/20 text-emerald-400">
              {state.executions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => onTabChange('logs')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'logs'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          Logs
        </button>
        <button
          onClick={() => onTabChange('telemetry')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTab === 'telemetry'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Telemetry
        </button>
      </nav>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5 sm:gap-4">
        {/* UTC / Local Clocks */}
        <div className="hidden xl:flex items-center gap-3 text-[11px] font-mono text-zinc-400 bg-zinc-900/60 px-3 py-1 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span className="text-zinc-300 font-semibold">{localTime}</span>
          </div>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400">{utcTime}</span>
        </div>

        {/* Quick Account Mode Pill */}
        <div className="flex items-center p-0.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <button
            onClick={() => onOpenAccountSwitch('Demo')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-medium transition-all ${
              isDemo
                ? 'bg-amber-500 text-black font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            DEMO
          </button>
          <button
            onClick={() => onOpenAccountSwitch('Live')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-medium transition-all ${
              isLive
                ? 'bg-emerald-500 text-black font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            LIVE
          </button>
        </div>

        {/* Test Signal Trigger Button */}
        <button
          onClick={onOpenTestModal}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-mono font-semibold transition-all active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">TEST SIGNAL</span>
        </button>

        {/* Refresh Balance Button */}
        <button
          onClick={onRefreshBalance}
          disabled={isRefreshing}
          title="Force Live Balance Check"
          className={`p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-all active:scale-95 ${
            isRefreshing ? 'opacity-60' : ''
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
        </button>

        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          title="Toggle Fullscreen"
          className="hidden sm:flex p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-all active:scale-95"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
}
