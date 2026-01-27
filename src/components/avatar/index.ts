/**
 * ZENNA Avatar V2 - Component Exports
 *
 * Central export point for all avatar-related components and utilities.
 */

// =============================================================================
// COMPONENTS
// =============================================================================

// Main renderer (auto-switches between 3D and 2D)
export { default as AvatarRenderer } from './AvatarRenderer';

// 3D Avatar component (Three.js based)
export { default as Avatar3D } from './Avatar3D';

// Avatar settings panel
export { default as AvatarSettings } from './AvatarSettings';

// =============================================================================
// TYPES
// =============================================================================

export type {
  // State types
  AvatarState,
  EmotionType,
  AvatarModelType,

  // Configuration types
  Avatar3DProps,
  AvatarCustomization,
  StateAnimationConfig,
  EmotionColors,

  // Model types
  PresetAvatarModel,
  OutfitOption,
  AccessoryOption,

  // Blendshape types
  FacialBlendshape,
  BlendshapeWeights,

  // Reconstruction types
  ReconstructionJob,
  ReconstructionStatus,
  ImageValidation,

  // Data model
  UserAvatarData,
} from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

export {
  EMOTION_COLORS,
  STATE_ANIMATION_CONFIGS,
  PRESET_AVATARS,
  DEFAULT_OUTFITS,
} from './types';

// =============================================================================
// UTILITIES
// =============================================================================

// Re-export lip-sync utilities
export {
  createLipSyncEngine,
  createAudioAnalyzer,
  getVisemeWeightsAtTime,
  VISEME_WEIGHTS,
} from '@/lib/avatar/lip-sync';

export type {
  Viseme,
  TimedViseme,
  LipSyncConfig,
} from '@/lib/avatar/lip-sync';
