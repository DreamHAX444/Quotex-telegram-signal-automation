import { useState } from 'react';
import { api } from '../services/api';

interface AccountControlsProps {
  activeAccount: string;
  defaultAccount: string;
  activeChannel: string | null;
  availableChannels: { id: string; name: string }[];
  onActiveChange: (type: string) => void;
  onDefaultChange: (type: string) => void;
  onChannelChange: (channelId: string) => void;
}

export function AccountControls({ activeAccount, defaultAccount, activeChannel, availableChannels, onActiveChange, onDefaultChange, onChannelChange }: AccountControlsProps) {
  const [switching, setSwitching] = useState(false);
  const [defaultSwitching, setDefaultSwitching] = useState(false);
  const [channelSwitching, setChannelSwitching] = useState(false);

  const handleActiveSwitch = async (type: 'Live' | 'Demo') => {
    if (activeAccount === type || switching) return;
    setSwitching(true);
    try {
      const success = await api.setActiveAccount(type);
      if (success) {
        onActiveChange(type);
      }
    } catch (e) {
      console.error('Failed to switch active account', e);
    } finally {
      setSwitching(false);
    }
  };

  const handleDefaultSwitch = async (type: 'Live' | 'Demo') => {
    if (defaultAccount === type || defaultSwitching) return;
    setDefaultSwitching(true);
    try {
      const success = await api.setStartupDefault(type);
      if (success) {
        onDefaultChange(type);
      }
    } catch (e) {
      console.error('Failed to switch default account', e);
    } finally {
      setDefaultSwitching(false);
    }
  };

  const handleChannelSwitch = async (channelId: string) => {
    if (activeChannel === channelId || channelSwitching) return;
    setChannelSwitching(true);
    try {
      const success = await api.setActiveChannel(channelId);
      if (success) {
        onChannelChange(channelId);
      }
    } catch (e) {
      console.error('Failed to switch active channel', e);
    } finally {
      setChannelSwitching(false);
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
      
      <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mt-4">Channel Selection</h2>
      
      <div className="space-y-4 px-1">
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Signal Channel</span>
            {channelSwitching && <span className="text-[9px] text-accent animate-pulse">Switching...</span>}
          </div>
          <div className="flex items-center p-1 bg-muted/50 rounded-lg border border-border">
            {availableChannels && availableChannels.length > 0 ? (
              availableChannels.map((channel) => (
                <button 
                  key={channel.id}
                  onClick={() => handleChannelSwitch(channel.id)}
                  disabled={channelSwitching}
                  className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-md transition-all border ${
                    activeChannel === channel.id ? 'bg-background text-foreground shadow-sm border-border' : 'text-muted-foreground border-transparent hover:text-foreground'
                  }`}
                >
                  {channel.name}
                </button>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground py-1.5 px-2">No channels configured</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
