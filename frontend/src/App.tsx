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
  
  // Strategy is hardcoded in the original UI for now
  const strategy = 'Smart Sequential v2'; 
  
  const fetchSettings = async () => {
    try {
      const data = await api.fetchSettings();
      if (data && data.defaultAccount) {
        setDefaultAccount(data.defaultAccount);
      }
    } catch (e) {}
  };

  const updateBalanceState = (balanceData: any) => {
    if (balanceData && balanceData.balance) {
      setBalance(balanceData.balance);
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

  const fetchLogs = async () => {
    try {
      const data = await api.fetchLogs();
      setLogs(data);
      const d = new Date();
      setLastLogUpdate(`Updated ${d.toLocaleTimeString('en-US', { hour12: false })}`);
    } catch (e) {
      console.error('Failed to fetch logs', e);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchSettings();
    fetchBalance(false);
    fetchLogs();

    // Polling intervals
    const balanceInterval = setInterval(() => fetchBalance(false), 10000);
    const logsInterval = setInterval(fetchLogs, 1000);

    return () => {
      clearInterval(balanceInterval);
      clearInterval(logsInterval);
    };
  }, []);

  const handleActiveChange = (type: string) => {
    setAccountType(type);
    fetchBalance(false);
  };

  const handleDefaultChange = (type: string) => {
    setDefaultAccount(type);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="h-screen flex flex-col antialiased font-sans overflow-hidden selection:bg-accent/20 selection:text-accent bg-background text-foreground">
      <Header systemMode={accountType as any} />
      
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 grid-rows-[auto_1fr] lg:grid-rows-1 min-h-0 overflow-hidden">
        <Sidebar 
          balance={balance}
          accountType={accountType}
          defaultAccount={defaultAccount}
          lastSync={lastSync}
          strategy={strategy}
          isSyncing={isSyncing}
          onRefresh={() => fetchBalance(true)}
          onActiveChange={handleActiveChange}
          onDefaultChange={handleDefaultChange}
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
