'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AvatarRenderer, AvatarSettings, type EmotionType } from '@/components/avatar';
import Transcript from '@/components/Transcript';
import ArtifactCanvas from '@/components/ArtifactCanvas';
import ChatInput from '@/components/ChatInput';
import SettingsPanel from '@/components/SettingsPanel';
import KnowledgeIngestionIndicator from '@/components/KnowledgeIngestionIndicator';
import VoiceControls from '@/components/VoiceControls';
import { INTEGRATION_MANIFESTS, getIntegrationEducation } from '@/core/interfaces/integration-manifest';
import GeolocationPrompt from '@/components/GeolocationPrompt';

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
  const [isSessionStarted, setIsSessionStarted] = useState(true); // Auto-start session - no landing page
  const [messages, setMessages] = useState<Message[]>([]);
  const [zennaState, setZennaState] = useState<ZennaState>('idle');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ type: string; content: unknown }>>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionType>('neutral');
  const [alwaysListening, setAlwaysListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isAvatarSettingsOpen, setIsAvatarSettingsOpen] = useState(false);
  const [avatarModelUrl, setAvatarModelUrl] = useState<string | undefined>(undefined);
  const [avatarModelType, setAvatarModelType] = useState<'preset' | 'custom' | 'reconstructed' | '2d-fallback'>('2d-fallback');
  const [pendingGreetingAudio, setPendingGreetingAudio] = useState<string | null>(null);
  const [showAudioPrompt, setShowAudioPrompt] = useState(false);

  // Thinking progress state
  const [thinkingStatus, setThinkingStatus] = useState<string>('');
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Integration onboarding state
  const [newIntegration, setNewIntegration] = useState<string | null>(null);
  const [showEducationPrompt, setShowEducationPrompt] = useState(false);
  const [pendingEducationIntegration, setPendingEducationIntegration] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hueManifest, setHueManifest] = useState<any>(null);

  // Geolocation state
  const [showGeolocationPrompt, setShowGeolocationPrompt] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
    city?: string;
    region?: string;
    country?: string;
  } | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // iOS detection for audio handling workarounds
  const isIOSRef = useRef<boolean>(false);
  useEffect(() => {
    isIOSRef.current = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number>(0);
  const isSpeakingRef = useRef(false);

  // Thinking elapsed timer — counts seconds while in thinking state
  useEffect(() => {
    if (zennaState === 'thinking') {
      setThinkingElapsed(0);
      setThinkingStatus('');
      thinkingTimerRef.current = setInterval(() => {
        setThinkingElapsed(prev => prev + 1);
      }, 1000);
    } else {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setThinkingElapsed(0);
      setThinkingStatus('');
    }
    return () => {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, [zennaState]);

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

        // Check if coming from paywall (with welcome param) or has active subscription
        const isFromPaywall = searchParams.get('welcome') === 'true';
        const hasActiveSubscription = data.user?.subscription?.status === 'active';

        // Redirect to paywall if user hasn't completed onboarding
        // BUT skip if coming from paywall with welcome param or has active subscription
        if (!data.user?.onboardingCompleted && !isFromPaywall && !hasActiveSubscription) {
          router.push('/paywall');
          return;
        }

        setIsAuthenticated(true);

        // Load avatar settings, and conversation history in parallel
        const [settingsRes, avatarRes, historyRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/settings/avatar'),
          fetch('/api/zenna/history?limit=100'),
        ]);

        const settingsData = await settingsRes.json();
        const avatarData = await avatarRes.json();
        const historyData = await historyRes.json();

        // Use personal avatar if set, otherwise use master default
        if (settingsData.settings?.avatarUrl) {
          setAvatarUrl(settingsData.settings.avatarUrl);
        } else if (avatarData.avatarUrl) {
          setAvatarUrl(avatarData.avatarUrl);
        }

        // Load 3D model settings (persisted from last session)
        if (settingsData.settings?.avatarModelUrl) {
          setAvatarModelUrl(settingsData.settings.avatarModelUrl);
        }
        if (settingsData.settings?.avatarModelType) {
          setAvatarModelType(settingsData.settings.avatarModelType);
        }

        // Load and refresh Hue manifest if connected
        if (settingsData.settings?.integrations?.hue?.accessToken) {
          const existingManifest = settingsData.settings.integrations.hue.manifest;
          if (existingManifest) {
            setHueManifest(existingManifest);
          }
          const ONE_HOUR = 60 * 60 * 1000;
          const isStale = !existingManifest || !existingManifest.fetchedAt || (Date.now() - existingManifest.fetchedAt > ONE_HOUR);
          if (isStale) {
            // Non-blocking refresh in background
            fetch('/api/integrations/hue/manifest', { method: 'POST' })
              .then(res => res.json())
              .then(data => {
                if (data.manifest) setHueManifest(data.manifest);
                console.log('[Chat] Hue manifest refreshed');
              })
              .catch((err: unknown) => console.warn('[Chat] Hue manifest refresh failed:', err));
          }
        }

        // Load conversation history from database
        // This ensures messages persist across page refreshes and sessions
        if (historyData.messages && historyData.messages.length > 0) {
          console.log(`[Chat] Loaded ${historyData.messages.length} messages from history`);
          const loadedMessages: Message[] = historyData.messages.map((msg: { id: string; role: 'user' | 'assistant'; content: string; timestamp: string }) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp),
          }));
          setMessages(loadedMessages);
        }

        // Show geolocation prompt after authentication
        // This runs after settings are loaded but before greeting
        setShowGeolocationPrompt(true);

        // Auto-start session: fetch greeting immediately after auth
        // But only if there's no existing conversation history
        try {
          const greetResponse = await fetch('/api/zenna/greet', { method: 'POST' });
          const greetData = await greetResponse.json();

          if (greetData.greeting) {
            setZennaState('speaking');

            if (greetData.emotion) {
              setCurrentEmotion(greetData.emotion as EmotionType);
            }

            // Only add greeting if no history exists (new user or cleared history)
            // This prevents duplicate greetings when returning to an existing conversation
            if (!historyData.messages || historyData.messages.length === 0) {
              setMessages([{
                id: crypto.randomUUID(),
                role: 'assistant',
                content: greetData.greeting,
                timestamp: new Date(),
              }]);
            }

            // Play audio if available (audio context will be initialized on user's first interaction)
            if (greetData.audioUrl) {
              const audio = new Audio(greetData.audioUrl);
              audio.onended = () => {
                setZennaState('idle');
                // Auto-enable always-listening after greeting completes
                setAlwaysListening(true);
              };

              // Try to play - if blocked by browser autoplay policy, show prompt
              audio.play().catch(() => {
                console.log('Audio autoplay blocked - showing prompt for user interaction');
                setPendingGreetingAudio(greetData.audioUrl);
                setShowAudioPrompt(true);
                setZennaState('idle');
              });
            } else {
              setZennaState('idle');
              // Even without audio, enable always-listening after auth check completes
              setAlwaysListening(true);
            }
          }
        } catch (greetError) {
          console.error('Failed to fetch greeting:', greetError);
          setZennaState('idle');
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

    if (hueConnected === 'true') {
      // Close settings if open -- announcement appears in transcript instead
      setIsSettingsOpen(false);
      handleNewIntegration('hue');
      window.history.replaceState({}, '', '/chat');
    } else if (notionConnected === 'true') {
      setIsSettingsOpen(false);
      handleNewIntegration('notion');
      window.history.replaceState({}, '', '/chat');
    }
  }, [searchParams, handleNewIntegration]);

  // Handle education response
  const handleEducationResponse = useCallback(async (accepted: boolean) => {
    setShowEducationPrompt(false);

    if (accepted && pendingEducationIntegration) {
      // Generate education content with real device names when available
      const education = getIntegrationEducation(
        pendingEducationIntegration,
        pendingEducationIntegration === 'hue' ? hueManifest : undefined
      );
      const manifest = INTEGRATION_MANIFESTS[pendingEducationIntegration];

      // Add Zenna's education message to transcript
      const educationMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: education,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, educationMessage]);
      setZennaState('speaking');
      setCurrentEmotion('helpful');

      // Build TTS summary with real room names if available
      const firstRoom = hueManifest?.rooms?.[0]?.name;
      const ttsText = firstRoom
        ? `Great news! I'm now connected to your ${manifest?.name}. I can see rooms like ${firstRoom} in your home. Check the transcript for all the things I can do. Want me to demo by changing your ${firstRoom} lights to navy blue?`
        : `Great news! I'm now connected to your ${manifest?.name}. ${manifest?.description} Would you like me to show you what I can do?`;

      // Speak the education (summarized version)
      try {
        // Ensure audio context is resumed
        if (audioContextRef.current?.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        const response = await fetch('/api/zenna/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: ttsText }),
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
  }, [pendingEducationIntegration, hueManifest]);

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

  // Interrupt current speech/processing/thinking
  const interruptSpeaking = useCallback(() => {
    // Stop audio playback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
      currentAudioRef.current = null;
    }

    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear streaming and thinking state
    setStreamingResponse('');
    setThinkingStatus('');
    setThinkingElapsed(0);
    setZennaState('idle');
  }, []);

  // Handle user message (from voice or text) with streaming support
  const handleUserMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Interrupt any current activity
    interruptSpeaking();

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
    setStreamingResponse('');
    setZennaState('thinking');
    setCurrentEmotion('thoughtful');

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Use streaming endpoint for real-time text updates
      const response = await fetch('/api/zenna/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let emotion: string | undefined;

      // Read streaming response
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'text') {
                fullText += data.content;
                setStreamingResponse(fullText);
              } else if (data.type === 'status') {
                // Tool execution status update
                setThinkingStatus(data.content || `${data.action}: ${data.tool}`);
              } else if (data.type === 'thinking') {
                // Escalating thinking feedback from server
                setThinkingStatus(data.content);
              } else if (data.type === 'complete') {
                fullText = data.fullResponse;
                emotion = data.emotion;
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      // Add complete message to transcript
      if (fullText) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullText,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
        setStreamingResponse('');

        // Update emotion
        if (emotion) {
          setCurrentEmotion(emotion as EmotionType);
        }

        // Generate and play TTS audio
        setZennaState('speaking');

        try {
          // Ensure audio context is resumed (required for iOS)
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
          }

          // iOS-specific: Use the speak endpoint with base64 data URL
          // iOS Safari has issues with blob URLs and streaming audio
          if (isIOSRef.current) {
            console.log('[TTS] Using iOS-compatible base64 audio');
            const iosResponse = await fetch('/api/zenna/speak', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: fullText }),
              signal: abortControllerRef.current?.signal,
            });

            const iosData = await iosResponse.json();

            if (iosData.audioUrl) {
              const audio = new Audio();
              currentAudioRef.current = audio;

              // iOS requires setting src before other properties
              audio.src = iosData.audioUrl;
              audio.preload = 'auto';

              // Use load() to trigger iOS audio preparation
              audio.load();

              audio.oncanplaythrough = async () => {
                try {
                  await audio.play();
                } catch (playError) {
                  console.error('[TTS] iOS play error:', playError);
                  setZennaState('idle');
                }
              };

              audio.onended = () => {
                currentAudioRef.current = null;
                setZennaState('idle');
                if (alwaysListening) {
                  startAlwaysListening();
                }
              };

              audio.onerror = (e) => {
                console.error('[TTS] iOS audio error:', e);
                currentAudioRef.current = null;
                setZennaState('idle');
              };
            } else {
              console.warn('[TTS] No audio URL from iOS fallback');
              setZennaState('idle');
            }
          } else {
            // Non-iOS: Use streaming TTS endpoint for faster first audio
            const ttsResponse = await fetch('/api/zenna/tts-stream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: fullText }),
              signal: abortControllerRef.current?.signal,
            });

            if (ttsResponse.ok) {
              // Convert stream to blob and play
              const audioBlob = await ttsResponse.blob();
              const audioUrl = URL.createObjectURL(audioBlob);

              const audio = new Audio(audioUrl);
              currentAudioRef.current = audio;

              audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                currentAudioRef.current = null;
                setZennaState('idle');

                // Auto-resume listening if always-listening is enabled
                if (alwaysListening) {
                  startAlwaysListening();
                }
              };

              audio.onerror = () => {
                URL.revokeObjectURL(audioUrl);
                currentAudioRef.current = null;
                setZennaState('idle');
              };

              await audio.play();
            } else {
              // Fall back to non-streaming endpoint
              const fallbackResponse = await fetch('/api/zenna/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: fullText }),
              });

              const fallbackData = await fallbackResponse.json();

              if (fallbackData.audioUrl) {
                const audio = new Audio(fallbackData.audioUrl);
                currentAudioRef.current = audio;

                audio.onended = () => {
                  currentAudioRef.current = null;
                  setZennaState('idle');
                };
                audio.onerror = () => {
                  currentAudioRef.current = null;
                  setZennaState('idle');
                };

                await audio.play();
              } else {
                setZennaState('idle');
              }
            }
          }
        } catch (ttsError) {
          if ((ttsError as Error).name !== 'AbortError') {
            console.error('TTS error:', ttsError);
          }
          setZennaState('idle');
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      console.error('Chat error:', error);
      setZennaState('error');
      setTimeout(() => setZennaState('idle'), 3000);
    }
  }, [interruptSpeaking, alwaysListening]);

  // Start always-listening mode with VAD
  const startAlwaysListening = useCallback(async () => {
    if (!alwaysListening) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Float32Array(analyser.fftSize);
      silenceStartRef.current = 0;
      isSpeakingRef.current = false;

      // Background noise detection variables
      let backgroundNoiseStartTime = 0;
      let hasDetectedSpeechThisSession = false;
      let rmsHistory: number[] = [];
      const RMS_HISTORY_SIZE = 30; // ~1.5 seconds of history at 50ms intervals

      // Start recording
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100);
      setZennaState('listening');

      // VAD loop with background noise detection
      vadIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;

        analyserRef.current.getFloatTimeDomainData(dataArray);

        // Calculate RMS energy
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setAudioLevel(Math.min(1, rms * 10));

        // Track RMS history for noise detection
        rmsHistory.push(rms);
        if (rmsHistory.length > RMS_HISTORY_SIZE) {
          rmsHistory.shift();
        }

        const speechThreshold = 0.015; // Higher threshold for actual speech
        const noiseThreshold = 0.005;  // Lower threshold for any sound
        const now = Date.now();

        // Check for actual speech (higher energy bursts with variation)
        const avgRms = rmsHistory.reduce((a, b) => a + b, 0) / rmsHistory.length;
        const maxRms = Math.max(...rmsHistory);
        const minRms = Math.min(...rmsHistory);
        const rmsVariance = maxRms - minRms;

        // Speech typically has higher peaks and more variation
        const looksLikeSpeech = rms > speechThreshold && rmsVariance > 0.01;

        if (looksLikeSpeech) {
          isSpeakingRef.current = true;
          hasDetectedSpeechThisSession = true;
          silenceStartRef.current = 0;
          backgroundNoiseStartTime = 0; // Reset noise timer
        } else if (isSpeakingRef.current) {
          // After speech was detected, check for silence
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current > 1200) {
            // 1.2 seconds of silence after speech - process the audio
            isSpeakingRef.current = false;
            hasDetectedSpeechThisSession = false;

            // Stop recording and process
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();

              // Process after a short delay to ensure all data is captured
              setTimeout(async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

                if (audioBlob.size > 1000) { // Only process if there's enough audio
                  setCurrentTranscript('Processing...');
                  setZennaState('thinking');

                  // Stop VAD while processing
                  if (vadIntervalRef.current) {
                    clearInterval(vadIntervalRef.current);
                    vadIntervalRef.current = null;
                  }

                  // Transcribe
                  const formData = new FormData();
                  formData.append('audio', audioBlob, 'recording.webm');

                  try {
                    const transcribeResponse = await fetch('/api/zenna/transcribe', {
                      method: 'POST',
                      body: formData,
                    });

                    const transcribeData = await transcribeResponse.json();

                    if (transcribeData.transcript && transcribeData.transcript.trim()) {
                      setCurrentTranscript(transcribeData.transcript);
                      await handleUserMessage(transcribeData.transcript);
                    } else {
                      // No speech detected, restart listening
                      startAlwaysListening();
                    }
                  } catch (error) {
                    console.error('Transcription error:', error);
                    startAlwaysListening();
                  }
                }
              }, 200);
            }
          }
        } else if (rms > noiseThreshold && !looksLikeSpeech && !hasDetectedSpeechThisSession) {
          // Detecting constant noise without speech patterns
          if (!backgroundNoiseStartTime) {
            backgroundNoiseStartTime = now;
          } else if (now - backgroundNoiseStartTime > 5000) {
            // 5 seconds of continuous background noise without speech
            console.log('[VAD] Background noise detected for 5 seconds');
            backgroundNoiseStartTime = 0; // Reset

            // Stop recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }

            // Stop VAD
            if (vadIntervalRef.current) {
              clearInterval(vadIntervalRef.current);
              vadIntervalRef.current = null;
            }

            // Send background noise message to Zenna
            setZennaState('thinking');
            setCurrentTranscript('');

            // Have Zenna respond about background noise
            handleUserMessage('[SYSTEM: Background noise detected for extended period without clear speech]');
          }
        } else {
          // Silence - reset noise timer
          backgroundNoiseStartTime = 0;
        }
      }, 50);
    } catch (error) {
      console.error('VAD error:', error);
      setAlwaysListening(false);
    }
  }, [alwaysListening, handleUserMessage]);

  // Stop always-listening mode
  const stopAlwaysListening = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setAudioLevel(0);
  }, []);

  // Toggle always-listening mode
  const toggleAlwaysListening = useCallback((enabled: boolean) => {
    setAlwaysListening(enabled);

    if (enabled && zennaState === 'idle') {
      startAlwaysListening();
    } else if (!enabled) {
      stopAlwaysListening();
      setZennaState('idle');
    }
  }, [zennaState, startAlwaysListening, stopAlwaysListening]);

  // Auto-start listening when alwaysListening is enabled and state is idle
  // This handles the case when setAlwaysListening(true) is called but
  // startAlwaysListening() runs before state updates
  useEffect(() => {
    if (alwaysListening && zennaState === 'idle' && !vadIntervalRef.current) {
      console.log('[AlwaysListening] Auto-starting mic because alwaysListening is enabled');
      // Small delay to ensure audio context is ready
      const timer = setTimeout(() => {
        startAlwaysListening();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [alwaysListening, zennaState, startAlwaysListening]);

  // Handle microphone button click - record with VAD-based end-of-speech detection
  const handleMicClick = useCallback(async () => {
    // If already listening, manually stop and process
    if (zennaState === 'listening') {
      console.log('[VAD] Manual stop triggered');
      // Stop VAD monitoring
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      // Stop recording and process
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      // Initialize audio context for VAD
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create analyser for VAD
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Initialize VAD state
      const dataArray = new Float32Array(analyser.fftSize);
      let hasCapturedSpeech = false;
      let silenceStartTime: number | null = null;
      let speechStartTime: number | null = null;
      const SILENCE_THRESHOLD = 0.015; // RMS threshold for silence
      const SILENCE_DURATION_MS = 1200; // 1.2 seconds of silence = end of speech
      const MIN_SPEECH_DURATION_MS = 300; // Minimum speech to be valid

      setZennaState('listening');
      setCurrentEmotion('curious');
      setCurrentTranscript('Listening...');
      audioChunksRef.current = [];

      console.log('[VAD] Push-to-talk started with VAD');
      console.log('[VAD] Silence threshold:', SILENCE_THRESHOLD);
      console.log('[VAD] Silence duration for end-of-speech:', SILENCE_DURATION_MS, 'ms');

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('[VAD] Recording stopped, processing audio...');

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // Stop VAD monitoring
        if (vadIntervalRef.current) {
          clearInterval(vadIntervalRef.current);
          vadIntervalRef.current = null;
        }

        // Close audio context
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
        }

        setCurrentTranscript('Transcribing...');
        setZennaState('thinking');
        setAudioLevel(0);

        // Combine audio chunks into a single blob
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        console.log('[VAD] Audio blob size:', audioBlob.size, 'bytes');

        // Only process if there's enough audio
        if (audioBlob.size < 1000) {
          console.log('[VAD] Audio too short, ignoring');
          setCurrentTranscript('');
          setZennaState('idle');
          return;
        }

        try {
          // Send to transcription API
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          console.log('[PROCESS] Sending to transcription API...');
          const response = await fetch('/api/zenna/transcribe', {
            method: 'POST',
            body: formData,
          });

          const data = await response.json();
          console.log('[PROCESS] Transcription result:', data.transcript ? data.transcript.substring(0, 50) + '...' : '(empty)');

          if (data.transcript && data.transcript.trim()) {
            setCurrentTranscript(data.transcript);
            // Process the transcript as a message
            console.log('[PROCESS] Sending to AI...');
            handleUserMessage(data.transcript);
          } else {
            console.log('[VAD] No speech detected in transcription');
            setCurrentTranscript('');
            setZennaState('idle');
          }
        } catch (error) {
          console.error('[VAD] Transcription error:', error);
          setCurrentTranscript('');
          setZennaState('error');
          setTimeout(() => setZennaState('idle'), 3000);
        }
      };

      // Start recording
      mediaRecorder.start(100);

      // Start VAD monitoring loop
      vadIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;

        analyserRef.current.getFloatTimeDomainData(dataArray);

        // Calculate RMS energy
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // Update visual audio level (normalized to 0-1)
        const normalizedLevel = Math.min(1, rms * 15);
        setAudioLevel(normalizedLevel);

        const now = Date.now();
        const isSpeaking = rms > SILENCE_THRESHOLD;

        if (isSpeaking) {
          // Speech detected
          if (!hasCapturedSpeech) {
            hasCapturedSpeech = true;
            speechStartTime = now;
            console.log('[VAD] Speech started');
            setCurrentTranscript('Listening... (speaking detected)');
          }
          // Reset silence timer when speech is detected
          silenceStartTime = null;
        } else if (hasCapturedSpeech) {
          // Silence after speech was captured
          if (!silenceStartTime) {
            silenceStartTime = now;
            console.log('[VAD] Silence detected, starting timer...');
            setCurrentTranscript('Listening... (pause detected)');
          } else {
            const silenceDuration = now - silenceStartTime;

            // Log silence duration periodically
            if (silenceDuration % 200 < 50) {
              console.log(`[VAD] Silence duration: ${silenceDuration}ms`);
            }

            // Check if silence duration exceeds threshold
            if (silenceDuration >= SILENCE_DURATION_MS) {
              // Check if we have enough speech
              const speechDuration = speechStartTime ? (silenceStartTime - speechStartTime) : 0;

              if (speechDuration >= MIN_SPEECH_DURATION_MS) {
                console.log(`[VAD] END OF SPEECH CONFIRMED (speech: ${speechDuration}ms, silence: ${silenceDuration}ms)`);
                setCurrentTranscript('Processing...');

                // Stop VAD and trigger processing
                if (vadIntervalRef.current) {
                  clearInterval(vadIntervalRef.current);
                  vadIntervalRef.current = null;
                }

                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                  mediaRecorderRef.current.stop();
                }
              } else {
                console.log(`[VAD] Speech too short (${speechDuration}ms), waiting for more...`);
                // Reset and wait for more speech
                hasCapturedSpeech = false;
                silenceStartTime = null;
                speechStartTime = null;
                setCurrentTranscript('Listening...');
              }
            }
          }
        }
      }, 50); // Check every 50ms for responsive detection

    } catch (error) {
      console.error('[VAD] Microphone access denied:', error);
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

  // Handle geolocation granted - save to user settings and memory
  const handleLocationGranted = useCallback(async (location: {
    latitude: number;
    longitude: number;
    city?: string;
    region?: string;
    country?: string;
  }) => {
    setUserLocation(location);
    setShowGeolocationPrompt(false);

    // Save location to user settings via API
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
            city: location.city,
            region: location.region,
            country: location.country,
            updatedAt: new Date().toISOString(),
          },
        }),
      });

      // Also store as a memory for Zen-na to reference
      const locationStr = [location.city, location.region, location.country]
        .filter(Boolean)
        .join(', ');

      if (locationStr) {
        console.log(`[Geolocation] User location set to: ${locationStr}`);
      }
    } catch (error) {
      console.error('Failed to save location:', error);
    }
  }, []);

  // Handle geolocation denied
  const handleLocationDenied = useCallback(() => {
    setShowGeolocationPrompt(false);
    console.log('[Geolocation] User denied location access');
  }, []);

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
            <AvatarRenderer
              state={zennaState}
              avatarUrl={avatarUrl}
              modelUrl={avatarModelUrl}
              modelType={avatarModelType}
              emotion={currentEmotion}
              newIntegration={newIntegration}
              fillContainer
              prefer3D={true}
            />
          </div>

          {/* Voice Controls - microphone, interrupt, always-listening toggle */}
          <VoiceControls
            state={zennaState}
            audioLevel={audioLevel}
            alwaysListening={alwaysListening}
            onMicClick={handleMicClick}
            onStopSpeaking={interruptSpeaking}
            onInterrupt={interruptSpeaking}
            onToggleAlwaysListening={toggleAlwaysListening}
            currentTranscript={currentTranscript || streamingResponse}
            disabled={false}
            thinkingStatus={thinkingStatus}
            thinkingElapsed={thinkingElapsed}
          />
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
                streamingResponse={streamingResponse}
                zennaState={zennaState}
                thinkingStatus={thinkingStatus}
                thinkingElapsed={thinkingElapsed}
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
          initialTab={initialSettingsTab as 'general' | 'llm' | 'integrations' | 'avatar' | 'master' | undefined}
          onOpenAvatarSettings={() => setIsAvatarSettingsOpen(true)}
        />
      )}

      {/* Avatar Settings Panel */}
      {isAvatarSettingsOpen && (
        <AvatarSettings
          onClose={() => setIsAvatarSettingsOpen(false)}
          onAvatarChange={async (url: string, type: 'preset' | 'custom' | 'reconstructed' | '2d-fallback') => {
            // Update local state immediately for responsive UI
            if (type === '2d-fallback') {
              setAvatarUrl(url);
              setAvatarModelType('2d-fallback');
            } else {
              setAvatarModelUrl(url);
              setAvatarModelType(type);
            }

            // Persist to user settings so it loads on next session
            try {
              await fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  avatarModelUrl: type === '2d-fallback' ? undefined : url,
                  avatarModelType: type,
                  avatarUrl: type === '2d-fallback' ? url : undefined,
                }),
              });
            } catch (error) {
              console.error('Failed to persist avatar settings:', error);
            }
          }}
          initialAvatarUrl={avatarUrl}
          initialModelType={avatarModelType}
        />
      )}

      {/* Geolocation Permission Prompt */}
      {showGeolocationPrompt && (
        <GeolocationPrompt
          onLocationGranted={handleLocationGranted}
          onLocationDenied={handleLocationDenied}
        />
      )}

      {/* Audio Enable Prompt - appears when autoplay is blocked */}
      {showAudioPrompt && pendingGreetingAudio && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center cursor-pointer"
          onClick={async () => {
            setShowAudioPrompt(false);

            // Initialize audio context on user interaction
            if (!audioContextRef.current) {
              audioContextRef.current = new AudioContext();
            }

            // Play the pending greeting audio
            if (pendingGreetingAudio) {
              setZennaState('speaking');
              const audio = new Audio(pendingGreetingAudio);

              // When greeting finishes, enable always-listening mode by default
              audio.onended = () => {
                setZennaState('idle');
                // Enable always-listening mode after greeting completes
                setAlwaysListening(true);
                // Start listening after a short delay
                setTimeout(() => {
                  startAlwaysListening();
                }, 500);
              };

              audio.onerror = () => {
                setZennaState('idle');
                // Still enable always-listening even if audio fails
                setAlwaysListening(true);
                setTimeout(() => {
                  startAlwaysListening();
                }, 500);
              };

              try {
                await audio.play();
              } catch (err) {
                console.error('Still failed to play audio:', err);
                setZennaState('idle');
                // Enable always-listening even on error
                setAlwaysListening(true);
                setTimeout(() => {
                  startAlwaysListening();
                }, 500);
              }
              setPendingGreetingAudio(null);
            }
          }}
        >
          <div className="bg-zenna-surface border border-zenna-border rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300 text-center">
            <div className="text-5xl mb-4">🔊</div>
            <h2 className="text-xl font-medium mb-2">Enable Audio</h2>
            <p className="text-zenna-muted mb-4">
              Click anywhere to hear Zenna&apos;s greeting
            </p>
            <div className="text-sm text-zenna-muted/70">
              (Voice mode will activate after greeting)
            </div>
          </div>
        </div>
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
