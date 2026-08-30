import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { LogsViewer } from './components/LogsViewer';
import { api } from './services/api';
import type { LogEntry } from './services/api';

function App() {
  const [balance, setBalance] = useState('---');
  const [accountType, setAccountType] = useState('Checking...');
  const [defaultAccount, setDefaultAccount] = useState('Demo');
  const [lastSync, setLastSync] = useState('--:--:--');
  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastLogUpdate, setLastLogUpdate] = useState('Syncing...');
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [availableChannels, setAvailableChannels] = useState<{id: string, name: string}[]>([]);
  
  // Strategy is hardcoded in the original UI for now
  const strategy = 'Smart Sequential v2'; 
  
  const fetchSettings = async () => {
    try {
      const data = await api.fetchSettings();
      if (data && data.defaultAccount) {
        setDefaultAccount(data.defaultAccount);
      }
      if (data && data.availableChannels) {
        setAvailableChannels(data.availableChannels);
      }
      
      const channel = await api.fetchActiveChannel();
      if (channel) {
        setActiveChannel(channel);
      }
    } catch (e) {
      console.error('Failed to fetch settings/channel', e);
    }
  };

  const updateBalanceState = (balanceData: { formattedBalance?: string; accountType?: string; timestamp: string | number | Date }) => {
    if (balanceData && balanceData.formattedBalance) {
      setBalance(balanceData.formattedBalance);
      setAccountType(balanceData.accountType || 'Unknown');
      
      const d = new Date(balanceData.timestamp);
      setLastSync(d.toLocaleTimeString('en-US', { hour12: false }));
    }
  };

  const fetchBalance = async (isRefresh = false) => {
    setIsSyncing(true);
    try {
      const data = isRefresh ? await api.refreshBalance() : await api.fetchBalance();
      if (data.success && data.balance) {
        updateBalanceState(data.balance);
      }
    } catch (e) {
      console.error('Failed to fetch balance', e);
    } finally {
      setIsSyncing(false);
    }
  };
  useEffect(() => {
    // Initial fetch
    fetchSettings();
    fetchBalance(false);

    // Logs SSE subscription
    const eventSource = new EventSource('/api/logs/stream');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'initial') {
          setLogs(data.logs);
        } else if (data.type === 'new') {
          setLogs(prev => {
            const updated = [...prev, data.log];
            if (updated.length > 500) updated.shift();
            return updated;
          });
        }
        const d = new Date();
        setLastLogUpdate(`Updated ${d.toLocaleTimeString('en-US', { hour12: false })}`);
      } catch (e) {
        console.error('Error parsing SSE data', e);
      }
    };

    // Polling intervals
    const balanceInterval = setInterval(() => fetchBalance(false), 10000);

    return () => {
      clearInterval(balanceInterval);
      eventSource.close();
    };
  }, []);

  const handleActiveChange = (type: string) => {
    setAccountType(type);
    fetchBalance(false);
  };

  const handleDefaultChange = (type: string) => {
    setDefaultAccount(type);
  };

  const handleChannelChange = (channelId: string) => {
    setActiveChannel(channelId);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="h-screen flex flex-col antialiased font-sans overflow-hidden selection:bg-accent/20 selection:text-accent bg-background text-foreground">
      <Header systemMode={accountType as 'Live' | 'Demo' | 'Unknown'} />
      
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 grid-rows-[auto_1fr] lg:grid-rows-1 min-h-0 overflow-hidden">
        <Sidebar 
          balance={balance}
          accountType={accountType}
          defaultAccount={defaultAccount}
          activeChannel={activeChannel}
          availableChannels={availableChannels}
          lastSync={lastSync}
          strategy={strategy}
          isSyncing={isSyncing}
          onRefresh={() => fetchBalance(true)}
          onActiveChange={handleActiveChange}
          onDefaultChange={handleDefaultChange}
          onChannelChange={handleChannelChange}
        />
        
        <LogsViewer 
          logs={logs}
          lastUpdate={lastLogUpdate}
          onClear={handleClearLogs}
        />
      </main>
    </div>
  );
}

export default App;
