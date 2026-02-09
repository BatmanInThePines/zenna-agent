'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

// Helper function to remove pure black background from an image
// This makes the avatar silhouette work properly with drop-shadow glow effects
// Uses color variance to distinguish true black background from dark subject pixels
// (e.g., dark fur, shadows) which have subtle color differences even at low brightness
function removeBlackBackground(img: HTMLImageElement, threshold: number = 15): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) return canvas;

  // Draw the original image
  ctx.drawImage(img, 0, 0);

  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Process each pixel - only remove truly black/uniform-dark background pixels
  // Preserve dark subject pixels that have color variation (fur, shadows, etc.)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    // Only consider very dark pixels (luminance < threshold)
    if (luminance < threshold) {
      // Check color variance — true black background has R≈G≈B≈0
      // Dark subject pixels (fur, leather, shadows) have subtle color differences
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const colorVariance = maxChannel - minChannel;

      // Pure black background: all channels near zero with little variance
      // Dark subject matter: may still have channel differences (warm browns, cool shadows)
      if (colorVariance < 5 && maxChannel < threshold) {
        // True background pixel — make transparent with smooth falloff
        const alpha = Math.max(0, (luminance / threshold) * 255);
        data[i + 3] = Math.floor(alpha);
      }
      // else: dark pixel with color info — keep fully opaque (part of avatar)
    }
  }

  // Put the modified image data back
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

// Emotion color system based on psychological research (Plutchik's wheel + studies)
// Maps emotional states to colors that resonate with human perception
const EMOTION_COLORS = {
  // Primary emotions
  joy: { primary: '#FFD700', secondary: '#FFA500', glow: 'rgba(255, 215, 0, 0.6)' },
  trust: { primary: '#90EE90', secondary: '#32CD32', glow: 'rgba(144, 238, 144, 0.5)' },
  fear: { primary: '#800080', secondary: '#4B0082', glow: 'rgba(128, 0, 128, 0.4)' },
  surprise: { primary: '#00CED1', secondary: '#20B2AA', glow: 'rgba(0, 206, 209, 0.5)' },
  sadness: { primary: '#4169E1', secondary: '#1E3A8A', glow: 'rgba(65, 105, 225, 0.4)' },
  anticipation: { primary: '#FF8C00', secondary: '#FF6347', glow: 'rgba(255, 140, 0, 0.5)' },
  anger: { primary: '#DC143C', secondary: '#8B0000', glow: 'rgba(220, 20, 60, 0.5)' },
  disgust: { primary: '#556B2F', secondary: '#2E4A1C', glow: 'rgba(85, 107, 47, 0.4)' },

  // Conversational contexts
  neutral: { primary: '#A78BFA', secondary: '#7C3AED', glow: 'rgba(167, 139, 250, 0.4)' },
  curious: { primary: '#06B6D4', secondary: '#0891B2', glow: 'rgba(6, 182, 212, 0.5)' },
  helpful: { primary: '#10B981', secondary: '#059669', glow: 'rgba(16, 185, 129, 0.5)' },
  empathetic: { primary: '#EC4899', secondary: '#DB2777', glow: 'rgba(236, 72, 153, 0.5)' },
  thoughtful: { primary: '#8B5CF6', secondary: '#6D28D9', glow: 'rgba(139, 92, 246, 0.5)' },
  encouraging: { primary: '#F59E0B', secondary: '#D97706', glow: 'rgba(245, 158, 11, 0.6)' },
  calming: { primary: '#67E8F9', secondary: '#22D3EE', glow: 'rgba(103, 232, 249, 0.4)' },
  focused: { primary: '#3B82F6', secondary: '#2563EB', glow: 'rgba(59, 130, 246, 0.5)' },
};

type EmotionType = keyof typeof EMOTION_COLORS;

interface AvatarProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  avatarUrl?: string;
  emotion?: EmotionType;
  intensity?: number; // 0-1 for how intense the emotion display should be
  newIntegration?: string | null; // Name of newly connected integration (triggers glow effect)
  fillContainer?: boolean; // If true, avatar will expand to fill its container
}

export default function Avatar({
  state,
  avatarUrl,
  emotion = 'neutral',
  intensity = 0.7,
  newIntegration = null,
  fillContainer = false
}: AvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 300, height: 300 });
  const [containerSize, setContainerSize] = useState({ width: 320, height: 320 });

  // Default avatar if none provided
  const defaultAvatarUrl = '/avatar-default.png';
  const currentAvatarUrl = avatarUrl || defaultAvatarUrl;

  // Get current emotion colors
  const colors = useMemo(() => EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral, [emotion]);

  // Observe container size for fillContainer mode
  useEffect(() => {
    if (!fillContainer || !containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [fillContainer]);

  // Calculate canvas size based on mode
  const canvasSize = fillContainer
    ? Math.min(containerSize.width, containerSize.height)
    : 320;

  // State-based animation parameters
  const stateConfig = useMemo(() => {
    switch (state) {
      case 'idle':
        return {
          breathingSpeed: 0.5,
          breathingAmount: 0.008,
          glowPulseSpeed: 0.3,
          glowIntensity: 0.3,
          colorShift: false,
        };
      case 'listening':
        return {
          breathingSpeed: 0.8,
          breathingAmount: 0.015,
          glowPulseSpeed: 2,
          glowIntensity: 0.7,
          colorShift: true,
        };
      case 'thinking':
        return {
          breathingSpeed: 0.2,
          breathingAmount: 0.005,
          glowPulseSpeed: 0.5,
          glowIntensity: 0.4,
          colorShift: false,
        };
      case 'speaking':
        return {
          breathingSpeed: 1.5,
          breathingAmount: 0.02,
          glowPulseSpeed: 4,
          glowIntensity: 0.8,
          colorShift: true,
        };
      case 'error':
        return {
          breathingSpeed: 4,
          breathingAmount: 0.01,
          glowPulseSpeed: 8,
          glowIntensity: 0.9,
          colorShift: false,
        };
      default:
        return {
          breathingSpeed: 0.5,
          breathingAmount: 0.008,
          glowPulseSpeed: 0.3,
          glowIntensity: 0.3,
          colorShift: false,
        };
    }
  }, [state]);

  // Reference to processed canvas (with background removed)
  const processedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load image and remove black background for proper transparency
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = currentAvatarUrl;

    img.onload = () => {
      // Process the image to remove black background
      // This ensures drop-shadow glow follows the avatar silhouette, not the bounding box
      const processedCanvas = removeBlackBackground(img, 15); // low threshold — only strip pure black background, preserve dark avatar details
      processedCanvasRef.current = processedCanvas;

      // Store reference to original image (for dimensions)
      imageRef.current = img;

      // Calculate dimensions to fit within canvas while preserving aspect ratio
      const maxSize = canvasSize * 0.85; // Leave padding for glow effects
      const scale = Math.min(maxSize / img.width, maxSize / img.height);
      setImageDimensions({
        width: img.width * scale,
        height: img.height * scale,
      });
      setImageLoaded(true);
    };

    img.onerror = () => {
      setImageLoaded(false);
    };
  }, [currentAvatarUrl, canvasSize]);

  // Main animation loop
  useEffect(() => {
    if (!imageLoaded || !processedCanvasRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      if (!canvas || !ctx || !processedCanvasRef.current) return;

      timeRef.current += 0.016;
      const time = timeRef.current;
      const config = stateConfig;

      // Clear canvas with transparency preserved
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Calculate breathing animation
      const breathe = 1 + Math.sin(time * config.breathingSpeed) * config.breathingAmount;

      // Calculate image position
      const imgX = centerX - imageDimensions.width / 2;
      const imgY = centerY - imageDimensions.height / 2;

      // Draw the processed avatar image (with black background removed)
      ctx.save();

      // Apply breathing scale
      ctx.translate(centerX, centerY);
      ctx.scale(breathe, breathe);
      ctx.translate(-centerX, -centerY);

      // Draw processed image - black background has been removed for proper glow effect
      ctx.drawImage(
        processedCanvasRef.current,
        imgX,
        imgY,
        imageDimensions.width,
        imageDimensions.height
      );

      // Apply color overlay effect ONLY to non-transparent pixels
      // Uses 'source-atop' composite to respect the alpha channel
      if (config.colorShift) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `${colors.primary}${Math.floor(0.12 * intensity * 255).toString(16).padStart(2, '0')}`;
        ctx.fillRect(imgX, imgY, imageDimensions.width, imageDimensions.height);

        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = `${colors.primary}${Math.floor(0.08 * intensity * 255).toString(16).padStart(2, '0')}`;
        ctx.fillRect(imgX, imgY, imageDimensions.width, imageDimensions.height);

        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.restore();

      // Continue animation
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [imageLoaded, state, emotion, intensity, colors, stateConfig, imageDimensions, canvasSize]);

  // Draw placeholder if no image
  const drawPlaceholder = () => (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: `radial-gradient(circle, ${colors.secondary}20, transparent)`,
      }}
    >
      <span
        className="text-7xl font-light opacity-60"
        style={{ color: colors.primary }}
      >
        Z
      </span>
    </div>
  );

  // Calculate dynamic drop-shadow filter for silhouette glow
  // drop-shadow respects PNG transparency - this is the KEY to proper glow
  const glowPulse = stateConfig.glowIntensity * intensity;

  // Build multiple drop-shadows for layered glow effect
  const glowSize1 = Math.round(8 + glowPulse * 12);
  const glowSize2 = Math.round(16 + glowPulse * 24);
  const glowSize3 = Math.round(24 + glowPulse * 36);

  const dropShadowFilter = [
    `drop-shadow(0 0 ${glowSize1}px ${colors.primary})`,
    `drop-shadow(0 0 ${glowSize2}px ${colors.glow})`,
    `drop-shadow(0 0 ${glowSize3}px ${colors.secondary}60)`,
  ].join(' ');

  // Error state adds hue rotation
  const errorFilter = state === 'error' ? 'hue-rotate(-40deg) ' : '';

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center ${fillContainer ? 'w-full h-full' : ''}`}
      style={{
        width: fillContainer ? '100%' : 320,
        height: fillContainer ? '100%' : 320,
        minWidth: fillContainer ? 0 : 320,
        minHeight: fillContainer ? 0 : 320,
      }}
    >
      {/* Main avatar canvas - drop-shadow filter creates silhouette-respecting glow */}
      <canvas
        ref={canvasRef}
        width={canvasSize}
        height={canvasSize}
        className="relative z-10"
        style={{
          width: canvasSize,
          height: canvasSize,
          // drop-shadow respects the alpha channel of the canvas content
          // This creates a glow that follows the avatar silhouette, not the rectangular bounds
          filter: `${errorFilter}${dropShadowFilter}`,
        }}
      />

      {/* Placeholder if not loaded */}
      {!imageLoaded && (
        <div
          className="absolute z-10 flex items-center justify-center"
          style={{ width: canvasSize, height: canvasSize }}
        >
          {drawPlaceholder()}
        </div>
      )}

      {/* State indicator - subtle bottom glow bar */}
      <div
        className="absolute left-1/2 -translate-x-1/2 h-1 rounded-full transition-all duration-500"
        style={{
          bottom: fillContainer ? '10%' : 0,
          width: state === 'idle' ? '30%' : state === 'listening' ? '60%' : state === 'speaking' ? '80%' : '40%',
          background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
          opacity: state === 'idle' ? 0.3 : 0.8,
          filter: `drop-shadow(0 0 10px ${colors.primary}) drop-shadow(0 0 20px ${colors.glow})`,
        }}
      />

      {/* Ripple effect for speaking/listening */}
      {(state === 'speaking' || state === 'listening') && (
        <>
          <div
            className="absolute pointer-events-none animate-ping"
            style={{
              width: canvasSize * 0.8,
              height: canvasSize * 0.8,
              borderRadius: '50%',
              border: `2px solid ${colors.primary}30`,
              animationDuration: state === 'speaking' ? '1s' : '1.5s',
            }}
          />
          <div
            className="absolute pointer-events-none animate-ping"
            style={{
              width: canvasSize * 0.7,
              height: canvasSize * 0.7,
              borderRadius: '50%',
              border: `1px solid ${colors.secondary}20`,
              animationDuration: state === 'speaking' ? '1.2s' : '1.8s',
              animationDelay: '0.3s',
            }}
          />
        </>
      )}

      {/* New Integration Celebration Glow Effect */}
      {newIntegration && (
        <>
          {/* Outer golden glow ring - expanding */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: canvasSize * 0.9,
              height: canvasSize * 0.9,
              borderRadius: '50%',
              background: 'radial-gradient(circle, transparent 60%, rgba(255, 215, 0, 0.2) 80%, transparent 100%)',
              animation: 'integrationGlow 2s ease-in-out infinite',
            }}
          />
          {/* Inner celebration sparkle ring */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: canvasSize * 0.85,
              height: canvasSize * 0.85,
              borderRadius: '50%',
              background: 'conic-gradient(from 0deg, transparent, rgba(255, 215, 0, 0.4), transparent, rgba(16, 185, 129, 0.4), transparent)',
              animation: 'integrationSpin 3s linear infinite',
            }}
          />
          {/* Pulsing border highlight */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: canvasSize * 0.8,
              height: canvasSize * 0.8,
              borderRadius: '50%',
              border: '2px solid rgba(255, 215, 0, 0.5)',
              filter: 'drop-shadow(0 0 10px rgba(255, 215, 0, 0.4)) drop-shadow(0 0 20px rgba(255, 215, 0, 0.2))',
              animation: 'integrationPulse 1.5s ease-in-out infinite',
            }}
          />
          {/* Floating sparkles */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i % 2 === 0 ? '#FFD700' : '#10B981',
                filter: `drop-shadow(0 0 4px ${i % 2 === 0 ? '#FFD700' : '#10B981'})`,
                left: '50%',
                top: '50%',
                transform: `rotate(${i * 60}deg) translateY(-${canvasSize * 0.45}px)`,
                animation: `integrationSparkle 2s ease-in-out infinite ${i * 0.3}s`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Export emotion types for use in other components
export type { EmotionType };
export { EMOTION_COLORS };
