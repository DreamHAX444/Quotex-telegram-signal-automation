import { useState } from 'react';
import { X, Send, Play, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

interface TestSignalModalProps {
  isOpen: boolean;
  initialText?: string;
  onClose: () => void;
}

export function TestSignalModal({ isOpen, initialText, onClose }: TestSignalModalProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>(initialText ? 'custom' : 'presets');
  const [customText, setCustomText] = useState(initialText || 'EURUSD 1M CALL');
  const [action, setAction] = useState<'CALL' | 'PUT' | 'BUY' | 'SELL' | 'PREPARE' | 'BALANCE'>('CALL');
  const [ticker, setTicker] = useState('EURUSD');
  const [duration, setDuration] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSendPreset = async () => {
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await api.sendTestSignal({
        action,
        ticker,
        duration,
      });
      if (res.success) {
        setStatusMsg({ type: 'success', text: `Dispatched task [${res.taskId || 'OK'}] to Playwright Queue!` });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to dispatch test task.' });
      }
    } catch (e: any) {
      setStatusMsg({ type: 'error', text: e.message || 'Error triggering test signal.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCustom = async () => {
    if (!customText.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await api.sendTestSignal({ rawText: customText });
      if (res.success) {
        setStatusMsg({ type: 'success', text: `Parsed & Enqueued: ${res.signal?.action || 'ACTION'} ${res.signal?.ticker || ''}` });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to parse signal string.' });
      }
    } catch (e: any) {
      setStatusMsg({ type: 'error', text: e.message || 'Error sending custom signal.' });
    } finally {
      setSubmitting(false);
    }
  };

  const quickPresets = [
    { label: 'EUR/USD 1M ⬆ CALL', action: 'CALL', ticker: 'EURUSD', duration: 1, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
    { label: 'GBP/USD 1M ⬇ PUT', action: 'PUT', ticker: 'GBPUSD', duration: 1, color: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
    { label: 'USD/JPY 2M ⬆ BUY', action: 'BUY', ticker: 'USDJPY', duration: 2, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
    { label: 'AUD/CAD 1M ⬇ SELL', action: 'SELL', ticker: 'AUDCAD', duration: 1, color: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
    { label: '💰 Check Account Balance', action: 'BALANCE', ticker: 'BALANCE', duration: 1, color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
    { label: '⚡ Standby Prewarm (EURUSD)', action: 'PREPARE', ticker: 'EURUSD', duration: 1, color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
              <Play className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Live Signal Injection Tester</h2>
              <p className="text-[11px] text-zinc-400 font-mono">Simulate trading signals directly into the queue</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-900/30 px-6 pt-3 gap-4">
          <button
            onClick={() => { setActiveTab('presets'); setStatusMsg(null); }}
            className={`pb-2.5 text-xs font-medium tracking-wide transition-all border-b-2 ${
              activeTab === 'presets'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Quick Presets & Builder
          </button>
          <button
            onClick={() => { setActiveTab('custom'); setStatusMsg(null); }}
            className={`pb-2.5 text-xs font-medium tracking-wide transition-all border-b-2 ${
              activeTab === 'custom'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Raw Telegram Text Parser
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {statusMsg && (
            <div
              className={`p-3.5 rounded-xl border flex items-center gap-3 text-xs animate-in fade-in duration-200 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {activeTab === 'presets' ? (
            <div className="space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-2 block">
                  Quick One-Click Test Triggers
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {quickPresets.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setAction(p.action as any);
                        setTicker(p.ticker);
                        setDuration(p.duration);
                      }}
                      className={`text-left p-2.5 rounded-xl border text-xs font-mono transition-all hover:scale-[1.02] active:scale-95 ${
                        action === p.action && ticker === p.ticker ? 'ring-2 ring-emerald-500 ' + p.color : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">
                      Direction
                    </label>
                    <select
                      value={action}
                      onChange={(e) => setAction(e.target.value as any)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="CALL">CALL (UP)</option>
                      <option value="PUT">PUT (DOWN)</option>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                      <option value="PREPARE">PREPARE</option>
                      <option value="BALANCE">BALANCE</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">
                      Ticker / Asset
                    </label>
                    <input
                      type="text"
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      placeholder="e.g. EURUSD"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none uppercase"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">
                      Duration
                    </label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none"
                    >
                      <option value={1}>1 Minute</option>
                      <option value={2}>2 Minutes</option>
                      <option value={5}>5 Minutes</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleSendPreset}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-black font-semibold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
                >
                  {submitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Execute Built Signal
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold block">
                Paste Raw Telegram Message Format
              </label>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={4}
                placeholder="Paste exact signal message here e.g.&#10;EUR/USD OTC 1M CALL&#10;ENTRY NOW"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none resize-none"
              />
              <button
                onClick={handleSendCustom}
                disabled={submitting || !customText.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-black font-semibold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Parse & Execute Raw Signal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
