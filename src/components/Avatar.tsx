'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';

interface AvatarProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  avatarUrl?: string;
}

export default function Avatar({ state, avatarUrl }: AvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef(0);

  // Default avatar if none provided
  const defaultAvatarUrl = '/avatar-default.png';
  const currentAvatarUrl = avatarUrl || defaultAvatarUrl;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Load image
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = currentAvatarUrl;

    img.onload = () => {
      imageRef.current = img;
      startAnimation();
    };

    img.onerror = () => {
      // Draw placeholder if image fails to load
      drawPlaceholder(ctx, canvas.width, canvas.height);
    };

    function startAnimation() {
      const animate = () => {
        if (!canvas || !ctx || !imageRef.current) return;

        timeRef.current += 0.016; // ~60fps
        const time = timeRef.current;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Calculate animation parameters based on state
        let scale = 1;
        let glowIntensity = 0;
        let glowColor = 'rgba(99, 102, 241, 0.3)';

        switch (state) {
          case 'idle':
            // Subtle breathing animation
            scale = 1 + Math.sin(time * 0.5) * 0.01;
            glowIntensity = 0.3 + Math.sin(time * 0.5) * 0.1;
            break;

          case 'listening':
            // Pulsing glow, slightly larger
            scale = 1.02 + Math.sin(time * 2) * 0.01;
            glowIntensity = 0.5 + Math.sin(time * 3) * 0.3;
            glowColor = 'rgba(34, 197, 94, 0.4)'; // Green
            break;

          case 'thinking':
            // Slower pulse, dimmer
            scale = 1 + Math.sin(time * 0.3) * 0.005;
            glowIntensity = 0.2 + Math.sin(time * 0.5) * 0.1;
            glowColor = 'rgba(234, 179, 8, 0.3)'; // Yellow
            break;

          case 'speaking':
            // Dynamic pulsing synced to "speech"
            scale = 1.01 + Math.sin(time * 4) * 0.015;
            glowIntensity = 0.4 + Math.sin(time * 5) * 0.3;
            glowColor = 'rgba(59, 130, 246, 0.4)'; // Blue
            break;

          case 'error':
            // Red warning glow
            scale = 1;
            glowIntensity = 0.6 + Math.sin(time * 8) * 0.4;
            glowColor = 'rgba(239, 68, 68, 0.5)'; // Red
            break;
        }

        // Draw glow effect
        ctx.save();
        ctx.shadowBlur = 40 * glowIntensity;
        ctx.shadowColor = glowColor;

        // Center and scale
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const imgSize = Math.min(canvas.width, canvas.height) * 0.8;

        ctx.translate(centerX, centerY);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);

        // Draw circular mask
        ctx.beginPath();
        ctx.arc(centerX, centerY, imgSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        // Draw image
        ctx.drawImage(
          imageRef.current,
          centerX - imgSize / 2,
          centerY - imgSize / 2,
          imgSize,
          imgSize
        );

        ctx.restore();

        // Continue animation
        animationRef.current = requestAnimationFrame(animate);
      };

      animate();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [currentAvatarUrl, state]);

  function drawPlaceholder(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    // Draw circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw "Z" letter
    ctx.font = `bold ${radius}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Z', centerX, centerY);
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={300}
        height={300}
        className="w-[250px] h-[250px] md:w-[300px] md:h-[300px]"
      />

      {/* State indicator ring */}
      <div
        className={`absolute inset-0 rounded-full border-2 pointer-events-none transition-all duration-300 ${
          state === 'listening' ? 'border-green-500/50 animate-pulse' :
          state === 'thinking' ? 'border-yellow-500/30' :
          state === 'speaking' ? 'border-blue-500/50 animate-pulse' :
          state === 'error' ? 'border-red-500/50' :
          'border-transparent'
        }`}
      />
    </div>
  );
}
