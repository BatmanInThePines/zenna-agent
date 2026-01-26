'use client';

import { useState, useEffect, useCallback } from 'react';

interface SettingsPanelProps {
  onClose: () => void;
}

interface UserSettings {
  preferredBrainProvider?: string;
  brainApiKey?: string;
  personalPrompt?: string;
  avatarUrl?: string;
  integrations?: {
    hue?: { bridgeIp: string; username: string };
  };
}

type SettingsTab = 'general' | 'llm' | 'integrations' | 'master';

interface InfoTooltipProps {
  title: string;
  description: string;
  howTo?: string;
}

function InfoTooltip({ title, description, howTo }: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="ml-2 w-4 h-4 rounded-full bg-zenna-border text-xs text-zenna-muted hover:bg-zenna-accent hover:text-white transition-colors"
      >
        i
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-50 left-6 top-0 w-64 p-3 bg-zenna-surface border border-zenna-border rounded-lg shadow-xl">
            <h4 className="text-sm font-medium mb-1">{title}</h4>
            <p className="text-xs text-zenna-muted mb-2">{description}</p>
            {howTo && (
              <p className="text-xs text-zenna-accent">{howTo}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<UserSettings>({});
  const [isFather, setIsFather] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change state
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });

  // LLM validation state
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidation, setKeyValidation] = useState<{ valid: boolean; error?: string } | null>(null);

  // Hue bridge state
  const [hueStatus, setHueStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        setSettings(data.settings || {});
        setIsFather(data.isFather || false);
      } catch {
        setMessage({ type: 'error', text: 'Failed to load settings' });
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const saveSettings = useCallback(async (updates: Partial<UserSettings>) => {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (data.success) {
        setSettings(prev => ({ ...prev, ...updates }));
        setMessage({ type: 'success', text: 'Settings saved' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handlePasswordChange = useCallback(async () => {
    if (passwords.new !== passwords.confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    if (passwords.new.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Password changed successfully' });
        setPasswords({ current: '', new: '', confirm: '' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to change password' });
    } finally {
      setIsSaving(false);
    }
  }, [passwords]);

  const validateApiKey = useCallback(async (provider: string, apiKey: string) => {
    setIsValidatingKey(true);
    setKeyValidation(null);

    try {
      const response = await fetch('/api/settings/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });

      const data = await response.json();
      setKeyValidation(data);

      if (data.valid) {
        await saveSettings({ preferredBrainProvider: provider, brainApiKey: apiKey });
      }
    } catch {
      setKeyValidation({ valid: false, error: 'Validation failed' });
    } finally {
      setIsValidatingKey(false);
    }
  }, [saveSettings]);

  const connectHueBridge = useCallback(async () => {
    setHueStatus('connecting');

    try {
      const response = await fetch('/api/integrations/hue/connect', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setHueStatus('connected');
        setSettings(prev => ({
          ...prev,
          integrations: {
            ...prev.integrations,
            hue: { bridgeIp: data.bridgeIp, username: data.username },
          },
        }));
        setMessage({ type: 'success', text: 'Hue Bridge connected!' });
      } else {
        setHueStatus('disconnected');
        setMessage({ type: 'error', text: data.error || 'Failed to connect' });
      }
    } catch {
      setHueStatus('disconnected');
      setMessage({ type: 'error', text: 'Failed to connect to Hue Bridge' });
    }
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'llm', label: 'LLM' },
    { id: 'integrations', label: 'Integrations' },
    ...(isFather ? [{ id: 'master' as const, label: 'Master' }] : []),
  ];

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="glass-card p-8">
          <div className="spinner mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zenna-border flex items-center justify-between">
          <h2 className="text-lg font-medium">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zenna-surface rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zenna-border">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'text-white border-b-2 border-zenna-accent'
                  : 'text-zenna-muted hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Messages */}
          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400'
            }`}>
              {message.text}
            </div>
          )}

          {/* General Tab */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* Change Password */}
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  Change Password
                  <InfoTooltip
                    title="Password"
                    description="Your login password for Zenna."
                    howTo="Minimum 8 characters recommended."
                  />
                </h3>
                <div className="space-y-3">
                  <input
                    type="password"
                    placeholder="Current password"
                    value={passwords.current}
                    onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
                    className="w-full"
                  />
                  <input
                    type="password"
                    placeholder="New password"
                    value={passwords.new}
                    onChange={(e) => setPasswords(p => ({ ...p, new: e.target.value }))}
                    className="w-full"
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                    className="w-full"
                  />
                  <button
                    onClick={handlePasswordChange}
                    disabled={isSaving || !passwords.current || !passwords.new || !passwords.confirm}
                    className="btn-secondary text-sm"
                  >
                    {isSaving ? 'Saving...' : 'Update Password'}
                  </button>
                </div>
              </div>

              {/* Personal Prompt */}
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  Personal Prompt
                  <InfoTooltip
                    title="Personal Prompt"
                    description="Customize how Zenna behaves with you. This is added to the system prompt."
                    howTo="Example: 'I prefer concise answers' or 'Call me by my nickname: Alex'"
                  />
                </h3>
                <textarea
                  placeholder="Add your personal preferences..."
                  value={settings.personalPrompt || ''}
                  onChange={(e) => setSettings(s => ({ ...s, personalPrompt: e.target.value }))}
                  rows={4}
                  className="w-full resize-none"
                />
                <button
                  onClick={() => saveSettings({ personalPrompt: settings.personalPrompt })}
                  disabled={isSaving}
                  className="btn-secondary text-sm mt-2"
                >
                  {isSaving ? 'Saving...' : 'Save Prompt'}
                </button>
              </div>

              {/* Avatar Upload */}
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  Custom Avatar
                  <InfoTooltip
                    title="Avatar"
                    description="Upload a custom PNG image for Zenna's avatar."
                    howTo="Recommended: Square image, 512x512 or larger."
                  />
                </h3>
                <input
                  type="file"
                  accept="image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      // TODO: Implement file upload
                      setMessage({ type: 'error', text: 'Avatar upload coming soon' });
                    }
                  }}
                  className="w-full text-sm text-zenna-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-zenna-surface file:text-white hover:file:bg-zenna-accent file:cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* LLM Tab */}
          {activeTab === 'llm' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  Brain Provider
                  <InfoTooltip
                    title="LLM Provider"
                    description="Choose which AI model powers Zenna's reasoning."
                    howTo="Default is Gemini 2.5 Flash. You can use your own API key for other providers."
                  />
                </h3>

                <div className="space-y-4">
                  {/* Provider Selection */}
                  <select
                    value={settings.preferredBrainProvider || 'gemini-2.5-flash'}
                    onChange={(e) => setSettings(s => ({ ...s, preferredBrainProvider: e.target.value }))}
                    className="w-full bg-zenna-surface border border-zenna-border rounded-lg p-3"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Default)</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="claude">Claude (Anthropic)</option>
                    <option value="openai">OpenAI GPT-4o</option>
                  </select>

                  {/* API Key Input */}
                  {settings.preferredBrainProvider !== 'gemini-2.5-flash' && (
                    <div>
                      <label className="text-xs text-zenna-muted block mb-2">
                        API Key for {settings.preferredBrainProvider}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          placeholder="Enter your API key"
                          value={settings.brainApiKey || ''}
                          onChange={(e) => setSettings(s => ({ ...s, brainApiKey: e.target.value }))}
                          className="flex-1"
                        />
                        <button
                          onClick={() => validateApiKey(settings.preferredBrainProvider!, settings.brainApiKey!)}
                          disabled={isValidatingKey || !settings.brainApiKey}
                          className="btn-secondary text-sm"
                        >
                          {isValidatingKey ? 'Validating...' : 'Validate'}
                        </button>
                      </div>

                      {keyValidation && (
                        <p className={`text-xs mt-2 ${keyValidation.valid ? 'text-green-400' : 'text-red-400'}`}>
                          {keyValidation.valid ? '✓ API key is valid' : `✗ ${keyValidation.error}`}
                        </p>
                      )}

                      {/* Provider-specific instructions */}
                      <div className="mt-3 text-xs text-zenna-muted">
                        {settings.preferredBrainProvider === 'claude' && (
                          <p>Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-zenna-accent hover:underline">Anthropic Console</a></p>
                        )}
                        {settings.preferredBrainProvider === 'openai' && (
                          <p>Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-zenna-accent hover:underline">OpenAI Platform</a></p>
                        )}
                        {settings.preferredBrainProvider === 'gemini-2.5-pro' && (
                          <p>Get your API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-zenna-accent hover:underline">Google AI Studio</a></p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <div className="space-y-6">
              {/* Philips Hue */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center">
                    Philips Hue
                    <InfoTooltip
                      title="Philips Hue"
                      description="Connect your Hue Bridge to control lights with voice commands."
                      howTo="Press the button on your Hue Bridge, then click Connect."
                    />
                  </h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    settings.integrations?.hue
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-zenna-surface text-zenna-muted'
                  }`}>
                    {settings.integrations?.hue ? 'Connected' : 'Not Connected'}
                  </span>
                </div>

                {settings.integrations?.hue ? (
                  <div className="text-sm text-zenna-muted">
                    <p>Bridge IP: {settings.integrations.hue.bridgeIp}</p>
                    <button
                      onClick={() => saveSettings({ integrations: { ...settings.integrations, hue: undefined } })}
                      className="text-red-400 text-xs mt-2 hover:underline"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={connectHueBridge}
                    disabled={hueStatus === 'connecting'}
                    className="btn-secondary text-sm"
                  >
                    {hueStatus === 'connecting' ? 'Connecting...' : 'Connect Hue Bridge'}
                  </button>
                )}
              </div>

              {/* UniFi Protect (Stubbed) */}
              <div className="glass-card p-4 opacity-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">UniFi Protect</h3>
                  <span className="text-xs px-2 py-1 rounded-full bg-zenna-surface text-zenna-muted">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-zenna-muted">
                  Integration with UniFi Protect cameras will be available in a future update.
                </p>
              </div>

              {/* Lutron Caséta (Stubbed) */}
              <div className="glass-card p-4 opacity-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Lutron Caséta</h3>
                  <span className="text-xs px-2 py-1 rounded-full bg-zenna-surface text-zenna-muted">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-zenna-muted">
                  Integration with Lutron Caséta Pro will be available in a future update.
                </p>
              </div>

              {/* SmartThings (Stubbed) */}
              <div className="glass-card p-4 opacity-50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">SmartThings</h3>
                  <span className="text-xs px-2 py-1 rounded-full bg-zenna-surface text-zenna-muted">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-zenna-muted">
                  Integration with Samsung SmartThings will be available in a future update.
                </p>
              </div>
            </div>
          )}

          {/* Master Tab (Father only) */}
          {activeTab === 'master' && isFather && (
            <div className="space-y-6">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-yellow-400">
                  ⚠️ Master settings affect all users. Changes here define Zenna's core behavior.
                </p>
              </div>

              <p className="text-sm text-zenna-muted">
                Master Prompt configuration panel is available in the admin API.
                Full UI implementation coming soon.
              </p>

              {/* Placeholder for master config UI */}
              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3">System Prompt</h3>
                <p className="text-xs text-zenna-muted">
                  Define Zenna's core behavior, personality, and guardrails.
                </p>
              </div>

              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3">Voice Configuration</h3>
                <p className="text-xs text-zenna-muted">
                  Configure ElevenLabs Voice ID and API settings.
                </p>
              </div>

              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3">User Management</h3>
                <p className="text-xs text-zenna-muted">
                  Add, remove, and manage user accounts.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
