import { useState, useEffect, useRef } from 'react';
import { 
  RefreshCw, 
  Wallet, 
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import type { AccountBalance, BalanceHistoryEntry } from '../services/liveStream';

interface BalanceCardProps {
  balance: AccountBalance | null;
  balanceHistory: BalanceHistoryEntry[];
  defaultAccount: 'Live' | 'Demo';
  isSyncing: boolean;
  onRefresh: () => void;
  onActiveChange: (type: 'Live' | 'Demo') => void;
  onDefaultChange: (type: 'Live' | 'Demo') => void;
}

export function BalanceCard({
  balance,
  balanceHistory,
  defaultAccount,
  isSyncing,
  onRefresh,
  onActiveChange,
  onDefaultChange,
}: BalanceCardProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [flashColor, setFlashColor] = useState<'green' | 'red' | null>(null);
  const prevNumericRef = useRef<number | null>(null);

  // Trigger flash animation on balance change
  useEffect(() => {
    const curr = balance?.numericValue;
    if (curr !== undefined) {
      if (prevNumericRef.current !== null && curr !== prevNumericRef.current) {
        setFlashColor(curr > prevNumericRef.current ? 'green' : 'red');
        const timer = setTimeout(() => setFlashColor(null), 1200);
        prevNumericRef.current = curr;
        return () => clearTimeout(timer);
      }
      prevNumericRef.current = curr;
    }
  }, [balance?.numericValue]);

  const isDemo = balance?.accountType === 'Demo';
  const isLive = balance?.accountType === 'Live';

  // Calculate Net Delta from history
  const recentHistory = balanceHistory.slice(0, 20).reverse();
  let netDelta = 0;
  let netDeltaPercent = 0;
  if (recentHistory.length >= 2) {
    const oldest = recentHistory[0].numericValue;
    const newest = recentHistory[recentHistory.length - 1].numericValue;
    netDelta = Number((newest - oldest).toFixed(2));
    if (oldest > 0) {
      netDeltaPercent = Number(((netDelta / oldest) * 100).toFixed(2));
    }
  }

  // Generate SVG Sparkline coordinates
  const renderSparkline = () => {
    if (recentHistory.length < 2) {
      return (
        <div className="h-16 flex items-center justify-center text-[10px] text-zinc-500 font-mono">
          Collecting live equity snapshots...
        </div>
      );
    }

    const values = recentHistory.map(h => h.numericValue);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min === 0 ? 1 : max - min;
    const height = 48;
    const width = 280;
    const padding = 6;

    const points = recentHistory.map((h, i) => {
      const x = padding + (i / (recentHistory.length - 1)) * (width - padding * 2);
      const y = height - padding - ((h.numericValue - min) / range) * (height - padding * 2);
      return { x, y, value: h.numericValue, timestamp: h.timestamp, formatted: h.formattedBalance };
    });

    const pathD = points.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    const isPositive = netDelta >= 0;
    const strokeColor = isPositive ? '#10b981' : '#f43f5e';

    return (
      <div className="relative pt-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-14 overflow-visible">
          <defs>
            <linearGradient id="equityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Area */}
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`}
            fill="url(#equityGrad)"
          />
          {/* Line */}
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Hover interactive dots */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hoveredIndex === i ? 4 : 2}
              className="cursor-pointer transition-all"
              fill={hoveredIndex === i ? '#ffffff' : strokeColor}
              stroke={strokeColor}
              strokeWidth="1"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {hoveredIndex !== null && points[hoveredIndex] && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded text-[9px] font-mono text-zinc-100 shadow-xl pointer-events-none whitespace-nowrap z-20">
            {points[hoveredIndex].formatted} • {new Date(points[hoveredIndex].timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    );
  };

  const formattedBalance = balance?.formattedBalance || '---';
  const accountType = balance?.accountType || 'Loading...';
  const currency = balance?.currency || 'USD';
  const lastSyncStr = balance?.updatedAt ? new Date(balance.updatedAt).toLocaleTimeString() : '--:--:--';

  return (
    <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-5 shadow-xl space-y-5 relative overflow-hidden group hover:border-zinc-700/80 transition-all">
      {/* Background ambient neon glow */}
      <div
        className={`absolute -right-10 -top-10 w-36 h-36 rounded-full blur-3xl pointer-events-none transition-all duration-700 ${
          isLive ? 'bg-emerald-500/10' : 'bg-amber-500/10'
        }`}
      />

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-emerald-400">
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 font-mono">
              Broker Equity
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  isLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="text-[10px] font-mono font-medium text-zinc-300">
                Quotex ({accountType})
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isSyncing}
          title="Refresh Balance from Broker"
          className={`p-2 bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-400 hover:text-zinc-100 rounded-xl border border-zinc-800 transition-all ${
            isSyncing ? 'opacity-50' : ''
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </div>

      {/* Primary Balance Counter */}
      <div className="space-y-1">
        <div
          className={`text-3xl sm:text-4xl font-bold font-mono tracking-tight transition-all duration-300 ${
            flashColor === 'green'
              ? 'text-emerald-400 scale-[1.02] drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]'
              : flashColor === 'red'
              ? 'text-rose-400 scale-[1.02] drop-shadow-[0_0_20px_rgba(244,63,94,0.5)]'
              : 'text-zinc-100'
          }`}
        >
          {formattedBalance}
        </div>

        {/* Delta & Meta Badges */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          {recentHistory.length >= 2 && netDelta !== 0 && (
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${
                netDelta > 0
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              {netDelta > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              <span>{netDelta > 0 ? `+${netDelta}` : netDelta} {currency}</span>
              <span>({netDelta > 0 ? `+${netDeltaPercent}` : netDeltaPercent}%)</span>
            </div>
          )}

          <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-[10px] font-mono text-zinc-400">
            {currency}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 ml-auto">
            Synced: {lastSyncStr}
          </span>
        </div>
      </div>

      {/* Equity Sparkline */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3">
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-1">
          <span className="uppercase tracking-wider">Live Session Equity</span>
          <span>{recentHistory.length} data points</span>
        </div>
        {renderSparkline()}
      </div>

      {/* Account Switching Buttons */}
      <div className="pt-2 border-t border-zinc-800/80 space-y-3">
        {/* Active Account Switcher */}
        <div>
          <label className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 font-mono mb-1.5 block">
            Active Trading Mode
          </label>
          <div className="grid grid-cols-2 gap-2 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => onActiveChange('Demo')}
              className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all ${
                isDemo
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              DEMO MODE
            </button>
            <button
              onClick={() => onActiveChange('Live')}
              className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold transition-all ${
                isLive
                  ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              LIVE REAL MODE
            </button>
          </div>
        </div>

        {/* Startup Default Selector */}
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-zinc-400 font-mono text-[11px]">Startup Default:</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onDefaultChange('Demo')}
              className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-colors border ${
                defaultAccount === 'Demo'
                  ? 'bg-zinc-800 border-amber-500/40 text-amber-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              DEMO
            </button>
            <button
              onClick={() => onDefaultChange('Live')}
              className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-colors border ${
                defaultAccount === 'Live'
                  ? 'bg-zinc-800 border-emerald-500/40 text-emerald-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              LIVE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
