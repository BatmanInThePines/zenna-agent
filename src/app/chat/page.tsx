'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import Transcript from '@/components/Transcript';
import ArtifactCanvas from '@/components/ArtifactCanvas';
import ChatInput from '@/components/ChatInput';
import SettingsPanel from '@/components/SettingsPanel';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type ZennaState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export default function ChatPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [zennaState, setZennaState] = useState<ZennaState>('idle');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<Array<{ type: string; content: unknown }>>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);

  // Check authentication
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
      } catch {
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  // Initialize Zenna and play greeting
  useEffect(() => {
    if (!isAuthenticated) return;

    const initializeZenna = async () => {
      try {
        // Get greeting and play it
        const response = await fetch('/api/zenna/greet', { method: 'POST' });
        const data = await response.json();

        if (data.greeting) {
          setZennaState('speaking');

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
            await audio.play();
          } else {
            setZennaState('idle');
          }
        }
      } catch (error) {
        console.error('Failed to initialize Zenna:', error);
        setZennaState('idle');
      }
    };

    initializeZenna();
  }, [isAuthenticated]);

  // Handle microphone button click
  const handleMicClick = useCallback(async () => {
    if (zennaState === 'listening') {
      // Stop listening
      mediaRecorderRef.current?.stop();
      websocketRef.current?.close();
      setZennaState('idle');
      return;
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Initialize audio context if needed
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      setZennaState('listening');
      setCurrentTranscript('');

      // Connect to ASR websocket
      const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/zenna/listen`);
      websocketRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'transcript') {
          setCurrentTranscript(data.transcript);

          if (data.isFinal) {
            // Process the final transcript
            handleUserMessage(data.transcript);
          }
        }
      };

      ws.onclose = () => {
        stream.getTracks().forEach(track => track.stop());
        setZennaState(current => current === 'listening' ? 'idle' : current);
      };

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      mediaRecorder.start(100); // Send audio chunks every 100ms

    } catch (error) {
      console.error('Microphone access denied:', error);
      setZennaState('error');
      setTimeout(() => setZennaState('idle'), 3000);
    }
  }, [zennaState]);

  // Handle user message (from voice or text)
  const handleUserMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentTranscript('');
    setZennaState('thinking');

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

        // Play audio response
        if (data.audioUrl) {
          const audio = new Audio(data.audioUrl);
          audio.onended = () => setZennaState('idle');
          await audio.play();
        } else {
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

  // Handle text input submission
  const handleTextSubmit = useCallback((text: string) => {
    handleUserMessage(text);
  }, [handleUserMessage]);

  // Handle logout
  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }, [router]);

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

  return (
    <main className="min-h-screen flex flex-col">
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
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Avatar */}
        <div className="w-1/3 min-w-[300px] max-w-[500px] border-r border-zenna-border flex flex-col items-center justify-center p-8">
          <Avatar state={zennaState} />

          {/* Microphone Button */}
          <button
            onClick={handleMicClick}
            disabled={zennaState === 'thinking' || zennaState === 'speaking'}
            className={`mt-8 w-16 h-16 rounded-full flex items-center justify-center transition-all relative ${
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

        {/* Right Panel - Transcript & Artifacts */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs or split view for transcript/artifacts */}
          <div className="flex-1 overflow-hidden flex">
            {/* Transcript */}
            <div className={`${artifacts.length > 0 ? 'w-1/2' : 'w-full'} overflow-hidden`}>
              <Transcript messages={messages} />
            </div>

            {/* Artifact Canvas */}
            {artifacts.length > 0 && (
              <div className="w-1/2 border-l border-zenna-border overflow-hidden">
                <ArtifactCanvas artifacts={artifacts} onClose={() => setArtifacts([])} />
              </div>
            )}
          </div>

          {/* Chat Input */}
          <ChatInput
            onSubmit={handleTextSubmit}
            disabled={zennaState === 'listening' || zennaState === 'thinking' || zennaState === 'speaking'}
          />
        </div>
      </div>

      {/* Settings Panel */}
      {isSettingsOpen && (
        <SettingsPanel onClose={() => setIsSettingsOpen(false)} />
      )}
    </main>
  );
}
