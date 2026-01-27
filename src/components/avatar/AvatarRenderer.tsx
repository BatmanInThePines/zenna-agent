'use client';

/**
 * ZENNA Avatar V2 - Avatar Renderer
 *
 * Smart wrapper component that automatically chooses between:
 * - Avatar3D: WebGL-based 3D rendering with GLB models
 * - Avatar (2D): Canvas-based fallback for older devices
 *
 * Provides seamless switching and maintains consistent interface.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import Avatar3D from './Avatar3D';
import {
  AvatarState,
  EmotionType,
  AvatarModelType,
  AvatarCustomization,
  BlendshapeWeights,
  EMOTION_COLORS,
} from './types';

// Import original 2D Avatar as fallback
import Avatar2D from '../Avatar2D';

// =============================================================================
// TYPES
// =============================================================================

export interface AvatarRendererProps {
  // Core state
  state: AvatarState;
  emotion?: EmotionType;
  intensity?: number;

  // Model configuration
  modelType?: AvatarModelType;
  modelUrl?: string;           // For 3D models
  avatarUrl?: string;          // For 2D fallback images

  // Customization
  customization?: AvatarCustomization;

  // Lip-sync
  audioData?: Float32Array;
  visemeWeights?: BlendshapeWeights;

  // Layout
  fillContainer?: boolean;

  // Events
  newIntegration?: string | null;
  onModelLoaded?: () => void;
  onModelError?: (error: Error) => void;
  onRenderModeChange?: (mode: '3d' | '2d') => void;

  // Settings
  prefer3D?: boolean;          // User preference for 3D rendering
  showDebug?: boolean;
}

// =============================================================================
// WEBGL SUPPORT DETECTION
// =============================================================================

function checkWebGLSupport(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ||
               canvas.getContext('webgl') ||
               canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

function checkPerformanceLevel(): 'high' | 'medium' | 'low' {
  if (typeof window === 'undefined') return 'medium';

  // Check device memory (Chrome only)
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory && nav.deviceMemory < 4) {
    return 'low';
  }

  // Check hardware concurrency
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
    return 'low';
  }

  // Check if mobile
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    return 'medium';
  }

  return 'high';
}

// =============================================================================
// AVATAR RENDERER COMPONENT
// =============================================================================

export default function AvatarRenderer({
  state = 'idle',
  emotion = 'neutral',
  intensity = 0.7,
  modelType = '2d-fallback',
  modelUrl,
  avatarUrl,
  customization,
  audioData,
  visemeWeights,
  fillContainer = false,
  newIntegration = null,
  onModelLoaded,
  onModelError,
  onRenderModeChange,
  prefer3D = true,
  showDebug = false,
}: AvatarRendererProps) {
  // Capability detection
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [performanceLevel, setPerformanceLevel] = useState<'high' | 'medium' | 'low'>('medium');

  // Current render mode
  const [renderMode, setRenderMode] = useState<'3d' | '2d' | 'loading'>('loading');

  // 3D model loading state
  const [model3DError, setModel3DError] = useState(false);

  // =============================================================================
  // CAPABILITY DETECTION
  // =============================================================================

  useEffect(() => {
    const webgl = checkWebGLSupport();
    const performance = checkPerformanceLevel();

    setWebglSupported(webgl);
    setPerformanceLevel(performance);

    // Determine initial render mode
    if (!webgl) {
      setRenderMode('2d');
    } else if (modelType === '2d-fallback' || !prefer3D) {
      setRenderMode('2d');
    } else if (modelUrl && (modelType === 'preset' || modelType === 'custom' || modelType === 'reconstructed')) {
      setRenderMode('3d');
    } else if (avatarUrl) {
      setRenderMode('2d');
    } else {
      // No avatar specified, use 2D placeholder
      setRenderMode('2d');
    }
  }, [modelType, modelUrl, avatarUrl, prefer3D]);

  // Notify parent of render mode changes
  useEffect(() => {
    if (renderMode !== 'loading') {
      onRenderModeChange?.(renderMode);
    }
  }, [renderMode, onRenderModeChange]);

  // =============================================================================
  // EVENT HANDLERS
  // =============================================================================

  const handleModelLoaded = useCallback(() => {
    setModel3DError(false);
    onModelLoaded?.();
  }, [onModelLoaded]);

  const handleModelError = useCallback((error: Error) => {
    console.error('3D model error, falling back to 2D:', error);
    setModel3DError(true);
    setRenderMode('2d');
    onModelError?.(error);
  }, [onModelError]);

  // =============================================================================
  // RENDER DECISION
  // =============================================================================

  const shouldUse3D = useMemo(() => {
    if (renderMode === 'loading') return false;
    if (!webglSupported) return false;
    if (model3DError) return false;
    if (modelType === '2d-fallback') return false;
    if (!prefer3D) return false;
    if (!modelUrl) return false;
    if (performanceLevel === 'low' && !prefer3D) return false;

    return true;
  }, [renderMode, webglSupported, model3DError, modelType, modelUrl, prefer3D, performanceLevel]);

  // =============================================================================
  // RENDER
  // =============================================================================

  // Loading state
  if (renderMode === 'loading' || webglSupported === null) {
    return (
      <div
        className={`relative flex items-center justify-center ${fillContainer ? 'w-full h-full' : ''}`}
        style={{
          width: fillContainer ? '100%' : 320,
          height: fillContainer ? '100%' : 320,
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  // 3D Rendering
  if (shouldUse3D && modelUrl) {
    return (
      <Avatar3D
        state={state}
        emotion={emotion}
        intensity={intensity}
        modelUrl={modelUrl}
        avatarUrl={avatarUrl} // Fallback image
        modelType={modelType}
        customization={customization}
        audioData={audioData}
        visemeWeights={visemeWeights}
        fillContainer={fillContainer}
        newIntegration={newIntegration}
        onModelLoaded={handleModelLoaded}
        onModelError={handleModelError}
        showDebug={showDebug}
      />
    );
  }

  // 2D Fallback Rendering
  return (
    <Avatar2D
      state={state}
      avatarUrl={avatarUrl}
      emotion={emotion}
      intensity={intensity}
      newIntegration={newIntegration}
      fillContainer={fillContainer}
    />
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export { EMOTION_COLORS };
export type { EmotionType, AvatarState } from './types';
