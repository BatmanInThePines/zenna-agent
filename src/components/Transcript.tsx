'use client';

import { useEffect, useRef } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface TranscriptProps {
  messages: Message[];
}

export default function Transcript({ messages }: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto p-6 space-y-4"
    >
      {messages.length === 0 ? (
        <div className="h-full flex items-center justify-center text-zenna-muted">
          <p className="text-center">
            Zenna is ready to assist you.<br />
            <span className="text-sm">Click the microphone or type below to begin.</span>
          </p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`p-4 rounded-lg ${
              message.role === 'user' ? 'transcript-user' : 'transcript-assistant'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-zenna-muted uppercase tracking-wider">
                {message.role === 'user' ? 'You' : 'Zenna'}
              </span>
              <span className="text-xs text-zenna-muted/50">
                {formatTime(message.timestamp)}
              </span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
