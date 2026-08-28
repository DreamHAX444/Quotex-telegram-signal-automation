import { Radio, Cpu } from 'lucide-react';

interface HeaderProps {
  systemMode: 'Live' | 'Demo' | 'Unknown';
}

export function Header({ systemMode }: HeaderProps) {
  const isDemo = systemMode === 'Demo';

  return (
    <header className="flex-none flex items-center justify-between px-4 sm:px-6 h-14 border-b border-border bg-background/95 backdrop-blur z-20 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
        </div>
        <h1 className="text-[13px] font-semibold tracking-wide text-foreground">
          Cortex <span className="text-muted-foreground font-normal">/ Terminal</span>
        </h1>
      </div>
      
      <div className="flex items-center gap-4 sm:gap-5 text-[10px] sm:text-[11px] font-mono text-muted-foreground">
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all ${
            isDemo 
              ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.05)]'
              : 'bg-accent/10 text-accent border-accent/20 shadow-[0_0_10px_rgba(16,185,129,0.05)]'
          }`}>
          <Radio className="w-3 h-3" />
          <span className="uppercase tracking-widest font-semibold hidden sm:inline">
            {systemMode} System
          </span>
          <span className="uppercase tracking-widest font-semibold sm:hidden">
            {systemMode}
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Cpu className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Engine Active</span>
        </div>
      </div>
    </header>
  );
}
