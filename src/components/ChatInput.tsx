'use client';

import { useState, useRef, useCallback } from 'react';

interface ChatInputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  queuedCount?: number;
  isBusy?: boolean;
}

export default function ChatInput({ onSubmit, disabled, placeholder, queuedCount = 0, isBusy = false }: ChatInputProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    onSubmit(input.trim());
    setInput('');
  }, [input, disabled, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  return (
    <div className="border-b border-zenna-border p-4 bg-zenna-bg/95 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isBusy ? "Type to queue a message..." : (placeholder || "Type a message...")}
          disabled={disabled}
          className="flex-1"
        />

        <button
          type="submit"
          disabled={!input.trim() || disabled}
          className="btn-primary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBusy ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </form>

      {/* Queue indicator */}
      {queuedCount > 0 && (
        <div className="flex items-center gap-2 mt-2 text-xs text-zenna-accent">
          <div className="flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zenna-accent animate-pulse" />
            <span>
              {queuedCount} message{queuedCount > 1 ? 's' : ''} queued — will send when Zenna is ready
            </span>
          </div>
        </div>
      )}

      {queuedCount === 0 && (
        <p className="text-xs text-zenna-muted/50 mt-2 text-center">
          Voice is primary. Text is available as a fallback.
        </p>
      )}
    </div>
  );
}
