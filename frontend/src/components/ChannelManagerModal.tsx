import { useState } from 'react';
import { X, Plus, Trash2, Radio } from 'lucide-react';
import { api } from '../services/api';
import type { ChannelPreset } from '../services/liveStream';

interface ChannelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableChannels: ChannelPreset[];
  activeChannel: string | null;
  onChannelSelect: (id: string) => void;
}

export function ChannelManagerModal({
  isOpen,
  onClose,
  availableChannels,
  activeChannel,
  onChannelSelect,
}: ChannelManagerModalProps) {
  const [channels, setChannels] = useState<ChannelPreset[]>(availableChannels);
  const [newName, setNewName] = useState('');
  const [newId, setNewId] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAdd = () => {
    const trimmedId = newId.trim();
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setErrorMsg('Please enter a channel name.');
      return;
    }
    if (!trimmedId || !/^-?\d{5,20}$/.test(trimmedId)) {
      setErrorMsg('Please enter a valid numerical Telegram Channel ID (e.g. -1001234567890).');
      return;
    }

    if (channels.some(c => c.id === trimmedId)) {
      setErrorMsg('This channel ID is already added.');
      return;
    }

    const updated = [...channels, { id: trimmedId, name: trimmedName }];
    setChannels(updated);
    setNewName('');
    setNewId('');
    setErrorMsg(null);
    saveChannels(updated);
  };

  const handleRemove = (idToRemove: string) => {
    const updated = channels.filter(c => c.id !== idToRemove);
    setChannels(updated);
    saveChannels(updated);
  };

  const saveChannels = async (list: ChannelPreset[]) => {
    setSaving(true);
    try {
      await api.saveChannels(list);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to save channels');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Telegram VIP Channel Manager</h2>
              <p className="text-[11px] text-zinc-400 font-mono">Configure signal listener sources</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Add Channel Form */}
          <div className="space-y-3 bg-zinc-900/40 p-4 rounded-xl border border-zinc-800">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-zinc-300">Add New Channel</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-400 mb-1 block">Channel Name</label>
                <input
                  type="text"
                  placeholder="e.g. VIP Signals Pro"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 mb-1 block">Numerical ID</label>
                <input
                  type="text"
                  placeholder="e.g. -100192837465"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center justify-center gap-1.5 w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg text-xs font-medium border border-zinc-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add to Channel Presets
            </button>
          </div>

          {/* Channel List */}
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-zinc-400">Available Presets</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {channels.map((channel) => {
                const isActive = activeChannel === channel.id;
                return (
                  <div
                    key={channel.id}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-200">{channel.name}</span>
                        {isActive && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-zinc-400">{channel.id}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isActive && (
                        <button
                          onClick={() => {
                            onChannelSelect(channel.id);
                            onClose();
                          }}
                          className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-emerald-500 hover:text-black text-zinc-300 rounded-lg transition-colors border border-zinc-700"
                        >
                          Select
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(channel.id)}
                        className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-3 border-t border-zinc-800 bg-zinc-900/30">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
