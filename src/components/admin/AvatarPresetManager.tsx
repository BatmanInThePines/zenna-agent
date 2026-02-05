'use client';

import { useState, useEffect, useCallback } from 'react';

interface Avatar {
  id: string;
  userId: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  method: string;
  createdAt: string;
  completedAt: string | null;
  isDefault: boolean;
  presetId: string | null;
  presetName: string | null;
}

interface Preset {
  id: string;
  name: string;
  modelUrl: string;
  thumbnailUrl?: string;
}

// Standard preset slots
const PRESET_SLOTS = [
  { id: 'zenna-default', name: 'Zenna Default', description: 'Default avatar for new users' },
  { id: 'zenna-alternate', name: 'Zenna Alternate', description: 'Alternative Zenna avatar option' },
  { id: 'orb', name: 'Orb', description: 'Abstract orb avatar' },
  { id: 'robot', name: 'Robot', description: 'Robot/mechanical avatar' },
];

interface AvatarPresetManagerProps {
  onPresetChange?: () => void;
}

export function AvatarPresetManager({ onPresetChange }: AvatarPresetManagerProps) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [currentPresets, setCurrentPresets] = useState<Preset[]>([]);
  const [defaultAvatarUrl, setDefaultAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load all avatars and current presets
  const loadAvatars = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/avatars');
      if (!response.ok) {
        throw new Error('Failed to fetch avatars');
      }

      const data = await response.json();
      setAvatars(data.avatars || []);
      setCurrentPresets(data.currentPresets || []);
      setDefaultAvatarUrl(data.defaultAvatarUrl || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load avatars');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAvatars();
  }, [loadAvatars]);

  // Assign avatar to a preset slot
  const assignToPreset = useCallback(async (avatar: Avatar, presetSlotId: string) => {
    setAssigningTo(presetSlotId);
    setMessage(null);

    const slot = PRESET_SLOTS.find(s => s.id === presetSlotId);
    if (!slot) return;

    try {
      const response = await fetch('/api/admin/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_preset',
          avatarId: avatar.id,
          modelUrl: avatar.modelUrl,
          thumbnailUrl: avatar.thumbnailUrl,
          presetId: slot.id,
          presetName: slot.name,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to assign preset');
      }

      const data = await response.json();
      setCurrentPresets(data.presets || []);
      setMessage({ type: 'success', text: `Assigned to ${slot.name}!` });
      onPresetChange?.();

      // Refresh avatars to update their preset status
      await loadAvatars();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to assign' });
    } finally {
      setAssigningTo(null);
      setSelectedAvatar(null);
    }
  }, [loadAvatars, onPresetChange]);

  // Set as default avatar for new users
  const setAsDefault = useCallback(async (avatar: Avatar) => {
    setMessage(null);

    try {
      const response = await fetch('/api/admin/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_default',
          modelUrl: avatar.modelUrl,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to set default');
      }

      const data = await response.json();
      setDefaultAvatarUrl(data.defaultAvatarUrl);
      setMessage({ type: 'success', text: 'Set as default avatar!' });
      onPresetChange?.();
      await loadAvatars();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to set default' });
    }
  }, [loadAvatars, onPresetChange]);

  // Remove preset assignment
  const removePreset = useCallback(async (presetId: string) => {
    setMessage(null);

    try {
      const response = await fetch('/api/admin/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_preset',
          presetId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove preset');
      }

      const data = await response.json();
      setCurrentPresets(data.presets || []);
      setMessage({ type: 'success', text: 'Preset removed!' });
      onPresetChange?.();
      await loadAvatars();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove' });
    }
  }, [loadAvatars, onPresetChange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-400 mb-4">{error}</p>
        <button onClick={loadAvatars} className="btn-secondary text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Messages */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400'
            : 'bg-red-500/10 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Current Preset Assignments */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-medium mb-4">Current Avatar Preset Assignments</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PRESET_SLOTS.map((slot) => {
            const preset = currentPresets.find(p => p.id === slot.id);

            return (
              <div
                key={slot.id}
                className={`border rounded-lg p-3 transition-all ${
                  preset
                    ? 'border-zenna-accent bg-zenna-accent/10'
                    : 'border-zenna-border border-dashed bg-zenna-surface/50'
                }`}
              >
                <div className="aspect-square mb-2 rounded-lg overflow-hidden bg-zenna-bg flex items-center justify-center">
                  {preset?.thumbnailUrl ? (
                    <img
                      src={preset.thumbnailUrl}
                      alt={preset.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl text-zenna-muted opacity-30">?</span>
                  )}
                </div>

                <p className="text-sm font-medium truncate">{slot.name}</p>
                <p className="text-xs text-zenna-muted truncate mb-2">{slot.description}</p>

                {preset ? (
                  <button
                    onClick={() => removePreset(preset.id)}
                    className="text-red-400 text-xs hover:underline"
                  >
                    Remove
                  </button>
                ) : (
                  <p className="text-xs text-zenna-muted italic">Not assigned</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* All Created Avatars */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">
            All Created Avatars ({avatars.length})
          </h3>
          <button onClick={loadAvatars} className="text-xs text-zenna-accent hover:underline">
            Refresh
          </button>
        </div>

        {avatars.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-zenna-muted text-sm mb-2">No avatars have been created yet.</p>
            <p className="text-xs text-zenna-muted">
              Avatars created through the 3D reconstruction feature will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {avatars.map((avatar) => (
              <div
                key={avatar.id}
                onClick={() => setSelectedAvatar(avatar)}
                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                  selectedAvatar?.id === avatar.id
                    ? 'border-zenna-accent ring-2 ring-zenna-accent/50'
                    : avatar.isDefault
                    ? 'border-green-500'
                    : avatar.presetId
                    ? 'border-blue-500'
                    : 'border-zenna-border hover:border-zenna-accent/50'
                }`}
              >
                <div className="aspect-square bg-zenna-surface">
                  {avatar.thumbnailUrl ? (
                    <img
                      src={avatar.thumbnailUrl}
                      alt="Avatar"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-2xl text-zenna-muted">3D</span>
                    </div>
                  )}
                </div>

                {/* Status badges */}
                <div className="absolute top-1 right-1 flex flex-col gap-1">
                  {avatar.isDefault && (
                    <span className="bg-green-500 text-white text-[8px] px-1 rounded">
                      DEFAULT
                    </span>
                  )}
                  {avatar.presetName && (
                    <span className="bg-blue-500 text-white text-[8px] px-1 rounded truncate max-w-[60px]">
                      {avatar.presetName}
                    </span>
                  )}
                </div>

                {/* Date */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                  <p className="text-[8px] text-white/70 truncate">
                    {new Date(avatar.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Avatar Actions Modal */}
      {selectedAvatar && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zenna-surface border border-zenna-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
            {/* Preview */}
            <div className="flex items-start gap-4 mb-6">
              <div className="w-24 h-24 rounded-lg overflow-hidden bg-zenna-bg flex-shrink-0">
                {selectedAvatar.thumbnailUrl ? (
                  <img
                    src={selectedAvatar.thumbnailUrl}
                    alt="Selected avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-3xl text-zenna-muted">3D</span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-medium mb-1">Avatar Actions</h3>
                <p className="text-xs text-zenna-muted mb-1">
                  Created: {new Date(selectedAvatar.createdAt).toLocaleString()}
                </p>
                <p className="text-xs text-zenna-muted">
                  Method: {selectedAvatar.method}
                </p>
                {selectedAvatar.presetName && (
                  <p className="text-xs text-blue-400 mt-1">
                    Current: {selectedAvatar.presetName}
                  </p>
                )}
                {selectedAvatar.isDefault && (
                  <p className="text-xs text-green-400 mt-1">
                    This is the default avatar
                  </p>
                )}
              </div>
            </div>

            {/* Set as Default */}
            {!selectedAvatar.isDefault && (
              <button
                onClick={() => setAsDefault(selectedAvatar)}
                className="w-full btn-primary mb-3"
              >
                Set as Default Avatar for New Users
              </button>
            )}

            {/* Assign to Preset Slots */}
            <div className="space-y-2 mb-4">
              <p className="text-sm font-medium">Assign to Preset Slot:</p>
              {PRESET_SLOTS.map((slot) => {
                const isAssigned = selectedAvatar.presetId === slot.id;
                const existingPreset = currentPresets.find(p => p.id === slot.id);

                return (
                  <button
                    key={slot.id}
                    onClick={() => assignToPreset(selectedAvatar, slot.id)}
                    disabled={assigningTo === slot.id}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                      isAssigned
                        ? 'bg-zenna-accent/20 border border-zenna-accent cursor-default'
                        : existingPreset
                        ? 'bg-zenna-bg/50 border border-zenna-border hover:border-zenna-accent/50'
                        : 'bg-zenna-bg border border-dashed border-zenna-border hover:border-zenna-accent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{slot.name}</p>
                        <p className="text-xs text-zenna-muted">{slot.description}</p>
                      </div>
                      {assigningTo === slot.id ? (
                        <div className="spinner-sm" />
                      ) : isAssigned ? (
                        <span className="text-xs text-zenna-accent">Current</span>
                      ) : existingPreset ? (
                        <span className="text-xs text-zenna-muted">Replace</span>
                      ) : (
                        <span className="text-xs text-zenna-muted">Assign</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Close button */}
            <button
              onClick={() => setSelectedAvatar(null)}
              className="w-full btn-secondary"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
