import { RefreshCw } from 'lucide-react';
import { AccountControls } from './AccountControls';

interface SidebarProps {
  balance: string;
  accountType: string;
  defaultAccount: string;
  activeChannel: string | null;
  lastSync: string;
  strategy: string;
  isSyncing: boolean;
  onRefresh: () => void;
  onActiveChange: (type: string) => void;
  onDefaultChange: (type: string) => void;
  onChannelChange: (channelId: string) => void;
}

export function Sidebar({ 
  balance, 
  accountType, 
  defaultAccount, 
  activeChannel,
  lastSync, 
  strategy, 
  isSyncing, 
  onRefresh, 
  onActiveChange, 
  onDefaultChange,
  onChannelChange 
}: SidebarProps) {
  return (
    <aside className="col-span-1 lg:col-span-3 border-b lg:border-b-0 lg:border-r border-border bg-card p-4 sm:p-6 flex flex-col gap-6 overflow-y-auto z-10 custom-scrollbar">
      
      {/* Balance Section */}
      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <h2 className="text-[10px] sm:text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Account Balance</h2>
          <button 
            onClick={onRefresh}
            disabled={isSyncing}
            className={`text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted active:scale-95 flex items-center justify-center focus:outline-none ${isSyncing ? 'opacity-50' : ''}`}
            aria-label="Refresh Balance"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </header>
        
        <div className="bg-background border border-border p-4 sm:p-5 rounded-xl shadow-sm relative overflow-hidden transition-all duration-300 hover:border-zinc-700">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-accent/5 rounded-full blur-2xl pointer-events-none"></div>
          
          <div className={`font-mono text-2xl sm:text-3xl font-medium tracking-tight glow-text text-foreground transition-colors duration-500 ${isSyncing ? 'opacity-70' : ''}`}>
            {balance}
          </div>
          
          <div className="flex items-center gap-2 mt-3 sm:mt-4">
            <span className="px-2 py-0.5 text-[9px] sm:text-[10px] font-mono rounded bg-muted text-muted-foreground border border-border">
              {accountType}
            </span>
            {isSyncing && <span className="text-[9px] sm:text-[10px] text-muted-foreground">Syncing...</span>}
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3 mt-1 px-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Strategy</span>
            <span className="font-mono text-foreground text-right truncate max-w-[120px] sm:max-w-[140px] text-[10px] sm:text-[11px] bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">
              {strategy}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Last Sync</span>
            <span className="font-mono text-muted-foreground text-[10px] sm:text-[11px]">{lastSync}</span>
          </div>
        </div>
      </section>

      <AccountControls 
        activeAccount={accountType} 
        defaultAccount={defaultAccount}
        activeChannel={activeChannel}
        onActiveChange={onActiveChange}
        onDefaultChange={onDefaultChange}
        onChannelChange={onChannelChange}
      />

      {/* System Config Section */}
      <section className="hidden sm:flex flex-col gap-3 pt-2 border-t border-border/50">
        <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Configuration</h2>
        <div className="space-y-2.5 px-1">
          <div className="flex justify-between items-center text-xs group">
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">Broker Target</span>
            <span className="font-mono text-[11px] text-foreground">Quotex (qx)</span>
          </div>
          <div className="flex justify-between items-center text-xs group">
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">Concurrency</span>
            <span className="font-mono text-[11px] text-foreground">1 (FIFO)</span>
          </div>
        </div>
      </section>
      
    </aside>
  );
}
