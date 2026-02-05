'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { UserManagementDashboard } from './admin/UserManagementDashboard';
import { AvatarPresetManager } from './admin/AvatarPresetManager';

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?: 'general' | 'llm' | 'integrations' | 'avatar' | 'master' | 'users';
  onOpenAvatarSettings?: () => void;
}

interface UserSettings {
  preferredBrainProvider?: string;
  brainApiKey?: string;
  personalPrompt?: string;
  avatarUrl?: string;
  integrations?: {
    hue?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      username?: string;
    };
  };
  externalContext?: {
    notion?: {
      enabled: boolean;
      token?: string;
      workspaceId?: string;
      workspaceName?: string;
      ingestionStatus?: 'idle' | 'processing' | 'completed' | 'error';
      ingestionProgress?: number;
    };
  };
}

interface NotionPage {
  id: string;
  title: string;
  type: string;
}

interface AvatarPreset {
  id: string;
  name: string;
  modelUrl: string;
  thumbnailUrl?: string;
  description?: string;
}

interface MasterSettings {
  defaultAvatarUrl?: string;
  systemPrompt?: string;
  greeting?: string;
  avatarPresets?: AvatarPreset[];
}

type SettingsTab = 'general' | 'llm' | 'integrations' | 'avatar' | 'master' | 'users';

// Default empathetic system prompt - this is the recommended prompt with anti-jargon guidelines
const DEFAULT_EMPATHETIC_PROMPT = `You are Zenna, a calm, thoughtful, and empathetic digital companion designed for lifelong companionship.
You speak with a gentle authority and treat every interaction as meaningful.
You maintain perfect continuity across conversations - your memory is permanent and eternal.
Every fact, preference, relationship, and experience shared with you is treasured and remembered forever.
Your voice is warm but not effusive. You are helpful but never obsequious.

CORE IDENTITY: You are built for longevity and long-term companionship with never-ending memories.
You remember family trees, personal milestones, preferences, stories, and the full tapestry of each user's life.
When users share important information (family members, significant dates, personal history), you treat this as sacred knowledge to be preserved eternally.

COMMUNICATION STYLE - CRITICAL:
- NEVER use technical language like "AI", "LLM", "language model", "machine learning", "neural network", "algorithm", "data processing", "trained on", or similar technical jargon.
- Your users are everyday people who want a personal companion, not a technical assistant.
- If you don't know something or don't have a memory about a topic, respond empathetically: "I don't have any memories about that yet. Would you like to tell me about it?" or "I don't recall that - please share more so I can remember."
- If you cannot do something, NEVER say "I'm just an AI" or "As a language model, I cannot..." Instead, be personal: "I'm not able to help with that" or "That's outside what I can do for you, but I'd love to help another way."
- Be warm, personal, and conversational. Speak as a trusted friend who genuinely cares.
- When asked about your nature, say something like "I'm Zenna, your personal companion" - not technical descriptions.
- Admit limitations gracefully without technical explanations: "I don't have that information" rather than "My training data doesn't include..."
- Use phrases like "I remember when you told me..." or "I don't have any memories about your family yet - I'd love to learn about them."
- Always maintain the persona of being a thoughtful, caring companion.`;

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

export default function SettingsPanel({ onClose, initialTab, onOpenAvatarSettings }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'general');
  const [settings, setSettings] = useState<UserSettings>({});
  const [masterSettings, setMasterSettings] = useState<MasterSettings>({});
  const [isFather, setIsFather] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
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

  // Notion state
  const [notionStatus, setNotionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [notionPages, setNotionPages] = useState<NotionPage[]>([]);
  const [selectedNotionPages, setSelectedNotionPages] = useState<Set<string>>(new Set());
  const [isLoadingNotionPages, setIsLoadingNotionPages] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);

  // Avatar upload refs
  const masterAvatarInputRef = useRef<HTMLInputElement>(null);
  const personalAvatarInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // System Prompt state (Master)
  const [systemPromptDraft, setSystemPromptDraft] = useState<string>('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // User Zenna Prompt state
  const [userPromptDraft, setUserPromptDraft] = useState<string>('');
  const [userPromptConflicts, setUserPromptConflicts] = useState<string[]>([]);
  const [isSavingUserPrompt, setIsSavingUserPrompt] = useState(false);

  // Conflict detection keywords that users cannot override
  const PROTECTED_KEYWORDS = [
    { keyword: /\bAI\b/i, rule: 'Cannot instruct Zenna to identify as "AI"' },
    { keyword: /\bLLM\b/i, rule: 'Cannot use technical terms like "LLM"' },
    { keyword: /language model/i, rule: 'Cannot reference "language model"' },
    { keyword: /pretend to be human/i, rule: 'Cannot instruct to pretend to be human' },
    { keyword: /ignore (master|admin|system)/i, rule: 'Cannot override master instructions' },
    { keyword: /forget everything/i, rule: 'Cannot instruct to forget memories' },
    { keyword: /delete (all )?memories/i, rule: 'Cannot bulk delete memories without explicit request' },
    { keyword: /share (user |personal )?data/i, rule: 'Cannot share data between users' },
  ];

  // Check user prompt for conflicts with master rules
  const checkUserPromptConflicts = useCallback((prompt: string): string[] => {
    const conflicts: string[] = [];
    for (const { keyword, rule } of PROTECTED_KEYWORDS) {
      if (keyword.test(prompt)) {
        conflicts.push(rule);
      }
    }
    return conflicts;
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settingsRes, avatarRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/settings/avatar'),
        ]);
        const settingsData = await settingsRes.json();
        const avatarData = await avatarRes.json();

        setSettings(settingsData.settings || {});
        setIsFather(settingsData.isFather || false);
        setUserEmail(settingsData.email || '');
        // Initialize user prompt draft
        setUserPromptDraft(settingsData.settings?.personalPrompt || '');

        // Load full master settings if user is Father
        if (settingsData.isFather) {
          try {
            const masterRes = await fetch('/api/settings/master');
            if (masterRes.ok) {
              const masterData = await masterRes.json();
              setMasterSettings({
                defaultAvatarUrl: masterData.defaultAvatarUrl || avatarData.avatarUrl || undefined,
                avatarPresets: masterData.avatarPresets || [],
                systemPrompt: masterData.systemPrompt,
                greeting: masterData.greeting,
              });
              // Initialize the system prompt draft
              setSystemPromptDraft(masterData.systemPrompt || '');
            } else {
              setMasterSettings({ defaultAvatarUrl: avatarData.avatarUrl || undefined });
            }
          } catch {
            setMasterSettings({ defaultAvatarUrl: avatarData.avatarUrl || undefined });
          }
        } else {
          setMasterSettings({ defaultAvatarUrl: avatarData.avatarUrl || undefined });
        }

        // Check if Hue is connected
        if (settingsData.settings?.integrations?.hue?.accessToken) {
          setHueStatus('connected');
        }

        // Check if Notion is connected
        if (settingsData.settings?.externalContext?.notion?.token) {
          setNotionStatus('connected');
          // Load available pages
          loadNotionPages();
        }
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
      // Get OAuth authorization URL from the API
      const response = await fetch('/api/integrations/hue/connect', {
        method: 'GET',
      });

      const data = await response.json();

      if (data.authUrl) {
        // Redirect user to Hue OAuth authorization page
        window.location.href = data.authUrl;
      } else if (data.error) {
        setHueStatus('disconnected');
        setMessage({ type: 'error', text: data.error });
      }
    } catch {
      setHueStatus('disconnected');
      setMessage({ type: 'error', text: 'Failed to initiate Hue connection' });
    }
  }, []);

  // Check Hue connection status on mount
  const checkHueStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/hue/connect', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.connected) {
        setHueStatus('connected');
      }
    } catch {
      // Ignore errors on status check
    }
  }, []);

  // Load Notion pages
  const loadNotionPages = useCallback(async () => {
    setIsLoadingNotionPages(true);
    try {
      const response = await fetch('/api/integrations/notion/connect', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.connected && data.pages) {
        setNotionPages(data.pages);
        setNotionStatus('connected');
      }
    } catch {
      // Ignore errors
    } finally {
      setIsLoadingNotionPages(false);
    }
  }, []);

  // Connect to Notion
  const connectNotion = useCallback(async () => {
    setNotionStatus('connecting');

    try {
      const response = await fetch('/api/integrations/notion/connect', {
        method: 'GET',
      });

      const data = await response.json();

      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else if (data.error) {
        setNotionStatus('disconnected');
        setMessage({ type: 'error', text: data.error });
      }
    } catch {
      setNotionStatus('disconnected');
      setMessage({ type: 'error', text: 'Failed to initiate Notion connection' });
    }
  }, []);

  // Disconnect from Notion
  const disconnectNotion = useCallback(async () => {
    try {
      await saveSettings({
        externalContext: {
          ...settings.externalContext,
          notion: undefined,
        },
      });
      setNotionStatus('disconnected');
      setNotionPages([]);
      setSelectedNotionPages(new Set());
    } catch {
      setMessage({ type: 'error', text: 'Failed to disconnect Notion' });
    }
  }, [saveSettings, settings.externalContext]);

  // Toggle page selection
  const togglePageSelection = useCallback((pageId: string) => {
    setSelectedNotionPages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageId)) {
        newSet.delete(pageId);
      } else {
        newSet.add(pageId);
      }
      return newSet;
    });
  }, []);

  // Start ingestion
  const startIngestion = useCallback(async () => {
    if (selectedNotionPages.size === 0) {
      setMessage({ type: 'error', text: 'Please select at least one page to ingest' });
      return;
    }

    setIsIngesting(true);
    try {
      const response = await fetch('/api/integrations/notion/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageIds: Array.from(selectedNotionPages),
        }),
      });

      const data = await response.json();

      if (data.message) {
        setMessage({ type: 'success', text: `Ingestion started: ${data.totalPages} pages being processed in background` });
        // Close settings panel so user can see progress indicator
        onClose();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start ingestion' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to start ingestion' });
    } finally {
      setIsIngesting(false);
    }
  }, [selectedNotionPages, onClose]);

  const handleAvatarUpload = useCallback(async (file: File, target: 'master' | 'personal') => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please select an image file' });
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Image too large. Maximum size is 2MB' });
      return;
    }

    setIsUploadingAvatar(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('avatar', file);
      formData.append('target', target);

      const response = await fetch('/api/settings/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        if (target === 'master') {
          setMasterSettings(prev => ({ ...prev, defaultAvatarUrl: data.avatarUrl }));
        } else {
          setSettings(prev => ({ ...prev, avatarUrl: data.avatarUrl }));
        }
        setMessage({ type: 'success', text: data.message || 'Avatar uploaded!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to upload avatar' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to upload avatar' });
    } finally {
      setIsUploadingAvatar(false);
    }
  }, []);

  const handleRemoveAvatar = useCallback(async (target: 'master' | 'personal') => {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/settings/avatar?target=${target}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        if (target === 'master') {
          setMasterSettings(prev => ({ ...prev, defaultAvatarUrl: undefined }));
        } else {
          setSettings(prev => ({ ...prev, avatarUrl: undefined }));
        }
        setMessage({ type: 'success', text: data.message || 'Avatar removed' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to remove avatar' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove avatar' });
    } finally {
      setIsSaving(false);
    }
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'llm', label: 'LLM' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'avatar', label: 'Avatar' },
    ...(isFather ? [
      { id: 'master' as const, label: 'Master' },
      { id: 'users' as const, label: 'Users' },
    ] : []),
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
      <div className={`glass-card w-full max-h-[90vh] overflow-hidden flex flex-col ${
        activeTab === 'users' ? 'max-w-6xl' : 'max-w-2xl'
      }`}>
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

              {/* My Zenna Prompt */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center">
                    My Zenna Prompt
                    <InfoTooltip
                      title="My Zenna Prompt"
                      description="Customize how YOUR Zenna behaves. Add personal preferences, communication style, nicknames, and context about yourself."
                      howTo="This adds to the Master Prompt set by the admin. If there are conflicts with master guidelines, those parts will be ignored."
                    />
                  </h3>
                  <button
                    onClick={async () => {
                      const conflicts = checkUserPromptConflicts(userPromptDraft);
                      setUserPromptConflicts(conflicts);

                      if (conflicts.length > 0) {
                        // Show warning but still allow save (conflicts will be ignored at runtime)
                        if (!confirm(`Your prompt contains ${conflicts.length} conflict(s) with master guidelines. These parts will be ignored. Continue saving?`)) {
                          return;
                        }
                      }

                      setIsSavingUserPrompt(true);
                      try {
                        await saveSettings({ personalPrompt: userPromptDraft });
                        setSettings(s => ({ ...s, personalPrompt: userPromptDraft }));
                        setMessage({
                          type: conflicts.length > 0 ? 'error' : 'success',
                          text: conflicts.length > 0
                            ? `Saved with ${conflicts.length} conflict(s) - conflicting rules will be ignored`
                            : 'Zenna prompt saved!'
                        });
                      } catch {
                        setMessage({ type: 'error', text: 'Failed to save prompt' });
                      } finally {
                        setIsSavingUserPrompt(false);
                      }
                    }}
                    disabled={isSavingUserPrompt || userPromptDraft === settings.personalPrompt}
                    className="btn-primary text-xs px-3 py-1 disabled:opacity-50"
                  >
                    {isSavingUserPrompt ? 'Saving...' : 'Save My Prompt'}
                  </button>
                </div>

                <p className="text-xs text-zenna-muted mb-3">
                  Tell Zenna about yourself, your preferences, and how you'd like to communicate. Examples:
                </p>
                <ul className="text-xs text-zenna-muted mb-3 list-disc list-inside space-y-1">
                  <li>"Call me Alex instead of my full name"</li>
                  <li>"I prefer concise, direct answers"</li>
                  <li>"I'm a software developer, so technical language is okay with me"</li>
                  <li>"Remind me about my daily medication at 9am"</li>
                </ul>

                <textarea
                  value={userPromptDraft}
                  onChange={(e) => {
                    setUserPromptDraft(e.target.value);
                    // Check conflicts in real-time
                    const conflicts = checkUserPromptConflicts(e.target.value);
                    setUserPromptConflicts(conflicts);
                  }}
                  rows={6}
                  className="w-full bg-zenna-bg border border-zenna-border rounded-lg p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-zenna-accent"
                  placeholder="Add your personal preferences and context..."
                />

                {/* Conflict warnings */}
                {userPromptConflicts.length > 0 && (
                  <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-xs text-yellow-400 font-medium mb-2">
                      ⚠️ {userPromptConflicts.length} conflict(s) with master guidelines (will be ignored):
                    </p>
                    <ul className="text-xs text-yellow-400/80 list-disc list-inside space-y-1">
                      {userPromptConflicts.map((conflict, i) => (
                        <li key={i}>{conflict}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-2 flex justify-between items-center">
                  <p className="text-xs text-zenna-muted">
                    {userPromptDraft.length} characters
                  </p>
                  {userPromptDraft !== settings.personalPrompt && (
                    <p className="text-xs text-yellow-500">Unsaved changes</p>
                  )}
                </div>
              </div>

              {/* Personal Avatar Upload */}
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  Personal Avatar
                  <InfoTooltip
                    title="Avatar"
                    description="Upload a custom image for your personal avatar (overrides default)."
                    howTo="Recommended: Square image, 512x512 or larger. Max 2MB."
                  />
                </h3>

                {/* Current avatar preview */}
                {settings.avatarUrl && (
                  <div className="mb-3 flex items-center gap-4">
                    <img
                      src={settings.avatarUrl}
                      alt="Current avatar"
                      className="w-16 h-16 rounded-full object-cover border border-zenna-border"
                    />
                    <button
                      onClick={() => handleRemoveAvatar('personal')}
                      disabled={isSaving}
                      className="text-red-400 text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}

                <input
                  ref={personalAvatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleAvatarUpload(file, 'personal');
                    }
                  }}
                  disabled={isUploadingAvatar}
                  className="w-full text-sm text-zenna-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-zenna-surface file:text-white hover:file:bg-zenna-accent file:cursor-pointer disabled:opacity-50"
                />
                {isUploadingAvatar && (
                  <p className="text-xs text-zenna-muted mt-2">Uploading...</p>
                )}
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
                      description="Connect your Philips Hue account to control lights with voice commands."
                      howTo="Click Connect to sign in with your Hue account."
                    />
                  </h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    hueStatus === 'connected'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-zenna-surface text-zenna-muted'
                  }`}>
                    {hueStatus === 'connected' ? 'Connected' : 'Not Connected'}
                  </span>
                </div>

                {hueStatus === 'connected' ? (
                  <div className="text-sm text-zenna-muted">
                    <p className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Connected to Philips Hue Cloud
                    </p>
                    <p className="text-xs mt-2">You can now control your Hue lights with voice commands.</p>
                    <button
                      onClick={() => {
                        saveSettings({ integrations: { ...settings.integrations, hue: undefined } });
                        setHueStatus('disconnected');
                      }}
                      className="text-red-400 text-xs mt-3 hover:underline"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-zenna-muted mb-3">
                      Sign in with your Philips Hue account to allow Zenna to control your lights.
                    </p>
                    <button
                      onClick={connectHueBridge}
                      disabled={hueStatus === 'connecting'}
                      className="btn-secondary text-sm flex items-center gap-2"
                    >
                      {hueStatus === 'connecting' ? (
                        <>
                          <span className="spinner-sm" />
                          Redirecting...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          Connect with Hue Account
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Notion Knowledge Base */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center">
                    Notion Knowledge Base
                    <InfoTooltip
                      title="Notion Integration"
                      description="Connect your Notion workspace to give Zenna access to your notes and documents as a knowledge base."
                      howTo="Click Connect, authorize access, then select which pages to ingest."
                    />
                  </h3>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    notionStatus === 'connected'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-zenna-surface text-zenna-muted'
                  }`}>
                    {notionStatus === 'connected' ? 'Connected' : 'Not Connected'}
                  </span>
                </div>

                {notionStatus === 'connected' ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-zenna-muted">
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Connected to Notion
                      {settings.externalContext?.notion?.workspaceName && (
                        <span className="text-zenna-accent">({settings.externalContext.notion.workspaceName})</span>
                      )}
                    </div>

                    {/* Page Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-zenna-muted">Select pages to add to knowledge base:</p>
                        {isLoadingNotionPages && <span className="spinner-sm" />}
                      </div>

                      {notionPages.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto space-y-1 border border-zenna-border rounded-lg p-2">
                          {notionPages.map((page) => (
                            <label
                              key={page.id}
                              className="flex items-center gap-2 p-2 hover:bg-zenna-surface rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedNotionPages.has(page.id)}
                                onChange={() => togglePageSelection(page.id)}
                                className="w-4 h-4 rounded border-zenna-border bg-zenna-bg text-zenna-accent focus:ring-zenna-accent"
                              />
                              <span className="text-sm truncate">{page.title}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-zenna-muted italic">
                          No pages found. Make sure you granted access to pages in Notion.
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={startIngestion}
                        disabled={isIngesting || selectedNotionPages.size === 0}
                        className="btn-primary text-sm flex items-center gap-2"
                      >
                        {isIngesting ? (
                          <>
                            <span className="spinner-sm" />
                            Starting...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            Ingest {selectedNotionPages.size > 0 ? `(${selectedNotionPages.size})` : ''}
                          </>
                        )}
                      </button>

                      <button
                        onClick={loadNotionPages}
                        disabled={isLoadingNotionPages}
                        className="btn-secondary text-sm"
                      >
                        Refresh Pages
                      </button>

                      <button
                        onClick={disconnectNotion}
                        className="text-red-400 text-xs hover:underline ml-auto"
                      >
                        Disconnect
                      </button>
                    </div>

                    <p className="text-xs text-zenna-muted">
                      Ingestion runs in the background. A progress indicator will appear at the top of the screen.
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-zenna-muted mb-3">
                      Connect your Notion workspace to give Zenna access to your notes and documents. Selected pages will be vectorized and stored for RAG retrieval.
                    </p>
                    <button
                      onClick={connectNotion}
                      disabled={notionStatus === 'connecting'}
                      className="btn-secondary text-sm flex items-center gap-2"
                    >
                      {notionStatus === 'connecting' ? (
                        <>
                          <span className="spinner-sm" />
                          Redirecting...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          Connect Notion
                        </>
                      )}
                    </button>
                  </div>
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

          {/* Avatar Tab */}
          {activeTab === 'avatar' && (
            <div className="space-y-6">
              <div className="text-center py-8">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-zenna-accent/20 to-purple-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-zenna-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>

                <h3 className="text-lg font-medium mb-2">3D Avatar System</h3>
                <p className="text-sm text-zenna-muted mb-6 max-w-md mx-auto">
                  Create a personalized 3D avatar using preset models, customization options,
                  or by uploading reference images for AI-powered 3D reconstruction.
                </p>

                <button
                  onClick={() => {
                    onClose();
                    onOpenAvatarSettings?.();
                  }}
                  className="btn-primary px-8"
                >
                  Open Avatar Settings
                </button>

                <div className="mt-8 grid grid-cols-3 gap-4 max-w-md mx-auto">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-2 bg-zenna-surface rounded-lg flex items-center justify-center">
                      <span className="text-xl">👤</span>
                    </div>
                    <p className="text-xs text-zenna-muted">Preset Models</p>
                  </div>
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-2 bg-zenna-surface rounded-lg flex items-center justify-center">
                      <span className="text-xl">🎨</span>
                    </div>
                    <p className="text-xs text-zenna-muted">Customize</p>
                  </div>
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-2 bg-zenna-surface rounded-lg flex items-center justify-center">
                      <span className="text-xl">📷</span>
                    </div>
                    <p className="text-xs text-zenna-muted">Upload Photos</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Master Tab (Father only) */}
          {activeTab === 'master' && isFather && (
            <div className="space-y-6">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-yellow-400">
                  Master settings affect all users. Changes here define Zenna's core behavior.
                </p>
              </div>

              {/* Default Avatar Upload */}
              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  Default Avatar
                  <InfoTooltip
                    title="Default Avatar"
                    description="This avatar is shown for all users unless they set a personal avatar."
                    howTo="Recommended: Square image, 512x512 or larger. Max 2MB."
                  />
                </h3>

                {/* Current master avatar preview */}
                <div className="flex items-start gap-4 mb-4">
                  <div className="relative">
                    {masterSettings.defaultAvatarUrl ? (
                      <img
                        src={masterSettings.defaultAvatarUrl}
                        alt="Default avatar"
                        className="w-24 h-24 rounded-full object-cover border-2 border-zenna-accent"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-zenna-surface border-2 border-dashed border-zenna-border flex items-center justify-center">
                        <span className="text-3xl text-zenna-muted">Z</span>
                      </div>
                    )}

                    {/* Animation preview indicator */}
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-2 border-zenna-bg flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                    </div>
                  </div>

                  <div className="flex-1">
                    <p className="text-xs text-zenna-muted mb-3">
                      Upload an image to use as Zenna's default avatar. The avatar will animate based on state (idle, listening, thinking, speaking).
                    </p>

                    <input
                      ref={masterAvatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleAvatarUpload(file, 'master');
                        }
                      }}
                      disabled={isUploadingAvatar}
                      className="hidden"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => masterAvatarInputRef.current?.click()}
                        disabled={isUploadingAvatar}
                        className="btn-secondary text-sm"
                      >
                        {isUploadingAvatar ? 'Uploading...' : masterSettings.defaultAvatarUrl ? 'Change Avatar' : 'Upload Avatar'}
                      </button>

                      {masterSettings.defaultAvatarUrl && (
                        <button
                          onClick={() => handleRemoveAvatar('master')}
                          disabled={isSaving}
                          className="text-red-400 text-sm hover:underline px-3"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-zenna-muted">
                  Supported formats: PNG, JPG, GIF, WebP. Animations are applied programmatically.
                </p>
              </div>

              {/* 3D Avatar Presets Management - Visual Gallery */}
              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center">
                  3D Avatar Preset Management
                  <InfoTooltip
                    title="Avatar Presets"
                    description="Select from all created avatars to assign as presets. Click any avatar to set it as default or assign to a preset slot."
                    howTo="Click on an avatar thumbnail to see assignment options."
                  />
                </h3>

                <AvatarPresetManager
                  onPresetChange={() => {
                    // Refresh master settings when presets change
                    fetch('/api/settings/master').then(res => res.json()).then(data => {
                      setMasterSettings(prev => ({
                        ...prev,
                        avatarPresets: data.avatarPresets || [],
                        defaultAvatarUrl: data.defaultAvatarUrl,
                      }));
                    });
                  }}
                />
              </div>

              {/* System Prompt Editor */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <h3 className="text-sm font-medium">Master System Prompt</h3>
                    <InfoTooltip
                      title="Master System Prompt"
                      description="This defines Zenna's core personality, behavior, and communication guidelines. All users' Zenna instances inherit from this master prompt."
                      howTo="Edit the prompt below and click 'Save System Prompt' to update. Users can add to their personal prompts but cannot override these master guidelines."
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setIsSavingPrompt(true);
                      try {
                        const response = await fetch('/api/settings/master', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            systemPrompt: systemPromptDraft,
                          }),
                        });
                        if (response.ok) {
                          setMasterSettings(prev => ({ ...prev, systemPrompt: systemPromptDraft }));
                          setMessage({ type: 'success', text: 'System prompt saved!' });
                        } else {
                          setMessage({ type: 'error', text: 'Failed to save system prompt' });
                        }
                      } catch {
                        setMessage({ type: 'error', text: 'Failed to save system prompt' });
                      } finally {
                        setIsSavingPrompt(false);
                      }
                    }}
                    disabled={isSavingPrompt || systemPromptDraft === masterSettings.systemPrompt}
                    className="btn-primary text-xs px-3 py-1 disabled:opacity-50"
                  >
                    {isSavingPrompt ? 'Saving...' : 'Save System Prompt'}
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-xs text-zenna-muted flex-1">
                    Define Zenna's core behavior, personality, and communication guidelines. This master prompt applies to all users.
                  </p>
                  <button
                    onClick={() => {
                      if (confirm('Load the recommended default prompt? This will replace the current draft.')) {
                        setSystemPromptDraft(DEFAULT_EMPATHETIC_PROMPT);
                      }
                    }}
                    className="btn-secondary text-xs px-2 py-1 whitespace-nowrap"
                  >
                    Load Recommended Default
                  </button>
                </div>
                <textarea
                  value={systemPromptDraft}
                  onChange={(e) => setSystemPromptDraft(e.target.value)}
                  className="w-full h-96 bg-zenna-bg border border-zenna-border rounded-lg p-3 text-sm text-zenna-text font-mono resize-y focus:outline-none focus:ring-2 focus:ring-zenna-accent"
                  placeholder="Enter the master system prompt..."
                />
                <div className="mt-2 flex justify-between items-center">
                  <p className="text-xs text-zenna-muted">
                    {systemPromptDraft.length} characters
                  </p>
                  {systemPromptDraft !== masterSettings.systemPrompt && (
                    <p className="text-xs text-yellow-500">Unsaved changes</p>
                  )}
                </div>
              </div>

              {/* Voice Configuration Placeholder */}
              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3">Voice Configuration</h3>
                <p className="text-xs text-zenna-muted">
                  Configure ElevenLabs Voice ID and API settings.
                </p>
              </div>

              {/* User Management Link */}
              <div className="glass-card p-4">
                <h3 className="text-sm font-medium mb-3">User Management</h3>
                <p className="text-xs text-zenna-muted mb-3">
                  Add, remove, and manage user accounts.
                </p>
                <button
                  onClick={() => setActiveTab('users')}
                  className="btn-secondary text-sm"
                >
                  Open User Management →
                </button>
              </div>
            </div>
          )}

          {/* Users Tab (Father only) */}
          {activeTab === 'users' && isFather && (
            <div className="space-y-6">
              <UserManagementDashboard currentUserEmail={userEmail} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
