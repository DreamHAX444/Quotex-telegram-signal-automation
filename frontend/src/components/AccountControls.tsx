import { useState } from 'react';
import { api } from '../services/api';

interface AccountControlsProps {
  activeAccount: string;
  defaultAccount: string;
  activeChannel: string | null;
  onActiveChange: (type: string) => void;
  onDefaultChange: (type: string) => void;
  onChannelChange: (channelId: string) => void;
}

export function AccountControls({ activeAccount, defaultAccount, activeChannel, onActiveChange, onDefaultChange, onChannelChange }: AccountControlsProps) {
  const [switching, setSwitching] = useState(false);
  const [defaultSwitching, setDefaultSwitching] = useState(false);
  const [channelSwitching, setChannelSwitching] = useState(false);

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
    if (defaultAccount === type || defaultSwitching) return;
    setDefaultSwitching(true);
    const success = await api.setStartupDefault(type);
    if (success) {
      onDefaultChange(type);
    }
    setDefaultSwitching(false);
  };

  const handleChannelSwitch = async (channelId: string) => {
    if (activeChannel === channelId || channelSwitching) return;
    setChannelSwitching(true);
    const success = await api.setActiveChannel(channelId);
    if (success) {
      onChannelChange(channelId);
    }
    setChannelSwitching(false);
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
      
      <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mt-4">Channel Selection</h2>
      
      <div className="space-y-4 px-1">
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Signal Channel</span>
            {channelSwitching && <span className="text-[9px] text-accent animate-pulse">Switching...</span>}
          </div>
          <div className="flex items-center p-1 bg-muted/50 rounded-lg border border-border">
            <button 
              onClick={() => handleChannelSwitch('-1003922846451')}
              disabled={channelSwitching}
              className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                activeChannel === '-1003922846451' ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              Test Channel
            </button>
            <button 
              onClick={() => handleChannelSwitch('-1001771915378')}
              disabled={channelSwitching}
              className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                activeChannel === '-1001771915378' ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
              }`}
            >
              Main Channel
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
