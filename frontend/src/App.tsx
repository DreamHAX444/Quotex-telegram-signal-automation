import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { BalanceCard } from './components/BalanceCard';
import { ChannelCard } from './components/ChannelCard';
import { TelemetryCard } from './components/TelemetryCard';
import { ExecutionsFeed } from './components/ExecutionsFeed';
import { LogsViewer } from './components/LogsViewer';
import { ChannelHub } from './components/ChannelHub';
import { TestSignalModal } from './components/TestSignalModal';
import { ChannelManagerModal } from './components/ChannelManagerModal';
import { ConfirmModal } from './components/ConfirmModal';
import { liveStream, type LiveStateSnapshot } from './services/liveStream';
import { api } from './services/api';

function App() {
  const [liveState, setLiveState] = useState<LiveStateSnapshot>(liveStream.getState());
  const [activeTab, setActiveTab] = useState<'overview' | 'channel_hub' | 'trades' | 'logs' | 'telemetry'>('overview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testModalInitialText, setTestModalInitialText] = useState<string | undefined>(undefined);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [confirmModalData, setConfirmModalData] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: async () => {},
  });

  // Subscribe to 24/7 Live Stream
  useEffect(() => {
    const unsubscribe = liveStream.subscribe((state) => {
      setLiveState({ ...state });
    });
    return () => unsubscribe();
  }, []);

  // Update dynamic document title & favicon
  useEffect(() => {
    const bal = liveState.balance?.formattedBalance;
    const type = liveState.balance?.accountType || 'System';
    const isConn = liveState.connectionState === 'connected';

    const dot = isConn ? (type === 'Live' ? '🟢' : '🟡') : '🔴';
    document.title = bal
      ? `${dot} ${bal} (${type}) | Cortex 24/7 Terminal`
      : `${dot} Cortex 24/7 Terminal`;
  }, [liveState.balance, liveState.connectionState]);

  // Balance Refresh
  const handleRefreshBalance = async () => {
    setIsRefreshing(true);
    try {
      const res = await api.refreshBalance();
      if (res.success && res.balance) {
        liveStream.setOptimisticBalance(res.balance);
      }
    } catch (e) {
      console.error('Failed to refresh balance', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Account switching with confirmation safeguard for Live
  const handleRequestAccountSwitch = (type: 'Live' | 'Demo') => {
    if (liveState.balance?.accountType === type) return;

    if (type === 'Live') {
      setConfirmModalData({
        isOpen: true,
        title: 'Switch to Real Live Trading Account?',
        message:
          '⚠️ WARNING: You are switching Cortex to LIVE account mode. Real money will be used for automated broker trades following VIP channel signals. Ensure your risk settings and position sizing are verified.',
        action: async () => {
          liveStream.setOptimisticAccount('Live');
          await api.setStartupDefault('Live');
          await handleRefreshBalance();
        },
      });
    } else {
      liveStream.setOptimisticAccount('Demo');
      api.setStartupDefault('Demo').then(() => handleRefreshBalance());
    }
  };

  // Startup default account
  const handleDefaultAccountChange = async (type: 'Live' | 'Demo') => {
    try {
      await api.setStartupDefault(type);
    } catch (e) {
      console.error('Failed to set default account', e);
    }
  };

  // Channel switch
  const handleChannelSwitch = async (channelId: string) => {
    liveStream.setOptimisticChannel(channelId);
    try {
      await api.setActiveChannel(channelId);
    } catch (e) {
      console.error('Failed to switch channel', e);
    }
  };

  const handleOpenTestWithText = (text: string) => {
    setTestModalInitialText(text);
    setIsTestModalOpen(true);
  };

  return (
    <div className="h-screen flex flex-col antialiased font-sans overflow-hidden bg-background text-foreground selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Top Bar */}
      <Header
        state={liveState}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefreshBalance={handleRefreshBalance}
        isRefreshing={isRefreshing}
        onOpenTestModal={() => {
          setTestModalInitialText(undefined);
          setIsTestModalOpen(true);
        }}
        onOpenAccountSwitch={handleRequestAccountSwitch}
      />

      {/* Main Dynamic View Layout */}
      <main className="flex-1 min-h-0 overflow-hidden p-3 sm:p-5">
        {activeTab === 'overview' && (
          <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 overflow-y-auto lg:overflow-hidden custom-scrollbar">
            {/* Left Control Column (Finance, Routing, Diagnostics) */}
            <div className="lg:col-span-5 flex flex-col gap-4 sm:gap-5 overflow-y-auto pr-0 lg:pr-1 custom-scrollbar">
              <BalanceCard
                balance={liveState.balance}
                balanceHistory={liveState.balanceHistory}
                defaultAccount={liveState.settings.defaultAccount}
                isSyncing={isRefreshing}
                onRefresh={handleRefreshBalance}
                onActiveChange={handleRequestAccountSwitch}
                onDefaultChange={handleDefaultAccountChange}
              />

              <ChannelCard
                activeChannel={liveState.activeChannel}
                availableChannels={liveState.settings.availableChannels}
                telemetry={liveState.telemetry}
                onChannelChange={handleChannelSwitch}
                onOpenChannelManager={() => setIsChannelModalOpen(true)}
              />

              <TelemetryCard telemetry={liveState.telemetry} />
            </div>

            {/* Right Execution & Console Column */}
            <div className="lg:col-span-7 grid grid-rows-2 gap-4 sm:gap-5 min-h-[600px] lg:min-h-0 h-full">
              {/* Top: Live Trade Executions Feed */}
              <div className="min-h-0">
                <ExecutionsFeed executions={liveState.executions} />
              </div>

              {/* Bottom: Real-Time Streaming Logs Console */}
              <div className="min-h-0">
                <LogsViewer logs={liveState.logs} onClear={() => liveStream.clearLogs()} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'channel_hub' && (
          <div className="h-full max-w-7xl mx-auto">
            <ChannelHub
              activeChannel={liveState.activeChannel}
              availableChannels={liveState.settings.availableChannels}
              telemetry={liveState.telemetry}
              channelMessages={liveState.channelMessages}
              connectionLogs={liveState.connectionLogs}
              onOpenTestModalWithText={handleOpenTestWithText}
              onOpenChannelManager={() => setIsChannelModalOpen(true)}
              onChannelChange={handleChannelSwitch}
            />
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="h-full max-w-5xl mx-auto">
            <ExecutionsFeed executions={liveState.executions} />
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="h-full max-w-6xl mx-auto">
            <LogsViewer logs={liveState.logs} onClear={() => liveStream.clearLogs()} />
          </div>
        )}

        {activeTab === 'telemetry' && (
          <div className="h-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto">
            <TelemetryCard telemetry={liveState.telemetry} />
            <ChannelCard
              activeChannel={liveState.activeChannel}
              availableChannels={liveState.settings.availableChannels}
              telemetry={liveState.telemetry}
              onChannelChange={handleChannelSwitch}
              onOpenChannelManager={() => setIsChannelModalOpen(true)}
            />
          </div>
        )}
      </main>

      {/* Modals */}
      <TestSignalModal
        isOpen={isTestModalOpen}
        initialText={testModalInitialText}
        onClose={() => {
          setIsTestModalOpen(false);
          setTestModalInitialText(undefined);
        }}
      />

      <ChannelManagerModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
        availableChannels={liveState.settings.availableChannels}
        activeChannel={liveState.activeChannel}
        onChannelSelect={handleChannelSwitch}
      />

      <ConfirmModal
        isOpen={confirmModalData.isOpen}
        title={confirmModalData.title}
        message={confirmModalData.message}
        variant="warning"
        confirmText="Yes, Switch to Live"
        cancelText="Cancel"
        onConfirm={async () => {
          setConfirmModalData((prev) => ({ ...prev, isOpen: false }));
          await confirmModalData.action();
        }}
        onCancel={() => setConfirmModalData((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

export default App;
