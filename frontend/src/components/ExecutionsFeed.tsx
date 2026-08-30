import { useState } from 'react';
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  Clock, 
  X, 
  Activity,
  Layers,
  AlertTriangle
} from 'lucide-react';
import type { ExecutedTradeRecord } from '../services/liveStream';

interface ExecutionsFeedProps {
  executions: ExecutedTradeRecord[];
}

export function ExecutionsFeed({ executions }: ExecutionsFeedProps) {
  const [selectedExecution, setSelectedExecution] = useState<ExecutedTradeRecord | null>(null);

  const getActionBadge = (action: string) => {
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
    if (['PREPARE', 'STANDBY'].includes(act)) {
      return {
        bg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
        icon: <Zap className="w-3.5 h-3.5" />,
        label: 'PREPARE',
      };
    }
    return {
      bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      icon: <Layers className="w-3.5 h-3.5" />,
      label: act,
    };
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-5 shadow-xl space-y-4 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-none">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 font-mono">
              Live Trade Executions
            </h2>
            <p className="text-[10px] font-mono text-zinc-500">Real-time automation timeline</p>
          </div>
        </div>

        <span className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-mono text-zinc-300 font-medium">
          {executions.length} Events
        </span>
      </div>

      {/* Execution Cards List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {executions.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-zinc-500 space-y-2">
            <Activity className="w-8 h-8 opacity-40 animate-pulse" />
            <p className="text-xs font-mono">Waiting for incoming VIP trading signals...</p>
          </div>
        ) : (
          executions.map((item) => {
            const badge = getActionBadge(item.signal.action);
            const timeStr = new Date(item.timestamp).toLocaleTimeString();

            return (
              <div
                key={item.id}
                onClick={() => setSelectedExecution(item)}
                className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700/80 transition-all cursor-pointer group flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200"
              >
                {/* Left: Direction & Ticker */}
                <div className="flex items-center gap-3">
                  <div
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-mono font-bold ${badge.bg}`}
                  >
                    {badge.icon}
                    <span>{badge.label}</span>
                  </div>

                  <div className="space-y-0.5">
                    <p className="text-xs font-mono font-bold text-zinc-100 uppercase">
                      {item.signal.ticker || 'SYS_ACTION'}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                      <span>{timeStr}</span>
                      {item.signal.durationMinutes && (
                        <>
                          <span>•</span>
                          <span>{item.signal.durationMinutes}m duration</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Latency & Status */}
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="flex items-center justify-end gap-1 text-[11px] font-mono text-zinc-400">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span>{item.durationMs}ms</span>
                    </div>
                    {item.balance && (
                      <span className="text-[10px] font-mono text-emerald-400">
                        {item.balance.formattedBalance}
                      </span>
                    )}
                  </div>

                  <div
                    className={`p-1.5 rounded-lg border ${
                      item.success
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                    }`}
                  >
                    {item.success ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Trade Inspector Modal */}
      {selectedExecution && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-lg border ${
                    selectedExecution.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  }`}
                >
                  {selectedExecution.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Trade Execution Details</h3>
                  <p className="text-[11px] font-mono text-zinc-400">Task ID: {selectedExecution.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedExecution(null)}
                className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 block uppercase">Signal Action</span>
                  <span className="text-sm font-bold text-zinc-100">{selectedExecution.signal.action}</span>
                </div>
                <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 block uppercase">Ticker Pair</span>
                  <span className="text-sm font-bold text-zinc-100">{selectedExecution.signal.ticker || 'N/A'}</span>
                </div>
                <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 block uppercase">Execution Latency</span>
                  <span className="text-sm font-bold text-emerald-400">{selectedExecution.durationMs}ms</span>
                </div>
                <div className="bg-zinc-900/40 p-3 rounded-xl border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 block uppercase">Result Status</span>
                  <span className={`text-sm font-bold ${selectedExecution.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedExecution.success ? 'SUCCESS' : 'FAILED'}
                  </span>
                </div>
              </div>

              {selectedExecution.error && (
                <div className="bg-rose-950/20 border border-rose-500/30 p-3 rounded-xl space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold block">
                    Execution Error
                  </span>
                  <p className="text-rose-300 text-xs break-words">{selectedExecution.error}</p>
                </div>
              )}

              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block">
                  Raw Signal Message
                </span>
                <pre className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 text-[11px] text-zinc-300 whitespace-pre-wrap">
                  {selectedExecution.signal.rawText}
                </pre>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
                <span>Timestamp: {new Date(selectedExecution.timestamp).toISOString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
