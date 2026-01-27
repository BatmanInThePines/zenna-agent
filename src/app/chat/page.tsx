'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Avatar, { type EmotionType } from '@/components/Avatar';
import Transcript from '@/components/Transcript';
import ArtifactCanvas from '@/components/ArtifactCanvas';
import ChatInput from '@/components/ChatInput';
import SettingsPanel from '@/components/SettingsPanel';
import KnowledgeIngestionIndicator from '@/components/KnowledgeIngestionIndicator';
import { INTEGRATION_MANIFESTS, getIntegrationEducation } from '@/core/interfaces/integration-manifest';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type ZennaState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

// Wrapper component to handle Suspense for useSearchParams
function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [zennaState, setZennaState] = useState<ZennaState>('idle');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ type: string; content: unknown }>>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionType>('neutral');

  // Integration onboarding state
  const [newIntegration, setNewIntegration] = useState<string | null>(null);
  const [showEducationPrompt, setShowEducationPrompt] = useState(false);
  const [pendingEducationIntegration, setPendingEducationIntegration] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Check authentication and load settings
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (!data.authenticated) {
          router.push('/login');
          return;
        }

        setIsAuthenticated(true);

        // Load avatar settings (user's personal avatar or master default)
        const [settingsRes, avatarRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/settings/avatar'),
        ]);

        const settingsData = await settingsRes.json();
        const avatarData = await avatarRes.json();

        // Use personal avatar if set, otherwise use master default
        if (settingsData.settings?.avatarUrl) {
          setAvatarUrl(settingsData.settings.avatarUrl);
        } else if (avatarData.avatarUrl) {
          setAvatarUrl(avatarData.avatarUrl);
        }
      } catch {
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  // State to control which settings tab to open
  const [initialSettingsTab, setInitialSettingsTab] = useState<string | null>(null);

  // Handle new integration connection - trigger glow and education prompt
  // (Defined before useEffect that uses it)
  const handleNewIntegration = useCallback((integrationId: string) => {
    const manifest = INTEGRATION_MANIFESTS[integrationId];
    if (!manifest) return;

    // Trigger avatar celebration glow
    setNewIntegration(integrationId);
    setCurrentEmotion('joy');

    // Show education prompt after a short delay
    setTimeout(() => {
      setPendingEducationIntegration(integrationId);
      setShowEducationPrompt(true);
    }, 1500);

    // Clear glow after 10 seconds if user doesn't respond
    setTimeout(() => {
      setNewIntegration(null);
    }, 10000);
  }, []);

  // Check for new integration connections from URL params
  useEffect(() => {
    const hueConnected = searchParams.get('hue_connected');
    const notionConnected = searchParams.get('notion_connected');
    const openSettings = searchParams.get('open_settings');

    if (hueConnected === 'true') {
      handleNewIntegration('hue');
      // Open settings to integrations tab if requested
      if (openSettings === 'integrations') {
        setInitialSettingsTab('integrations');
        setIsSettingsOpen(true);
      }
      // Clean URL without reloading
      window.history.replaceState({}, '', '/chat');
    } else if (notionConnected === 'true') {
      handleNewIntegration('notion');
      // Open settings to integrations tab if requested
      if (openSettings === 'integrations') {
        setInitialSettingsTab('integrations');
        setIsSettingsOpen(true);
      }
      window.history.replaceState({}, '', '/chat');
    }
  }, [searchParams, handleNewIntegration]);

  // Handle education response
  const handleEducationResponse = useCallback(async (accepted: boolean) => {
    setShowEducationPrompt(false);

    if (accepted && pendingEducationIntegration) {
      // Generate education content
      const education = getIntegrationEducation(pendingEducationIntegration);
      const manifest = INTEGRATION_MANIFESTS[pendingEducationIntegration];

      // Add Zenna's education message
      const educationMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: education,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, educationMessage]);
      setZennaState('speaking');
      setCurrentEmotion('helpful');

      // Optionally speak the education (summarized version)
      try {
        // Ensure audio context is resumed
        if (audioContextRef.current?.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        const response = await fetch('/api/zenna/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Great news! I'm now connected to your ${manifest?.name}. ${manifest?.description} Would you like me to show you what I can do?`,
          }),
        });

        const data = await response.json();
        console.log('Education speak response:', { hasAudioUrl: !!data.audioUrl, success: data.success });

        if (data.audioUrl) {
          const audio = new Audio(data.audioUrl);
          audio.onended = () => {
            console.log('Education audio ended');
            setZennaState('idle');
          };
          audio.onerror = (e) => {
            console.error('Education audio error:', e);
            setZennaState('idle');
          };
          await audio.play().catch((err) => {
            console.error('Education audio play failed:', err);
            setZennaState('idle');
          });
        } else {
          console.warn('No audio URL returned from speak API for education');
          setZennaState('idle');
        }
      } catch (error) {
        console.error('Education speak error:', error);
        setZennaState('idle');
      }
    }

    // Clear the glow effect
    setNewIntegration(null);
    setPendingEducationIntegration(null);
  }, [pendingEducationIntegration]);

  // Start session handler - called when user clicks "Begin Session"
  const handleStartSession = useCallback(async () => {
    // Initialize audio context on user interaction (required by browsers)
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    setIsSessionStarted(true);

    try {
      // Get greeting and play it
      const response = await fetch('/api/zenna/greet', { method: 'POST' });
      const data = await response.json();

      if (data.greeting) {
        setZennaState('speaking');

        // Set greeting emotion
        if (data.emotion) {
          setCurrentEmotion(data.emotion as EmotionType);
        }

        // Add greeting to messages
        setMessages([{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.greeting,
          timestamp: new Date(),
        }]);

        // Play audio if available
        if (data.audioUrl) {
          const audio = new Audio(data.audioUrl);
          audio.onended = () => setZennaState('idle');
          await audio.play().catch((err) => {
            console.error('Audio playback failed:', err);
            setZennaState('idle');
          });
        } else {
          setZennaState('idle');
        }
      }
    } catch (error) {
      console.error('Failed to initialize Zenna:', error);
      setZennaState('idle');
    }
  }, []);

  // Handle user message (from voice or text)
  const handleUserMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Ensure audio context is initialized (may not have been if user typed first message)
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext();
        console.log('AudioContext initialized for chat');
      } catch (err) {
        console.warn('Failed to create AudioContext:', err);
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentTranscript('');
    setZennaState('thinking');
    setCurrentEmotion('thoughtful'); // Processing when thinking

    try {
      const response = await fetch('/api/zenna/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json();

      if (data.response) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
        setZennaState('speaking');

        // Update emotion based on response analysis
        if (data.emotion) {
          setCurrentEmotion(data.emotion as EmotionType);
        }

        // Play audio response
        if (data.audioUrl) {
          try {
            // Ensure audio context is resumed (required after first user interaction)
            if (audioContextRef.current?.state === 'suspended') {
              await audioContextRef.current.resume();
            }

            const audio = new Audio(data.audioUrl);

            // Log audio details for debugging
            console.log('Playing chat audio response:', {
              audioUrlLength: data.audioUrl.length,
              audioUrlPrefix: data.audioUrl.substring(0, 50),
            });

            audio.onended = () => {
              console.log('Chat audio playback ended');
              setZennaState('idle');
            };
            audio.onerror = (e) => {
              console.error('Audio playback error:', e);
              setZennaState('idle');
            };
            audio.oncanplaythrough = () => {
              console.log('Audio can play through, starting playback...');
            };

            await audio.play();
            console.log('Chat audio play() called successfully');
          } catch (err) {
            console.error('Audio playback failed:', err);
            setZennaState('idle');
          }
        } else {
          console.warn('No audio URL returned from chat API - check ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID env vars');
          setZennaState('idle');
        }

        // Handle any artifacts
        if (data.artifacts) {
          setArtifacts(prev => [...prev, ...data.artifacts]);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setZennaState('error');
      setTimeout(() => setZennaState('idle'), 3000);
    }
  }, []);

  // Handle microphone button click - record and transcribe
  const handleMicClick = useCallback(async () => {
    if (zennaState === 'listening') {
      // Stop listening and process recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Initialize audio context if needed
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      setZennaState('listening');
      setCurrentEmotion('curious'); // Attentive when listening
      setCurrentTranscript('Recording...');
      audioChunksRef.current = [];

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        setCurrentTranscript('Transcribing...');
        setZennaState('thinking');

        // Combine audio chunks into a single blob
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        try {
          // Send to transcription API
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const response = await fetch('/api/zenna/transcribe', {
            method: 'POST',
            body: formData,
          });

          const data = await response.json();

          if (data.transcript && data.transcript.trim()) {
            setCurrentTranscript(data.transcript);
            // Process the transcript as a message
            handleUserMessage(data.transcript);
          } else {
            setCurrentTranscript('');
            setZennaState('idle');
          }
        } catch (error) {
          console.error('Transcription error:', error);
          setCurrentTranscript('');
          setZennaState('error');
          setTimeout(() => setZennaState('idle'), 3000);
        }
      };

      // Start recording
      mediaRecorder.start(100);

    } catch (error) {
      console.error('Microphone access denied:', error);
      setZennaState('error');
      setTimeout(() => setZennaState('idle'), 3000);
    }
  }, [zennaState, handleUserMessage]);

  // Handle text input submission
  const handleTextSubmit = useCallback((text: string) => {
    handleUserMessage(text);
  }, [handleUserMessage]);

  // Handle logout
  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }, [router]);

  // Handle Notion knowledge ingestion completion
  const handleIngestionComplete = useCallback(async () => {
    // Add completion message to transcript
    const completionMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: "Your Notion workspace has been successfully connected. I'm ready to answer questions about your content.",
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, completionMessage]);
    setZennaState('speaking');
    setCurrentEmotion('joy');

    // Trigger TTS announcement
    try {
      // Ensure audio context is resumed
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const response = await fetch('/api/zenna/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: "Your Notion workspace has been successfully connected. I'm ready to answer questions about your content.",
        }),
      });

      const data = await response.json();
      console.log('Ingestion completion speak response:', { hasAudioUrl: !!data.audioUrl, success: data.success });

      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.onended = () => {
          console.log('Ingestion completion audio ended');
          setZennaState('idle');
          setCurrentEmotion('helpful');
        };
        audio.onerror = (e) => {
          console.error('Ingestion completion audio error:', e);
          setZennaState('idle');
          setCurrentEmotion('helpful');
        };
        await audio.play().catch((err) => {
          console.error('Ingestion completion audio play failed:', err);
          setZennaState('idle');
          setCurrentEmotion('helpful');
        });
      } else {
        console.warn('No audio URL returned from speak API for ingestion completion');
        setZennaState('idle');
        setCurrentEmotion('helpful');
      }
    } catch (error) {
      console.error('Failed to speak ingestion completion:', error);
      setZennaState('idle');
      setCurrentEmotion('helpful');
    }
  }, []);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-zenna-muted">Loading Zenna...</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // Show "Begin Session" screen before starting
  if (!isSessionStarted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-zenna-bg to-black">
        <div className="text-center">
          <h1 className="text-4xl font-light tracking-widest mb-4">ZENNA</h1>
          <p className="text-zenna-muted mb-8">Voice-first AI Assistant</p>

          <button
            onClick={handleStartSession}
            className="px-8 py-4 bg-zenna-accent hover:bg-indigo-600 rounded-full text-lg font-medium transition-all transform hover:scale-105 flex items-center gap-3 mx-auto"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Begin Session
          </button>

          <p className="text-xs text-zenna-muted mt-6">
            Click to enable voice interaction
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Knowledge Ingestion Progress Indicator */}
      <KnowledgeIngestionIndicator onIngestionComplete={handleIngestionComplete} />

      {/* Header */}
      <header className="h-16 border-b border-zenna-border flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-light tracking-wider">ZENNA</h1>
          <span className={`text-xs px-2 py-1 rounded-full ${
            zennaState === 'listening' ? 'bg-green-500/20 text-green-400' :
            zennaState === 'thinking' ? 'bg-yellow-500/20 text-yellow-400' :
            zennaState === 'speaking' ? 'bg-blue-500/20 text-blue-400' :
            zennaState === 'error' ? 'bg-red-500/20 text-red-400' :
            'bg-zenna-surface text-zenna-muted'
          }`}>
            {zennaState.charAt(0).toUpperCase() + zennaState.slice(1)}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 hover:bg-zenna-surface rounded-lg transition-colors"
            aria-label="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          <button
            onClick={handleLogout}
            className="text-sm text-zenna-muted hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Panel - Avatar (Fixed Position) */}
        <div className="fixed left-0 top-16 bottom-0 w-[40%] min-w-[300px] max-w-[500px] border-r border-zenna-border flex flex-col bg-zenna-bg z-10 overflow-hidden">
          {/* Avatar fills the panel */}
          <div className="flex-1 w-full flex items-center justify-center overflow-hidden">
            <Avatar state={zennaState} avatarUrl={avatarUrl} emotion={currentEmotion} newIntegration={newIntegration} fillContainer />
          </div>

          {/* Microphone Button - anchored at bottom */}
          <div className="flex flex-col items-center pb-8 pt-4 flex-shrink-0">
            <button
              onClick={handleMicClick}
              disabled={zennaState === 'thinking' || zennaState === 'speaking'}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all relative ${
                zennaState === 'listening'
                  ? 'bg-red-500 hover:bg-red-600 voice-pulse'
                  : 'bg-zenna-accent hover:bg-indigo-600'
              } ${(zennaState === 'thinking' || zennaState === 'speaking') ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {zennaState === 'listening' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                )}
              </svg>
            </button>

            {/* Current transcript preview */}
            {currentTranscript && (
              <p className="mt-4 text-sm text-zenna-muted text-center max-w-[250px] truncate">
                "{currentTranscript}"
              </p>
            )}
          </div>
        </div>

        {/* Spacer for fixed left panel */}
        <div className="w-[40%] min-w-[300px] max-w-[500px] flex-shrink-0" />

        {/* Right Panel - Transcript & Artifacts */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs or split view for transcript/artifacts */}
          <div className="flex-1 overflow-hidden flex">
            {/* Transcript with Chat Input at top */}
            <div className={`${artifacts.length > 0 ? 'w-1/2' : 'w-full'} overflow-hidden flex flex-col`}>
              <Transcript
                messages={messages}
                chatInput={
                  <ChatInput
                    onSubmit={handleTextSubmit}
                    disabled={zennaState === 'listening' || zennaState === 'thinking' || zennaState === 'speaking'}
                  />
                }
              />
            </div>

            {/* Artifact Canvas */}
            {artifacts.length > 0 && (
              <div className="w-1/2 border-l border-zenna-border overflow-hidden">
                <ArtifactCanvas artifacts={artifacts} onClose={() => setArtifacts([])} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <SettingsPanel
          onClose={() => {
            setIsSettingsOpen(false);
            setInitialSettingsTab(null);
          }}
          initialTab={initialSettingsTab as 'general' | 'llm' | 'integrations' | 'master' | undefined}
        />
      )}

      {/* Integration Education Prompt */}
      {showEducationPrompt && pendingEducationIntegration && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zenna-surface border border-zenna-border rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            {/* Integration Icon */}
            <div className="text-center mb-4">
              <span className="text-5xl">
                {INTEGRATION_MANIFESTS[pendingEducationIntegration]?.icon || '🔗'}
              </span>
            </div>

            {/* Title */}
            <h2 className="text-xl font-medium text-center mb-2">
              {INTEGRATION_MANIFESTS[pendingEducationIntegration]?.name} Connected!
            </h2>

            {/* Question */}
            <p className="text-zenna-muted text-center mb-6">
              Would you like me to educate you on what I can do with this new integration?
            </p>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleEducationResponse(false)}
                className="flex-1 px-4 py-3 border border-zenna-border rounded-xl hover:bg-zenna-border/50 transition-colors"
              >
                Maybe Later
              </button>
              <button
                onClick={() => handleEducationResponse(true)}
                className="flex-1 px-4 py-3 bg-zenna-accent hover:bg-indigo-600 rounded-xl transition-colors font-medium"
              >
                Yes, Show Me!
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Main export with Suspense boundary for useSearchParams
export default function ChatPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-zenna-muted">Loading Zenna...</p>
        </div>
      </main>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
