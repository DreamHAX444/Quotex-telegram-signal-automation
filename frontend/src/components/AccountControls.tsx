import { useState } from 'react';
import { api } from '../services/api';

interface AccountControlsProps {
  activeAccount: string;
  defaultAccount: string;
  onActiveChange: (type: string) => void;
  onDefaultChange: (type: string) => void;
}

export function AccountControls({ activeAccount, defaultAccount, onActiveChange, onDefaultChange }: AccountControlsProps) {
  const [switching, setSwitching] = useState(false);

  const handleActiveSwitch = async (type: 'Live' | 'Demo') => {
    if (activeAccount === type || switching) return;
    setSwitching(true);
    const success = await api.setActiveAccount(type);
    if (success) {
      onActiveChange(type);
    }
    setSwitching(false);
  };

  const handleDefaultSwitch = async (type: 'Live' | 'Demo') => {
    if (defaultAccount === type) return;
    const success = await api.setStartupDefault(type);
    if (success) {
      onDefaultChange(type);
    }
  };

  return (
    <section className="flex flex-col gap-3 pt-2 border-t border-border/50">
      <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Account Switching</h2>
      
      <div className="space-y-4 px-1">
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Active Account</span>
            {switching && <span className="text-[9px] text-accent animate-pulse">Switching...</span>}
          </div>
          <div className="flex items-center p-1 bg-muted/50 rounded-lg border border-border">
            <button 
              onClick={() => handleActiveSwitch('Demo')}
              disabled={switching}
              className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                activeAccount === 'Demo' ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              Demo
            </button>
            <button 
              onClick={() => handleActiveSwitch('Live')}
              disabled={switching}
              className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                activeAccount === 'Live' ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              Live
            </button>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Startup Default</span>
          </div>
          <div className="flex items-center p-1 bg-muted/50 rounded-lg border border-border">
            <button 
              onClick={() => handleDefaultSwitch('Demo')}
              className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                defaultAccount === 'Demo' ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              Demo
            </button>
            <button 
              onClick={() => handleDefaultSwitch('Live')}
              className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                defaultAccount === 'Live' ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              Live
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
