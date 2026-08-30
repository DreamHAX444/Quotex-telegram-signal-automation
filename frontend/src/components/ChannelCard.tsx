import { useState, useEffect } from 'react';
import { Radio, Settings, ArrowRightLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import type { ChannelPreset, SystemTelemetryState } from '../services/liveStream';

interface ChannelCardProps {
  activeChannel: string | null;
  availableChannels: ChannelPreset[];
  telemetry: SystemTelemetryState | null;
  onChannelChange: (id: string) => void;
  onOpenChannelManager: () => void;
}

export function ChannelCard({
  activeChannel,
  availableChannels,
  telemetry,
  onChannelChange,
  onOpenChannelManager,
}: ChannelCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSelectChannel = async (id: string) => {
    if (activeChannel === id || switchingId) return;
    setSwitchingId(id);
    try {
      await onChannelChange(id);
    } finally {
      setSwitchingId(null);
    }
  };

  const activePreset = availableChannels.find(c => c.id === activeChannel);
  const activeName = activePreset ? activePreset.name : 'Configured Channel';

  const lastMessageAgo = telemetry?.lastMessageAt
    ? `${Math.max(0, Math.floor((now - telemetry.lastMessageAt) / 1000))}s ago`
    : 'No messages yet';

  return (
    <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-5 shadow-xl space-y-5 relative overflow-hidden group hover:border-zinc-700/80 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-emerald-400">
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 font-mono">
              Signal Routing Channel
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono font-medium text-zinc-300">
                {activeName}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onOpenChannelManager}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl border border-zinc-800 text-[11px] font-mono transition-colors active:scale-95"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Manage</span>
        </button>
      </div>

      {/* Active Channel Display */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-mono text-[11px]">Listening Channel ID:</span>
          <span className="text-emerald-400 font-mono font-semibold text-xs bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded">
            {activeChannel || 'None'}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-mono text-[11px]">Last VIP Post:</span>
          <span className="text-zinc-300 font-mono text-[11px]">
            {lastMessageAgo}
          </span>
        </div>
      </div>

      {/* Channel Presets Selector */}
      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 font-mono block">
          Select Active VIP Stream
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {availableChannels.map((channel) => {
            const isSelected = activeChannel === channel.id;
            const isSwitching = switchingId === channel.id;

            return (
              <button
                key={channel.id}
                onClick={() => handleSelectChannel(channel.id)}
                disabled={isSelected || isSwitching}
                className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                  isSelected
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 shadow-sm'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
                }`}
              >
                <div className="space-y-0.5 truncate pr-2">
                  <p className="text-xs font-semibold truncate">{channel.name}</p>
                  <p className="text-[9px] font-mono text-zinc-500 truncate">{channel.id}</p>
                </div>
                {isSwitching ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                ) : isSelected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <ArrowRightLeft className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Message Throughput Counters */}
      <div className="pt-2 border-t border-zinc-800/80 grid grid-cols-2 gap-2 text-center">
        <div className="bg-zinc-900/30 border border-zinc-800/50 p-2.5 rounded-xl">
          <span className="text-[9px] uppercase tracking-wider font-mono text-zinc-500 block">
            Processed
          </span>
          <span className="text-sm font-bold font-mono text-emerald-400">
            {telemetry?.messagesProcessed || 0}
          </span>
        </div>
        <div className="bg-zinc-900/30 border border-zinc-800/50 p-2.5 rounded-xl">
          <span className="text-[9px] uppercase tracking-wider font-mono text-zinc-500 block">
            Ignored / Other
          </span>
          <span className="text-sm font-bold font-mono text-zinc-400">
            {telemetry?.messagesIgnored || 0}
          </span>
        </div>
      </div>
    </div>
  );
}
