import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  TerminalSquare, 
  Search, 
  Trash2, 
  Copy, 
  Download, 
  ArrowDown, 
  Check, 
  Activity
} from 'lucide-react';
import type { LogEntry } from '../services/liveStream';

interface LogsViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export function LogsViewer({ logs, onClear }: LogsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  // Filter logs based on level and search query
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const lvl = filterLevel.toUpperCase();
    return logs.filter((log) => {
      const matchesLevel = lvl === 'ALL' || log.level.toUpperCase() === lvl;
      if (!matchesLevel) return false;
      if (!q) return true;
      if (log.message.toLowerCase().includes(q)) return true;
      if (log.level.toLowerCase().includes(q)) return true;
      if (log.meta) {
        const metaStr = typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta);
        if (metaStr.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [logs, filterLevel, searchQuery]);

  // Handle scroll events to detect if user manually scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (isAtBottom) {
      setAutoScroll(true);
      setUnreadCount(0);
    } else {
      setAutoScroll(false);
    }
  };

  const prevLogCountRef = useRef(logs.length);

  // Scroll to bottom when new logs arrive if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevLogCountRef.current = logs.length;
  }, [logs.length, autoScroll]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAutoScroll(true);
      setUnreadCount(0);
    }
  };

  const handleCopyLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level.padEnd(8)}] ${l.message} ${l.meta ? JSON.stringify(l.meta) : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadLogs = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level.padEnd(8)}] ${l.message} ${l.meta ? JSON.stringify(l.meta) : ''}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cortex-terminal-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getLogColor = (level: string) => {
    switch (level.toUpperCase()) {
      case 'ERROR':
        return 'text-rose-400 font-bold';
      case 'WARN':
        return 'text-amber-400 font-bold';
      case 'BROWSER':
        return 'text-purple-400';
      case 'SIGNAL':
      case 'TELEGRAM':
        return 'text-emerald-400';
      case 'QUEUE':
        return 'text-fuchsia-400';
      case 'DEBUG':
        return 'text-zinc-500';
      case 'INFO':
        return 'text-cyan-400';
      default:
        return 'text-zinc-300';
    }
  };

  const levels = ['ALL', 'SIGNAL', 'TELEGRAM', 'BROWSER', 'QUEUE', 'INFO', 'WARN', 'ERROR'];

  return (
    <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl shadow-xl flex flex-col h-full overflow-hidden relative group">
      {/* Top Toolbar */}
      <div className="flex-none px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Title and Level Filter Tabs */}
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 shrink-0">
            <TerminalSquare className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-zinc-200">Terminal Log</span>
          </div>

          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 shrink-0">
            {levels.map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                  filterLevel === lvl
                    ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/60'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Search, Actions */}
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none w-32 sm:w-44"
            />
          </div>

          <button
            onClick={handleCopyLogs}
            title="Copy Filtered Logs"
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg border border-zinc-800 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleDownloadLogs}
            title="Export All Logs (.log)"
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg border border-zinc-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClear}
            title="Clear Console"
            className="p-1.5 bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-300 rounded-lg border border-zinc-800 hover:border-rose-500/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log Output Stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 relative log-container selection:bg-emerald-500/20"
      >
        {filteredLogs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 space-y-2 opacity-50">
            <Activity className="w-8 h-8 opacity-40 animate-pulse" />
            <p className="text-xs uppercase tracking-wider">Awaiting real-time terminal output...</p>
          </div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div
              key={idx}
              className="flex flex-col sm:flex-row sm:gap-3 py-0.5 px-2 -mx-2 rounded hover:bg-zinc-900/60 transition-colors group"
            >
              <span className="text-zinc-600 w-[72px] flex-none shrink-0 select-none">
                {log.timestamp}
              </span>
              <span className={`w-[68px] flex-none shrink-0 ${getLogColor(log.level)}`}>
                {log.level}
              </span>
              <span className="text-zinc-200 break-all sm:break-words flex-1">
                {log.message}
                {log.meta ? (
                  <span className="text-zinc-500 block text-[10px] mt-0.5">
                    {typeof log.meta === 'object' ? JSON.stringify(log.meta) : String(log.meta)}
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Floating Jump to Latest Button */}
      {!autoScroll && (
        <div className="absolute bottom-4 right-6 z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-black font-semibold rounded-full text-xs font-mono shadow-xl shadow-emerald-500/20 transition-all"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Latest logs ({unreadCount} new)</span>
          </button>
        </div>
      )}

      {/* Footer Info */}
      <div className="flex-none px-4 py-2 border-t border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span>Displaying {filteredLogs.length} / {logs.length} logged events</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live Output Stream
        </span>
      </div>
    </div>
  );
}
