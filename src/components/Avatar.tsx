'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

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
}

export default function Avatar({
  state,
  avatarUrl,
  emotion = 'neutral',
  intensity = 0.7,
  newIntegration = null
}: AvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 300, height: 300 });

  // Default avatar if none provided
  const defaultAvatarUrl = '/avatar-default.png';
  const currentAvatarUrl = avatarUrl || defaultAvatarUrl;

  // Get current emotion colors
  const colors = useMemo(() => EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral, [emotion]);

  // State-based animation parameters
  const stateConfig = useMemo(() => {
    switch (state) {
      case 'idle':
        return {
          breathingSpeed: 0.5,
          breathingAmount: 0.008,
          glowPulseSpeed: 0.3,
          glowIntensity: 0.3,
          particleCount: 5,
          particleSpeed: 0.3,
          auraLayers: 2,
          colorShift: false,
        };
      case 'listening':
        return {
          breathingSpeed: 0.8,
          breathingAmount: 0.015,
          glowPulseSpeed: 2,
          glowIntensity: 0.7,
          particleCount: 15,
          particleSpeed: 0.8,
          auraLayers: 4,
          colorShift: true,
        };
      case 'thinking':
        return {
          breathingSpeed: 0.2,
          breathingAmount: 0.005,
          glowPulseSpeed: 0.5,
          glowIntensity: 0.4,
          particleCount: 8,
          particleSpeed: 0.2,
          auraLayers: 3,
          colorShift: false,
        };
      case 'speaking':
        return {
          breathingSpeed: 1.5,
          breathingAmount: 0.02,
          glowPulseSpeed: 4,
          glowIntensity: 0.8,
          particleCount: 20,
          particleSpeed: 1.2,
          auraLayers: 5,
          colorShift: true,
        };
      case 'error':
        return {
          breathingSpeed: 4,
          breathingAmount: 0.01,
          glowPulseSpeed: 8,
          glowIntensity: 0.9,
          particleCount: 10,
          particleSpeed: 2,
          auraLayers: 3,
          colorShift: false,
        };
      default:
        return {
          breathingSpeed: 0.5,
          breathingAmount: 0.008,
          glowPulseSpeed: 0.3,
          glowIntensity: 0.3,
          particleCount: 5,
          particleSpeed: 0.3,
          auraLayers: 2,
          colorShift: false,
        };
    }
  }, [state]);

  // Particle system for ambient effects
  const particlesRef = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    life: number;
  }>>([]);

  // Load and analyze image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = currentAvatarUrl;

    img.onload = () => {
      imageRef.current = img;
      // Preserve aspect ratio
      const maxSize = 300;
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
  }, [currentAvatarUrl]);

  // Main animation loop
  useEffect(() => {
    if (!imageLoaded) return;

    const canvas = canvasRef.current;
    const glowCanvas = glowCanvasRef.current;
    if (!canvas || !glowCanvas) return;

    const ctx = canvas.getContext('2d');
    const glowCtx = glowCanvas.getContext('2d');
    if (!ctx || !glowCtx) return;

    // Initialize particles
    const initParticles = () => {
      particlesRef.current = [];
      for (let i = 0; i < stateConfig.particleCount; i++) {
        particlesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: Math.random() * 4 + 2,
          alpha: Math.random() * 0.5 + 0.2,
          life: Math.random(),
        });
      }
    };

    initParticles();

    const animate = () => {
      if (!canvas || !ctx || !glowCanvas || !glowCtx || !imageRef.current) return;

      timeRef.current += 0.016;
      const time = timeRef.current;
      const config = stateConfig;

      // Clear canvases
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Calculate breathing animation
      const breathe = 1 + Math.sin(time * config.breathingSpeed) * config.breathingAmount;
      const glowPulse = config.glowIntensity * (0.7 + Math.sin(time * config.glowPulseSpeed) * 0.3);

      // Draw aura layers on glow canvas
      for (let i = config.auraLayers; i > 0; i--) {
        const layerAlpha = (glowPulse * intensity) / (i * 1.5);
        const layerSize = imageDimensions.width * 0.5 + (i * 20) + Math.sin(time * 0.5 + i) * 5;

        const gradient = glowCtx.createRadialGradient(
          centerX, centerY, 0,
          centerX, centerY, layerSize
        );

        gradient.addColorStop(0, `${colors.primary}${Math.floor(layerAlpha * 255).toString(16).padStart(2, '0')}`);
        gradient.addColorStop(0.5, `${colors.secondary}${Math.floor(layerAlpha * 0.5 * 255).toString(16).padStart(2, '0')}`);
        gradient.addColorStop(1, 'transparent');

        glowCtx.fillStyle = gradient;
        glowCtx.fillRect(0, 0, glowCanvas.width, glowCanvas.height);
      }

      // Draw particles
      particlesRef.current.forEach((particle, index) => {
        // Update particle
        particle.x += particle.vx * config.particleSpeed;
        particle.y += particle.vy * config.particleSpeed;
        particle.life -= 0.005;

        // Respawn if dead or out of bounds
        if (particle.life <= 0 || particle.x < 0 || particle.x > canvas.width ||
            particle.y < 0 || particle.y > canvas.height) {
          const angle = Math.random() * Math.PI * 2;
          const distance = imageDimensions.width * 0.4 + Math.random() * 30;
          particle.x = centerX + Math.cos(angle) * distance;
          particle.y = centerY + Math.sin(angle) * distance;
          particle.vx = (Math.random() - 0.5) * 2;
          particle.vy = (Math.random() - 0.5) * 2;
          particle.life = 1;
          particle.alpha = Math.random() * 0.5 + 0.2;
        }

        // Draw particle
        const particleAlpha = particle.alpha * particle.life * intensity;
        glowCtx.beginPath();
        glowCtx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        glowCtx.fillStyle = `${colors.primary}${Math.floor(particleAlpha * 255).toString(16).padStart(2, '0')}`;
        glowCtx.fill();
      });

      // Draw the avatar image with effects
      ctx.save();

      // Apply breathing scale
      ctx.translate(centerX, centerY);
      ctx.scale(breathe, breathe);
      ctx.translate(-centerX, -centerY);

      // Draw image (no clipping - preserve transparency)
      const imgX = centerX - imageDimensions.width / 2;
      const imgY = centerY - imageDimensions.height / 2;

      ctx.drawImage(
        imageRef.current,
        imgX,
        imgY,
        imageDimensions.width,
        imageDimensions.height
      );

      // Apply color overlay effect ONLY to non-transparent pixels
      // Uses 'source-atop' composite to respect the alpha channel
      if (config.colorShift) {
        // First, set composite mode so color only applies where there are existing pixels
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `${colors.primary}${Math.floor(0.15 * intensity * 255).toString(16).padStart(2, '0')}`;
        ctx.fillRect(imgX, imgY, imageDimensions.width, imageDimensions.height);

        // Apply a second pass with soft-light for better color blending
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = `${colors.primary}${Math.floor(0.1 * intensity * 255).toString(16).padStart(2, '0')}`;
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
  }, [imageLoaded, state, emotion, intensity, colors, stateConfig, imageDimensions]);

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

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center"
      style={{
        width: 320,
        height: 320,
        filter: state === 'error' ? 'hue-rotate(-40deg)' : undefined,
      }}
    >
      {/* Glow/Aura layer (behind) */}
      <canvas
        ref={glowCanvasRef}
        width={320}
        height={320}
        className="absolute inset-0 pointer-events-none"
        style={{
          filter: 'blur(8px)',
          opacity: intensity,
        }}
      />

      {/* Main avatar canvas */}
      <canvas
        ref={canvasRef}
        width={320}
        height={320}
        className="relative z-10"
      />

      {/* Placeholder if not loaded */}
      {!imageLoaded && (
        <div className="absolute inset-0 z-10">
          {drawPlaceholder()}
        </div>
      )}

      {/* State indicator - subtle bottom glow bar */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 rounded-full transition-all duration-500"
        style={{
          width: state === 'idle' ? '30%' : state === 'listening' ? '60%' : state === 'speaking' ? '80%' : '40%',
          background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
          opacity: state === 'idle' ? 0.3 : 0.8,
          boxShadow: `0 0 20px ${colors.glow}`,
        }}
      />

      {/* Ripple effect for speaking/listening */}
      {(state === 'speaking' || state === 'listening') && (
        <>
          <div
            className="absolute inset-0 rounded-full pointer-events-none animate-ping"
            style={{
              border: `2px solid ${colors.primary}30`,
              animationDuration: state === 'speaking' ? '1s' : '1.5s',
            }}
          />
          <div
            className="absolute inset-4 rounded-full pointer-events-none animate-ping"
            style={{
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
            className="absolute inset-[-20px] rounded-full pointer-events-none animate-pulse"
            style={{
              background: 'radial-gradient(circle, transparent 50%, rgba(255, 215, 0, 0.3) 70%, transparent 100%)',
              animation: 'integrationGlow 2s ease-in-out infinite',
            }}
          />
          {/* Inner celebration sparkle ring */}
          <div
            className="absolute inset-[-10px] rounded-full pointer-events-none"
            style={{
              background: 'conic-gradient(from 0deg, transparent, rgba(255, 215, 0, 0.5), transparent, rgba(16, 185, 129, 0.5), transparent)',
              animation: 'integrationSpin 3s linear infinite',
            }}
          />
          {/* Pulsing border highlight */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              border: '3px solid rgba(255, 215, 0, 0.6)',
              boxShadow: '0 0 30px rgba(255, 215, 0, 0.5), inset 0 0 20px rgba(255, 215, 0, 0.2)',
              animation: 'integrationPulse 1.5s ease-in-out infinite',
            }}
          />
          {/* Floating sparkles */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i % 2 === 0 ? '#FFD700' : '#10B981',
                boxShadow: `0 0 10px ${i % 2 === 0 ? '#FFD700' : '#10B981'}`,
                left: '50%',
                top: '50%',
                transform: `rotate(${i * 60}deg) translateY(-170px)`,
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
