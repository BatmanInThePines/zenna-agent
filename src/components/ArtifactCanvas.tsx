'use client';

import { useState } from 'react';
import Image from 'next/image';

interface Artifact {
  type: string;
  content: unknown;
}

interface ArtifactCanvasProps {
  artifacts: Artifact[];
  onClose: () => void;
}

export default function ArtifactCanvas({ artifacts, onClose }: ArtifactCanvasProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const currentArtifact = artifacts[selectedIndex];

  const renderArtifact = (artifact: Artifact) => {
    switch (artifact.type) {
      case 'image':
        return (
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <Image
              src={artifact.content as string}
              alt="Artifact"
              fill
              className="object-contain"
            />
          </div>
        );

      case 'pdf':
        return (
          <iframe
            src={artifact.content as string}
            className="w-full h-full"
            title="PDF Artifact"
          />
        );

      case 'memory':
        const memory = artifact.content as { title: string; content: string; date: string };
        return (
          <div className="p-6 overflow-y-auto h-full">
            <div className="text-xs text-zenna-muted mb-2">{memory.date}</div>
            <h3 className="text-lg font-medium mb-4">{memory.title}</h3>
            <p className="text-sm text-zenna-muted whitespace-pre-wrap">{memory.content}</p>
          </div>
        );

      case 'code':
        return (
          <pre className="p-6 overflow-auto h-full text-sm font-mono bg-black/30 rounded-lg m-4">
            <code>{artifact.content as string}</code>
          </pre>
        );

      case 'html':
        return (
          <iframe
            srcDoc={artifact.content as string}
            className="w-full h-full bg-white"
            title="HTML Artifact"
            sandbox="allow-scripts"
          />
        );

      default:
        return (
          <div className="p-6 overflow-y-auto h-full">
            <pre className="text-sm whitespace-pre-wrap">
              {JSON.stringify(artifact.content, null, 2)}
            </pre>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-zenna-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Artifacts</span>
          {artifacts.length > 1 && (
            <span className="text-xs text-zenna-muted">
              ({selectedIndex + 1} of {artifacts.length})
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          className="p-1.5 hover:bg-zenna-surface rounded-lg transition-colors"
          aria-label="Close artifacts"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {currentArtifact && renderArtifact(currentArtifact)}
      </div>

      {/* Navigation (if multiple artifacts) */}
      {artifacts.length > 1 && (
        <div className="h-12 border-t border-zenna-border flex items-center justify-center gap-2 px-4">
          <button
            onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
            disabled={selectedIndex === 0}
            className="p-2 hover:bg-zenna-surface rounded-lg transition-colors disabled:opacity-30"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex gap-1">
            {artifacts.map((_, index) => (
              <button
                key={index}
                onClick={() => setSelectedIndex(index)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  index === selectedIndex ? 'bg-zenna-accent' : 'bg-zenna-border hover:bg-zenna-muted/30'
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => setSelectedIndex(Math.min(artifacts.length - 1, selectedIndex + 1))}
            disabled={selectedIndex === artifacts.length - 1}
            className="p-2 hover:bg-zenna-surface rounded-lg transition-colors disabled:opacity-30"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
