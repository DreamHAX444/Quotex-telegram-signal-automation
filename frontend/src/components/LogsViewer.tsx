import { TerminalSquare, Activity } from 'lucide-react';
import type { LogEntry } from '../services/api';
import { useEffect, useRef } from 'react';

interface LogsViewerProps {
  logs: LogEntry[];
  lastUpdate: string;
  onClear: () => void;
}

export function LogsViewer({ logs, lastUpdate, onClear }: LogsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-red-400';
      case 'WARN': return 'text-yellow-400';
      case 'BROWSER': return 'text-purple-400';
      case 'SIGNAL': return 'text-accent';
      case 'SUCCESS': return 'text-green-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <section className="col-span-1 lg:col-span-9 flex flex-col bg-background relative min-h-0">
      
      {/* Logs Toolbar */}
      <div className="flex-none px-4 sm:px-6 h-10 sm:h-12 border-b border-border flex items-center justify-between bg-background/80 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-muted-foreground">
          <TerminalSquare className="w-3.5 h-3.5" />
          <span>~/cortex/execution.log</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-[11px] font-mono">
          <span className="text-muted-foreground hidden sm:inline">{lastUpdate}</span>
          <span className="text-border hidden sm:inline">|</span>
          <span className="text-muted-foreground">{logs.length} events</span>
          <button 
            onClick={onClear} 
            className="ml-1 px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors duration-200 border border-transparent hover:border-border focus:outline-none"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Logs Output */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-3 sm:p-6 log-container font-mono text-[10px] sm:text-[11px] space-y-0.5 sm:space-y-1 relative">
        {logs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground space-y-3 opacity-60">
            <Activity className="w-8 h-8 opacity-50" />
            <p className="font-mono text-xs tracking-wider uppercase">Waiting for execution events...</p>
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="flex flex-col sm:flex-row sm:gap-3 py-0.5 sm:py-0 hover:bg-muted/30 px-2 -mx-2 rounded transition-colors group">
              <span className="text-muted-foreground/60 w-[70px] flex-none shrink-0">{log.timestamp}</span>
              <span className={`w-[60px] flex-none shrink-0 font-semibold ${getLogColor(log.level)}`}>{log.level}</span>
              <span className="text-muted-foreground/80 w-[75px] flex-none shrink-0">[{log.component}]</span>
              <span className="text-foreground break-all sm:break-words">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
