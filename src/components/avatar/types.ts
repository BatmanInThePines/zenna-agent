/**
 * ZENNA Avatar V2 - Type Definitions
 *
 * Shared types for the open-source 3D avatar system.
 * Compatible with Babylon.js, Three.js, and GLB/glTF models.
 */

// =============================================================================
// EMOTION SYSTEM
// =============================================================================

/**
 * Emotional states supported by the avatar system.
 * Based on Plutchik's wheel of emotions + conversational contexts.
 */
export type EmotionType =
  // Primary emotions (Plutchik)
  | 'joy'
  | 'trust'
  | 'fear'
  | 'surprise'
  | 'sadness'
  | 'anticipation'
  | 'anger'
  | 'disgust'
  // Conversational contexts
  | 'neutral'
  | 'curious'
  | 'helpful'
  | 'empathetic'
  | 'thoughtful'
  | 'encouraging'
  | 'calming'
  | 'focused';

/**
 * Color scheme for each emotion state.
 */
export interface EmotionColors {
  primary: string;    // Main color (hex)
  secondary: string;  // Secondary color (hex)
  glow: string;       // Glow color (rgba)
}

/**
 * Full emotion color map.
 */
export const EMOTION_COLORS: Record<EmotionType, EmotionColors> = {
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

// =============================================================================
// AVATAR STATE
// =============================================================================

/**
 * Current state of the avatar (affects animations and appearance).
 */
export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/**
 * Animation configuration per state.
 */
export interface StateAnimationConfig {
  breathingSpeed: number;
  breathingAmount: number;
  glowPulseSpeed: number;
  glowIntensity: number;
  colorShift: boolean;
  blinkRate?: number;      // Blinks per minute
  eyeMovement?: number;    // Eye saccade intensity 0-1
  mouthMovement?: number;  // Idle mouth movement 0-1
}

/**
 * Default animation configurations per state.
 */
export const STATE_ANIMATION_CONFIGS: Record<AvatarState, StateAnimationConfig> = {
  idle: {
    breathingSpeed: 0.5,
    breathingAmount: 0.008,
    glowPulseSpeed: 0.3,
    glowIntensity: 0.3,
    colorShift: false,
    blinkRate: 15,
    eyeMovement: 0.2,
    mouthMovement: 0,
  },
  listening: {
    breathingSpeed: 0.8,
    breathingAmount: 0.015,
    glowPulseSpeed: 2,
    glowIntensity: 0.7,
    colorShift: true,
    blinkRate: 12,
    eyeMovement: 0.4,
    mouthMovement: 0,
  },
  thinking: {
    breathingSpeed: 0.2,
    breathingAmount: 0.005,
    glowPulseSpeed: 0.5,
    glowIntensity: 0.4,
    colorShift: false,
    blinkRate: 8,
    eyeMovement: 0.6,
    mouthMovement: 0,
  },
  speaking: {
    breathingSpeed: 1.5,
    breathingAmount: 0.02,
    glowPulseSpeed: 4,
    glowIntensity: 0.8,
    colorShift: true,
    blinkRate: 18,
    eyeMovement: 0.3,
    mouthMovement: 1.0,
  },
  error: {
    breathingSpeed: 4,
    breathingAmount: 0.01,
    glowPulseSpeed: 8,
    glowIntensity: 0.9,
    colorShift: false,
    blinkRate: 30,
    eyeMovement: 0.1,
    mouthMovement: 0,
  },
};

// =============================================================================
// 3D AVATAR MODEL
// =============================================================================

/**
 * Avatar model type.
 */
export type AvatarModelType = 'preset' | 'custom' | 'reconstructed' | '2d-fallback';

/**
 * Preset avatar model definition.
 */
export interface PresetAvatarModel {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  modelUrl: string;           // Path to GLB file
  category: 'realistic' | 'stylized' | 'abstract';
  hasBlendshapes: boolean;
  hasBodyRig: boolean;
}

/**
 * Available blendshapes for facial animation.
 * Based on ARKit/ReadyPlayerMe standard blendshape names.
 */
export type FacialBlendshape =
  // Visemes (lip-sync)
  | 'viseme_aa'  // "ah" sound
  | 'viseme_E'   // "ee" sound
  | 'viseme_I'   // "ih" sound
  | 'viseme_O'   // "oh" sound
  | 'viseme_U'   // "oo" sound
  | 'viseme_CH'  // "ch/sh" sound
  | 'viseme_DD'  // "d/t" sound
  | 'viseme_FF'  // "f/v" sound
  | 'viseme_kk'  // "k/g" sound
  | 'viseme_nn'  // "n" sound
  | 'viseme_PP'  // "p/b/m" sound
  | 'viseme_RR'  // "r" sound
  | 'viseme_SS'  // "s/z" sound
  | 'viseme_TH'  // "th" sound
  | 'viseme_sil' // Silence
  // Expressions
  | 'browDownLeft'
  | 'browDownRight'
  | 'browInnerUp'
  | 'browOuterUpLeft'
  | 'browOuterUpRight'
  | 'eyeBlinkLeft'
  | 'eyeBlinkRight'
  | 'eyeSquintLeft'
  | 'eyeSquintRight'
  | 'eyeWideLeft'
  | 'eyeWideRight'
  | 'eyeLookDownLeft'
  | 'eyeLookDownRight'
  | 'eyeLookInLeft'
  | 'eyeLookInRight'
  | 'eyeLookOutLeft'
  | 'eyeLookOutRight'
  | 'eyeLookUpLeft'
  | 'eyeLookUpRight'
  | 'jawForward'
  | 'jawLeft'
  | 'jawRight'
  | 'jawOpen'
  | 'mouthClose'
  | 'mouthFunnel'
  | 'mouthPucker'
  | 'mouthLeft'
  | 'mouthRight'
  | 'mouthSmileLeft'
  | 'mouthSmileRight'
  | 'mouthFrownLeft'
  | 'mouthFrownRight'
  | 'mouthDimpleLeft'
  | 'mouthDimpleRight'
  | 'mouthStretchLeft'
  | 'mouthStretchRight'
  | 'mouthRollLower'
  | 'mouthRollUpper'
  | 'mouthShrugLower'
  | 'mouthShrugUpper'
  | 'mouthPressLeft'
  | 'mouthPressRight'
  | 'mouthLowerDownLeft'
  | 'mouthLowerDownRight'
  | 'mouthUpperUpLeft'
  | 'mouthUpperUpRight'
  | 'cheekPuff'
  | 'cheekSquintLeft'
  | 'cheekSquintRight'
  | 'noseSneerLeft'
  | 'noseSneerRight'
  | 'tongueOut';

/**
 * Blendshape weights for a single frame.
 */
export type BlendshapeWeights = Partial<Record<FacialBlendshape, number>>;

// =============================================================================
// AVATAR CUSTOMIZATION
// =============================================================================

/**
 * Customization options for avatar appearance.
 */
export interface AvatarCustomization {
  // Skin
  skinTone?: string;          // Hex color

  // Hair
  hairStyle?: string;         // Hair model ID
  hairColor?: string;         // Hex color

  // Eyes
  eyeColor?: string;          // Hex color
  eyebrowStyle?: string;      // Eyebrow model ID

  // Clothing
  outfitId?: string;          // Preset outfit ID
  topColor?: string;          // Hex color
  bottomColor?: string;       // Hex color

  // Accessories
  accessories?: string[];     // Array of accessory IDs
}

/**
 * Available outfit option.
 */
export interface OutfitOption {
  id: string;
  name: string;
  thumbnailUrl: string;
  category: 'casual' | 'formal' | 'fantasy' | 'scifi';
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
  };
}

/**
 * Available accessory option.
 */
export interface AccessoryOption {
  id: string;
  name: string;
  thumbnailUrl: string;
  category: 'headwear' | 'eyewear' | 'jewelry' | 'other';
  slot: string;  // Bone attachment point
}

// =============================================================================
// 3D RECONSTRUCTION
// =============================================================================

/**
 * Status of avatar reconstruction job.
 */
export type ReconstructionStatus =
  | 'pending'
  | 'validating'
  | 'processing'
  | 'rigging'
  | 'blendshapes'
  | 'complete'
  | 'failed';

/**
 * Reconstruction job data.
 */
export interface ReconstructionJob {
  id: string;
  userId: string;
  status: ReconstructionStatus;
  progress: number;           // 0-100
  error?: string;

  // Input
  imageCount: number;
  method: 'single-image' | 'photogrammetry';

  // Output
  outputModelUrl?: string;
  outputThumbnailUrl?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Image upload validation result.
 */
export interface ImageValidation {
  valid: boolean;
  width: number;
  height: number;
  hasTransparency: boolean;
  format: string;
  fileSize: number;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// AVATAR PROPS (Component Interface)
// =============================================================================

/**
 * Props for the Avatar3D component.
 * Maintains compatibility with existing 2D Avatar component.
 */
export interface Avatar3DProps {
  // State
  state: AvatarState;
  emotion?: EmotionType;
  intensity?: number;         // 0-1 for emotion intensity

  // Model
  modelUrl?: string;          // GLB model URL
  avatarUrl?: string;         // Fallback 2D image URL
  modelType?: AvatarModelType;

  // Customization
  customization?: AvatarCustomization;

  // Lip-sync
  audioData?: Float32Array;   // Audio waveform for lip-sync
  visemeWeights?: BlendshapeWeights;  // Direct viseme control

  // Layout
  fillContainer?: boolean;

  // Events
  newIntegration?: string | null;  // Triggers celebration effect
  onModelLoaded?: () => void;
  onModelError?: (error: Error) => void;

  // Debug
  showDebug?: boolean;
}

// =============================================================================
// USER AVATAR DATA MODEL
// =============================================================================

/**
 * User's avatar configuration stored in database.
 */
export interface UserAvatarData {
  userId: string;

  // Current avatar
  type: AvatarModelType;
  modelUrl?: string;          // For 3D models
  imageUrl?: string;          // For 2D fallback
  thumbnailUrl?: string;      // Preview thumbnail

  // Customization
  customization?: AvatarCustomization;

  // Reconstruction history
  reconstructionJobs?: ReconstructionJob[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// PRESETS
// =============================================================================

/**
 * Default preset avatars available to all users.
 */
export const PRESET_AVATARS: PresetAvatarModel[] = [
  {
    id: 'zenna-default',
    name: 'Zenna',
    description: 'Default ZENNA avatar with full expression support',
    thumbnailUrl: '/avatars/presets/zenna-default-thumb.png',
    modelUrl: '/avatars/presets/zenna-default.glb',
    category: 'stylized',
    hasBlendshapes: true,
    hasBodyRig: true,
  },
  {
    id: 'abstract-orb',
    name: 'Abstract Orb',
    description: 'Minimalist glowing orb avatar',
    thumbnailUrl: '/avatars/presets/abstract-orb-thumb.png',
    modelUrl: '/avatars/presets/abstract-orb.glb',
    category: 'abstract',
    hasBlendshapes: false,
    hasBodyRig: false,
  },
  {
    id: 'robot-assistant',
    name: 'Robot Assistant',
    description: 'Friendly robot with expressive face',
    thumbnailUrl: '/avatars/presets/robot-assistant-thumb.png',
    modelUrl: '/avatars/presets/robot-assistant.glb',
    category: 'stylized',
    hasBlendshapes: true,
    hasBodyRig: true,
  },
];

/**
 * Default outfit options.
 */
export const DEFAULT_OUTFITS: OutfitOption[] = [
  {
    id: 'casual-tshirt',
    name: 'Casual T-Shirt',
    thumbnailUrl: '/avatars/outfits/casual-tshirt-thumb.png',
    category: 'casual',
    colors: { primary: '#3B82F6', secondary: '#1D4ED8' },
  },
  {
    id: 'formal-suit',
    name: 'Formal Suit',
    thumbnailUrl: '/avatars/outfits/formal-suit-thumb.png',
    category: 'formal',
    colors: { primary: '#1F2937', secondary: '#4B5563', accent: '#F59E0B' },
  },
  {
    id: 'scifi-armor',
    name: 'Sci-Fi Armor',
    thumbnailUrl: '/avatars/outfits/scifi-armor-thumb.png',
    category: 'scifi',
    colors: { primary: '#0F172A', secondary: '#22D3EE', accent: '#A78BFA' },
  },
];
