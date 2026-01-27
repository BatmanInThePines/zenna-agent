'use client';

import { useEffect, useRef, ReactNode } from 'react';
import Image from 'next/image';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  // Rich media support
  imageUrl?: string;
  pdfUrl?: string;
  mediaType?: 'text' | 'image' | 'pdf';
}

interface TranscriptProps {
  messages: Message[];
  chatInput?: ReactNode; // Chat input component to render at top
}

// Component to render message content with rich media support
function MessageContent({ message }: { message: Message }) {
  // Check if content contains image markdown or URL
  const imageUrlMatch = message.content.match(/!\[.*?\]\((.*?)\)/);
  const directImageUrl = message.imageUrl || (imageUrlMatch ? imageUrlMatch[1] : null);

  // Check if content contains PDF URL
  const pdfUrlMatch = message.content.match(/\[.*?\.pdf\]\((.*?)\)/i);
  const directPdfUrl = message.pdfUrl || (pdfUrlMatch ? pdfUrlMatch[1] : null);

  // Render image if present
  if (directImageUrl || message.mediaType === 'image') {
    const imageUrl = directImageUrl || message.content;
    return (
      <div className="space-y-2">
        {/* Text content (if any, excluding the image markdown) */}
        {message.content && !message.content.startsWith('http') && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content.replace(/!\[.*?\]\(.*?\)/g, '').trim()}
          </p>
        )}
        {/* Image */}
        <div className="relative w-full max-w-md">
          <Image
            src={imageUrl}
            alt="Generated image"
            width={400}
            height={300}
            className="rounded-lg object-contain max-h-[300px] w-auto cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(imageUrl, '_blank')}
            unoptimized={imageUrl.startsWith('data:')} // Allow data URLs
          />
        </div>
      </div>
    );
  }

  // Render PDF if present
  if (directPdfUrl || message.mediaType === 'pdf') {
    const pdfUrl = directPdfUrl || message.content;
    return (
      <div className="space-y-2">
        {/* Text content (if any) */}
        {message.content && !message.content.endsWith('.pdf') && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content.replace(/\[.*?\.pdf\]\(.*?\)/gi, '').trim()}
          </p>
        )}
        {/* PDF Preview */}
        <div className="border border-zenna-border rounded-lg overflow-hidden">
          <div className="bg-zenna-surface p-3 flex items-center gap-3">
            <svg className="w-8 h-8 text-red-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zm-3 9h4v2h-4v-2zm0-3h4v2h-4V10zm-2 6h8v2H8v-2z"/>
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium">PDF Document</p>
              <p className="text-xs text-zenna-muted">Click to view</p>
            </div>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-zenna-accent text-white rounded-md text-sm hover:bg-indigo-600 transition-colors"
            >
              Open
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Default text rendering with markdown-like support for inline images
  const contentParts = message.content.split(/(!\[.*?\]\(.*?\))/g);

  if (contentParts.length > 1) {
    return (
      <div className="space-y-2">
        {contentParts.map((part, index) => {
          const imgMatch = part.match(/!\[(.*?)\]\((.*?)\)/);
          if (imgMatch) {
            return (
              <div key={index} className="relative w-full max-w-md">
                <Image
                  src={imgMatch[2]}
                  alt={imgMatch[1] || 'Image'}
                  width={400}
                  height={300}
                  className="rounded-lg object-contain max-h-[300px] w-auto cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => window.open(imgMatch[2], '_blank')}
                  unoptimized={imgMatch[2].startsWith('data:')}
                />
              </div>
            );
          }
          return part.trim() ? (
            <p key={index} className="text-sm leading-relaxed whitespace-pre-wrap">
              {part}
            </p>
          ) : null;
        })}
      </div>
    );
  }

  // Plain text
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap">
      {message.content}
    </p>
  );
}

export default function Transcript({ messages, chatInput }: TranscriptProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to show newest messages (which are at the top in reverse chronological order)
  // We want to scroll to top to see newest content
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [messages]);

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  // Reverse messages for reverse chronological display (newest first)
  const reversedMessages = [...messages].reverse();

  return (
    <div className="h-full flex flex-col">
      {/* Chat Input at TOP (sticky) */}
      {chatInput && (
        <div className="flex-shrink-0 sticky top-0 z-10 bg-zenna-bg">
          {chatInput}
        </div>
      )}

      {/* Messages - newest at top, oldest at bottom */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-6 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zenna-muted">
            <p className="text-center">
              Zenna is ready to assist you.<br />
              <span className="text-sm">Click the microphone or type above to begin.</span>
            </p>
          </div>
        ) : (
          reversedMessages.map((message) => (
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
              <MessageContent message={message} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
