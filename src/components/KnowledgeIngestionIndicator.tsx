'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface KnowledgeIngestionIndicatorProps {
  userId?: string;
  pollingInterval?: number; // ms
  onIngestionComplete?: () => void;
}

interface IngestionProgress {
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress: number;
  totalPages?: number;
  processedPages?: number;
  error?: string;
}

// Anthony West Inc brain icon URL
const BRAIN_ICON_URL = 'https://agents.anthonywestinc.com/brain-icon.png';

export default function KnowledgeIngestionIndicator({
  pollingInterval = 2000,
  onIngestionComplete,
}: KnowledgeIngestionIndicatorProps) {
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hideTimeout, setHideTimeout] = useState<NodeJS.Timeout | null>(null);
  const [brainImage, setBrainImage] = useState<HTMLImageElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const completionAnnouncedRef = useRef<boolean>(false);

  // Load brain icon image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setBrainImage(img);
    img.onerror = () => {
      // Fallback - brain image failed to load, will use canvas-drawn brain
      console.warn('Failed to load brain icon, using fallback');
    };
    img.src = BRAIN_ICON_URL;
  }, []);

  // Poll for progress updates
  useEffect(() => {
    const checkProgress = async () => {
      try {
        const response = await fetch('/api/integrations/notion/ingest');
        if (response.ok) {
          const data = await response.json();
          const prevStatus = progress?.status;
          setProgress(data);

          // Show indicator if actively processing (always show, even if dismissed)
          if (data.status === 'processing') {
            setDismissed(false); // Reset dismissed on new processing
            setIsVisible(true);
            completionAnnouncedRef.current = false;
            if (hideTimeout) {
              clearTimeout(hideTimeout);
              setHideTimeout(null);
            }
          } else if (data.status === 'completed' || data.status === 'error') {
            // Don't re-show if user already dismissed this state
            if (dismissed) return;

            // Only show if this is a fresh transition from processing
            if (prevStatus === 'processing') {
              setIsVisible(true);

              // Trigger completion callback only once
              if (data.status === 'completed' && !completionAnnouncedRef.current) {
                completionAnnouncedRef.current = true;
                onIngestionComplete?.();
              }

              const timeout = setTimeout(() => {
                setIsVisible(false);
              }, 5000);
              setHideTimeout(timeout);
            } else if (!isVisible) {
              // Stale status from previous session — don't show at all
              return;
            }
          }
        }
      } catch (error) {
        console.error('Failed to check ingestion progress:', error);
      }
    };

    // Initial check
    checkProgress();

    // Set up polling (less frequent when idle/dismissed)
    const interval = setInterval(checkProgress, dismissed ? 10000 : pollingInterval);

    return () => {
      clearInterval(interval);
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
    };
  }, [pollingInterval, hideTimeout, onIngestionComplete, progress?.status, dismissed, isVisible]);

  // Animated brain icon with fill-up effect
  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;
    const progressValue = progress?.progress || 0;

    const animate = () => {
      time += 0.03;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = 18;

      // Scale increases slightly as progress increases (1.0 to 1.15)
      const progressScale = 1 + (progressValue / 100) * 0.15;
      // Add subtle pulse
      const pulseScale = 1 + Math.sin(time * 2) * 0.03;
      const totalScale = progressScale * pulseScale;

      // Background circle with glow effect
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * totalScale + 5);
      gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
      gradient.addColorStop(0.7, 'rgba(139, 92, 246, 0.1)');
      gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * totalScale + 5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Progress ring background
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * totalScale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Progress arc
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (progressValue / 100) * Math.PI * 2;

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * totalScale, startAngle, endAngle);
      ctx.strokeStyle = progress?.status === 'completed' ? '#10B981' :
                        progress?.status === 'error' ? '#EF4444' : '#8B5CF6';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Draw brain icon
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(totalScale, totalScale);

      if (brainImage) {
        // Use the loaded brain icon image with fill-up effect
        const iconSize = 24;
        const halfSize = iconSize / 2;

        // Create clipping mask for fill-up effect
        ctx.save();

        // Draw grayscale version (unfilled portion)
        ctx.globalAlpha = 0.3;
        ctx.drawImage(brainImage, -halfSize, -halfSize, iconSize, iconSize);
        ctx.globalAlpha = 1;

        // Create fill-up clip region (from bottom to top based on progress)
        const fillHeight = (progressValue / 100) * iconSize;
        const clipY = halfSize - fillHeight; // Start from where we want to show color

        ctx.beginPath();
        ctx.rect(-halfSize, clipY, iconSize, fillHeight);
        ctx.clip();

        // Draw colored version in clip region
        ctx.drawImage(brainImage, -halfSize, -halfSize, iconSize, iconSize);

        ctx.restore();

        // Add glow effect on completion
        if (progress?.status === 'completed') {
          ctx.shadowColor = '#10B981';
          ctx.shadowBlur = 10 + Math.sin(time * 4) * 5;
          ctx.globalAlpha = 0.5;
          ctx.drawImage(brainImage, -halfSize, -halfSize, iconSize, iconSize);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      } else {
        // Fallback: Draw brain shape with fill effect
        const fillLevel = progressValue / 100;

        // Brain base color (unfilled)
        ctx.fillStyle = 'rgba(139, 92, 246, 0.3)';

        // Left hemisphere
        ctx.beginPath();
        ctx.arc(-4, 0, 8, Math.PI * 0.5, Math.PI * 1.5);
        ctx.arc(-4, -5, 5, Math.PI * 1.5, Math.PI * 0.5, true);
        ctx.fill();

        // Right hemisphere
        ctx.beginPath();
        ctx.arc(4, 0, 8, Math.PI * 1.5, Math.PI * 0.5);
        ctx.arc(4, -5, 5, Math.PI * 0.5, Math.PI * 1.5, true);
        ctx.fill();

        // Fill-up effect using gradient
        const fillColor = progress?.status === 'completed' ? '#10B981' :
                          progress?.status === 'error' ? '#EF4444' : '#8B5CF6';

        // Create gradient for fill-up effect
        const fillGradient = ctx.createLinearGradient(0, 12, 0, -12);
        fillGradient.addColorStop(0, fillColor);
        fillGradient.addColorStop(fillLevel, fillColor);
        fillGradient.addColorStop(fillLevel, 'rgba(139, 92, 246, 0.2)');
        fillGradient.addColorStop(1, 'rgba(139, 92, 246, 0.2)');

        ctx.fillStyle = fillGradient;

        // Left hemisphere (filled)
        ctx.beginPath();
        ctx.arc(-4, 0, 8, Math.PI * 0.5, Math.PI * 1.5);
        ctx.arc(-4, -5, 5, Math.PI * 1.5, Math.PI * 0.5, true);
        ctx.fill();

        // Right hemisphere (filled)
        ctx.beginPath();
        ctx.arc(4, 0, 8, Math.PI * 1.5, Math.PI * 0.5);
        ctx.arc(4, -5, 5, Math.PI * 0.5, Math.PI * 1.5, true);
        ctx.fill();

        // Neural sparkle effects
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 0; i < 4; i++) {
          const angle = time * 2 + i * (Math.PI / 2);
          const dotRadius = 6 * fillLevel;
          const dotX = Math.cos(angle) * dotRadius;
          const dotY = Math.sin(angle) * dotRadius - 2;
          const dotAlpha = (Math.sin(time * 4 + i * 1.5) + 1) / 2 * fillLevel;
          ctx.globalAlpha = dotAlpha;
          ctx.beginPath();
          ctx.arc(dotX, dotY, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isVisible, progress, brainImage]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-zenna-surface/90 backdrop-blur-sm border border-zenna-border rounded-full px-4 py-2 shadow-lg">
      <canvas
        ref={canvasRef}
        width={56}
        height={56}
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
          onClick={() => { setIsVisible(false); setDismissed(true); }}
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
