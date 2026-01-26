'use client';

import { useEffect, useState, useRef } from 'react';

interface KnowledgeIngestionIndicatorProps {
  userId?: string;
  pollingInterval?: number; // ms
}

interface IngestionProgress {
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress: number;
  totalPages?: number;
  processedPages?: number;
  error?: string;
}

export default function KnowledgeIngestionIndicator({
  pollingInterval = 2000,
}: KnowledgeIngestionIndicatorProps) {
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hideTimeout, setHideTimeout] = useState<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  // Poll for progress updates
  useEffect(() => {
    const checkProgress = async () => {
      try {
        const response = await fetch('/api/integrations/notion/ingest');
        if (response.ok) {
          const data = await response.json();
          setProgress(data);

          // Show indicator if processing
          if (data.status === 'processing') {
            setIsVisible(true);
            if (hideTimeout) {
              clearTimeout(hideTimeout);
              setHideTimeout(null);
            }
          } else if (data.status === 'completed' || data.status === 'error') {
            // Show completion briefly, then hide
            setIsVisible(true);
            const timeout = setTimeout(() => {
              setIsVisible(false);
            }, 3000);
            setHideTimeout(timeout);
          }
        }
      } catch (error) {
        console.error('Failed to check ingestion progress:', error);
      }
    };

    // Initial check
    checkProgress();

    // Set up polling
    const interval = setInterval(checkProgress, pollingInterval);

    return () => {
      clearInterval(interval);
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
    };
  }, [pollingInterval, hideTimeout]);

  // Animated brain icon
  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;
    const progressValue = progress?.progress || 0;

    const animate = () => {
      time += 0.05;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = 16;

      // Background circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
      ctx.fill();

      // Progress arc
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (progressValue / 100) * Math.PI * 2;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.strokeStyle = '#8B5CF6';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Animated brain icon (simplified)
      ctx.save();
      ctx.translate(centerX, centerY);

      // Pulsing effect
      const scale = 1 + Math.sin(time * 3) * 0.1;
      ctx.scale(scale, scale);

      // Brain shape (simplified)
      ctx.fillStyle = progress?.status === 'completed' ? '#10B981' :
                      progress?.status === 'error' ? '#EF4444' : '#8B5CF6';

      // Left hemisphere
      ctx.beginPath();
      ctx.arc(-3, -2, 6, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(-3, -6, 4, Math.PI * 1.5, Math.PI * 0.5, true);
      ctx.fill();

      // Right hemisphere
      ctx.beginPath();
      ctx.arc(3, -2, 6, Math.PI * 1.5, Math.PI * 0.5);
      ctx.arc(3, -6, 4, Math.PI * 0.5, Math.PI * 1.5, true);
      ctx.fill();

      // Neural connections (animated dots)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (let i = 0; i < 3; i++) {
        const dotX = Math.sin(time * 2 + i * 2) * 4;
        const dotY = Math.cos(time * 2 + i * 2) * 4 - 3;
        const dotAlpha = (Math.sin(time * 4 + i) + 1) / 2;
        ctx.globalAlpha = dotAlpha * 0.8;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.restore();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isVisible, progress]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-zenna-surface/90 backdrop-blur-sm border border-zenna-border rounded-full px-4 py-2 shadow-lg">
      <canvas
        ref={canvasRef}
        width={40}
        height={40}
        className="flex-shrink-0"
      />

      <div className="flex flex-col">
        <span className="text-xs font-medium text-white">
          {progress?.status === 'processing' && 'Ingesting Knowledge...'}
          {progress?.status === 'completed' && 'Knowledge Ingested!'}
          {progress?.status === 'error' && 'Ingestion Failed'}
        </span>

        {progress?.status === 'processing' && (
          <span className="text-xs text-zenna-muted">
            {progress.processedPages || 0} / {progress.totalPages || 0} pages ({progress.progress}%)
          </span>
        )}

        {progress?.status === 'completed' && (
          <span className="text-xs text-green-400">
            {progress.processedPages || 0} pages processed
          </span>
        )}

        {progress?.status === 'error' && (
          <span className="text-xs text-red-400">
            {progress.error || 'Unknown error'}
          </span>
        )}
      </div>

      {/* Close button for completed/error states */}
      {(progress?.status === 'completed' || progress?.status === 'error') && (
        <button
          onClick={() => setIsVisible(false)}
          className="ml-2 p-1 hover:bg-zenna-border rounded-full transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
