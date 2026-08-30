import { useState, useEffect } from 'react';
import { 
  Activity, 
  Cpu, 
  Layers, 
  Clock, 
  Pause, 
  Play, 
  Trash2, 
  Server, 
  Radio, 
  ShieldCheck 
} from 'lucide-react';
import type { SystemTelemetryState } from '../services/liveStream';
import { api } from '../services/api';

interface TelemetryCardProps {
  telemetry: SystemTelemetryState | null;
}

export function TelemetryCard({ telemetry }: TelemetryCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [queueActionLoading, setQueueActionLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleTogglePauseQueue = async () => {
    setQueueActionLoading(true);
    try {
      await api.togglePauseQueue();
    } catch (e) {
      console.error('Failed to toggle queue pause', e);
    } finally {
      setQueueActionLoading(false);
    }
  };

  const handleClearQueue = async () => {
    setQueueActionLoading(true);
    try {
      await api.clearQueue();
    } catch (e) {
      console.error('Failed to clear queue', e);
    } finally {
      setQueueActionLoading(false);
    }
  };

  // Compute live uptime string
  const formatUptime = (startedAt: number) => {
    if (!startedAt) return '0s';
    const totalSecs = Math.max(0, Math.floor((now - startedAt) / 1000));
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
  };

  const isConnected = telemetry?.status === 'Connected';
  const pingAgo = telemetry?.lastPingAt
    ? `${Math.max(0, Math.floor((now - telemetry.lastPingAt) / 1000))}s ago`
    : 'Never';

  const checkAgo = telemetry?.lastCheckedAt
    ? `${Math.max(0, Math.floor((now - telemetry.lastCheckedAt) / 1000))}s ago`
    : 'Never';

  const uptimeStr = telemetry?.startedAt ? formatUptime(telemetry.startedAt) : 'Starting...';

  return (
    <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-5 shadow-xl space-y-5 relative overflow-hidden group hover:border-zinc-700/80 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 font-mono">
              24/7 Engine Telemetry
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="text-[10px] font-mono font-medium text-zinc-300">
                {telemetry?.status || 'Active'}
              </span>
            </div>
          </div>
        </div>

        {/* Uptime Tag */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/80 border border-zinc-800 rounded-xl text-[10px] font-mono text-zinc-300">
          <Clock className="w-3 h-3 text-emerald-400" />
          <span>Uptime: {uptimeStr}</span>
        </div>
      </div>

      {/* Grid of Telemetry Details */}
      <div className="space-y-2.5 font-mono text-xs">
        {/* Telegram MTProto */}
        <div className="flex items-center justify-between p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Telegram UserBot</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
              isConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            {telemetry?.status || 'Connecting'}
          </span>
        </div>

        {/* Keep-Alive Heartbeat */}
        <div className="flex items-center justify-between p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Active Keep-Alive</span>
          </div>
          <span className="text-zinc-200 text-[11px]">{pingAgo}</span>
        </div>

        {/* Message Heartbeat */}
        <div className="flex items-center justify-between p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <Server className="w-3.5 h-3.5 text-zinc-400" />
            <span>Listener Poll Tick</span>
          </div>
          <span className="text-zinc-200 text-[11px]">{checkAgo}</span>
        </div>

        {/* Playwright Browser Engine */}
        <div className="flex items-center justify-between p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Playwright Chrome Engine</span>
          </div>
          <span className="text-cyan-300 text-[10px] bg-cyan-950/40 border border-cyan-500/20 px-2 py-0.5 rounded">
            Standby / Warm
          </span>
        </div>
      </div>

      {/* Sequential Task Queue Section */}
      <div className="pt-2 border-t border-zinc-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
              FIFO Task Queue
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                telemetry?.isQueuePaused
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}
            >
              {telemetry?.isQueuePaused ? 'PAUSED' : 'ACTIVE'}
            </span>
            <span className="text-xs font-mono text-zinc-300 font-bold">
              {telemetry?.queueSize || 0} Pending
            </span>
          </div>
        </div>

        {/* Queue Control Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleTogglePauseQueue}
            disabled={queueActionLoading}
            className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-mono border border-zinc-800 transition-colors active:scale-95 disabled:opacity-50"
          >
            {telemetry?.isQueuePaused ? (
              <>
                <Play className="w-3 h-3 text-emerald-400" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3 text-amber-400" />
                <span>Pause</span>
              </>
            )}
          </button>
          <button
            onClick={handleClearQueue}
            disabled={queueActionLoading}
            className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-300 rounded-lg text-xs font-mono border border-zinc-800 hover:border-rose-500/30 transition-colors active:scale-95 disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </div>
  );
}
