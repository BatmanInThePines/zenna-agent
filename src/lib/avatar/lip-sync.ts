/**
 * ZENNA Avatar V2 - Lip-Sync Engine
 *
 * Converts audio data to viseme weights for real-time lip-sync animation.
 * Uses audio analysis to drive mouth shapes without external APIs.
 *
 * Open-source, runs entirely in browser.
 */

import { BlendshapeWeights, FacialBlendshape } from '@/components/avatar/types';

// =============================================================================
// VISEME DEFINITIONS
// =============================================================================

/**
 * Standard viseme set compatible with ARKit/ReadyPlayerMe blendshapes.
 */
export type Viseme =
  | 'sil'    // Silence
  | 'PP'     // P, B, M
  | 'FF'     // F, V
  | 'TH'     // TH (voiced & unvoiced)
  | 'DD'     // T, D
  | 'kk'     // K, G
  | 'CH'     // CH, J, SH
  | 'SS'     // S, Z
  | 'nn'     // N, L
  | 'RR'     // R
  | 'aa'     // A (as in "father")
  | 'E'      // E (as in "bed")
  | 'I'      // I (as in "bit")
  | 'O'      // O (as in "go")
  | 'U';     // U (as in "boot")

/**
 * Blendshape weights for each viseme.
 * Values are normalized 0-1.
 */
export const VISEME_WEIGHTS: Record<Viseme, BlendshapeWeights> = {
  sil: {
    viseme_sil: 1,
    jawOpen: 0,
    mouthClose: 0.2,
  },
  PP: {
    viseme_PP: 1,
    jawOpen: 0,
    mouthPressLeft: 0.5,
    mouthPressRight: 0.5,
    mouthClose: 0.8,
  },
  FF: {
    viseme_FF: 1,
    jawOpen: 0.1,
    mouthFunnel: 0.3,
    mouthLowerDownLeft: 0.2,
    mouthLowerDownRight: 0.2,
  },
  TH: {
    viseme_TH: 1,
    jawOpen: 0.15,
    tongueOut: 0.3,
    mouthFunnel: 0.2,
  },
  DD: {
    viseme_DD: 1,
    jawOpen: 0.15,
    mouthFunnel: 0.1,
  },
  kk: {
    viseme_kk: 1,
    jawOpen: 0.2,
    mouthFunnel: 0.15,
  },
  CH: {
    viseme_CH: 1,
    jawOpen: 0.2,
    mouthFunnel: 0.5,
    mouthPucker: 0.3,
  },
  SS: {
    viseme_SS: 1,
    jawOpen: 0.1,
    mouthFunnel: 0.2,
    mouthStretchLeft: 0.2,
    mouthStretchRight: 0.2,
  },
  nn: {
    viseme_nn: 1,
    jawOpen: 0.1,
    mouthClose: 0.3,
  },
  RR: {
    viseme_RR: 1,
    jawOpen: 0.25,
    mouthFunnel: 0.4,
    mouthPucker: 0.2,
  },
  aa: {
    viseme_aa: 1,
    jawOpen: 0.6,
    mouthFunnel: 0.1,
    mouthStretchLeft: 0.2,
    mouthStretchRight: 0.2,
  },
  E: {
    viseme_E: 1,
    jawOpen: 0.3,
    mouthSmileLeft: 0.3,
    mouthSmileRight: 0.3,
    mouthStretchLeft: 0.4,
    mouthStretchRight: 0.4,
  },
  I: {
    viseme_I: 1,
    jawOpen: 0.2,
    mouthSmileLeft: 0.5,
    mouthSmileRight: 0.5,
    mouthStretchLeft: 0.5,
    mouthStretchRight: 0.5,
  },
  O: {
    viseme_O: 1,
    jawOpen: 0.5,
    mouthFunnel: 0.6,
    mouthPucker: 0.3,
  },
  U: {
    viseme_U: 1,
    jawOpen: 0.3,
    mouthFunnel: 0.5,
    mouthPucker: 0.6,
  },
};

// =============================================================================
// LIP-SYNC ENGINE
// =============================================================================

/**
 * Configuration for the lip-sync engine.
 */
export interface LipSyncConfig {
  smoothing: number;          // Interpolation smoothing factor (0-1)
  minVolume: number;          // Minimum volume threshold to trigger visemes
  maxJawOpen: number;         // Maximum jaw opening (0-1)
  responsiveness: number;     // How quickly mouth responds to audio (0-1)
}

const DEFAULT_CONFIG: LipSyncConfig = {
  smoothing: 0.3,
  minVolume: 0.01,
  maxJawOpen: 0.8,
  responsiveness: 0.7,
};

/**
 * Lip-sync engine state.
 */
interface LipSyncState {
  currentViseme: Viseme;
  currentWeights: BlendshapeWeights;
  targetWeights: BlendshapeWeights;
  lastVolume: number;
  lastFrequency: number;
}

/**
 * Create a new lip-sync engine instance.
 */
export function createLipSyncEngine(config: Partial<LipSyncConfig> = {}) {
  const cfg: LipSyncConfig = { ...DEFAULT_CONFIG, ...config };

  const state: LipSyncState = {
    currentViseme: 'sil',
    currentWeights: { ...VISEME_WEIGHTS.sil },
    targetWeights: { ...VISEME_WEIGHTS.sil },
    lastVolume: 0,
    lastFrequency: 0,
  };

  /**
   * Analyze audio frame and return viseme weights.
   */
  function processAudioFrame(
    audioData: Float32Array,
    sampleRate: number = 44100
  ): BlendshapeWeights {
    // Calculate volume (RMS)
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
      sumSquares += audioData[i] * audioData[i];
    }
    const volume = Math.sqrt(sumSquares / audioData.length);

    // If volume is below threshold, return silence
    if (volume < cfg.minVolume) {
      state.targetWeights = { ...VISEME_WEIGHTS.sil };
      state.currentViseme = 'sil';
    } else {
      // Simple frequency analysis using zero-crossing rate
      let zeroCrossings = 0;
      for (let i = 1; i < audioData.length; i++) {
        if ((audioData[i] >= 0 && audioData[i - 1] < 0) ||
            (audioData[i] < 0 && audioData[i - 1] >= 0)) {
          zeroCrossings++;
        }
      }

      // Estimate dominant frequency from zero-crossing rate
      const estimatedFrequency = (zeroCrossings * sampleRate) / (2 * audioData.length);

      // Map frequency to viseme
      const viseme = frequencyToViseme(estimatedFrequency, volume);
      state.currentViseme = viseme;
      state.targetWeights = { ...VISEME_WEIGHTS[viseme] };

      // Scale jaw opening by volume
      if (state.targetWeights.jawOpen) {
        state.targetWeights.jawOpen = Math.min(
          (state.targetWeights.jawOpen as number) * volume * 3,
          cfg.maxJawOpen
        );
      }

      state.lastVolume = volume;
      state.lastFrequency = estimatedFrequency;
    }

    // Interpolate towards target weights
    for (const key of Object.keys(state.targetWeights) as FacialBlendshape[]) {
      const current = (state.currentWeights[key] as number) || 0;
      const target = (state.targetWeights[key] as number) || 0;
      state.currentWeights[key] = current + (target - current) * cfg.responsiveness;
    }

    // Decay weights not in target
    for (const key of Object.keys(state.currentWeights) as FacialBlendshape[]) {
      if (!(key in state.targetWeights)) {
        const current = (state.currentWeights[key] as number) || 0;
        state.currentWeights[key] = current * (1 - cfg.responsiveness);
        if ((state.currentWeights[key] as number) < 0.01) {
          delete state.currentWeights[key];
        }
      }
    }

    return { ...state.currentWeights };
  }

  /**
   * Map frequency to viseme (simplified heuristic).
   */
  function frequencyToViseme(frequency: number, volume: number): Viseme {
    // Very simplified frequency-to-viseme mapping
    // In production, use proper phoneme recognition or Whisper-based timing

    // High frequency, low volume = sibilants (S, SH)
    if (frequency > 4000 && volume < 0.2) {
      return 'SS';
    }

    // High frequency, higher volume = fricatives (F, V)
    if (frequency > 3000 && volume < 0.3) {
      return 'FF';
    }

    // Mid-high frequency = front vowels (I, E)
    if (frequency > 2000) {
      return volume > 0.4 ? 'E' : 'I';
    }

    // Mid frequency = mid vowels (A)
    if (frequency > 1000) {
      return 'aa';
    }

    // Low-mid frequency = back vowels (O, U)
    if (frequency > 500) {
      return volume > 0.3 ? 'O' : 'U';
    }

    // Very low frequency = nasal/plosives
    if (frequency > 200) {
      return 'nn';
    }

    // Default to AA for voiced sounds
    return volume > cfg.minVolume ? 'aa' : 'sil';
  }

  /**
   * Get current viseme weights.
   */
  function getCurrentWeights(): BlendshapeWeights {
    return { ...state.currentWeights };
  }

  /**
   * Get current viseme name.
   */
  function getCurrentViseme(): Viseme {
    return state.currentViseme;
  }

  /**
   * Reset to silence.
   */
  function reset(): void {
    state.currentViseme = 'sil';
    state.currentWeights = { ...VISEME_WEIGHTS.sil };
    state.targetWeights = { ...VISEME_WEIGHTS.sil };
    state.lastVolume = 0;
    state.lastFrequency = 0;
  }

  return {
    processAudioFrame,
    getCurrentWeights,
    getCurrentViseme,
    reset,
  };
}

// =============================================================================
// AUDIO ANALYZER HOOK UTILITIES
// =============================================================================

/**
 * Create an audio analyzer for real-time lip-sync.
 */
export function createAudioAnalyzer(audioContext: AudioContext): {
  analyser: AnalyserNode;
  getAudioData: () => Float32Array;
  connect: (source: AudioNode) => void;
  disconnect: () => void;
} {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.3;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Float32Array(bufferLength);

  let connectedSource: AudioNode | null = null;

  return {
    analyser,
    getAudioData: () => {
      analyser.getFloatTimeDomainData(dataArray);
      return dataArray;
    },
    connect: (source: AudioNode) => {
      if (connectedSource) {
        connectedSource.disconnect(analyser);
      }
      source.connect(analyser);
      connectedSource = source;
    },
    disconnect: () => {
      if (connectedSource) {
        connectedSource.disconnect(analyser);
        connectedSource = null;
      }
    },
  };
}

// =============================================================================
// VISEME SEQUENCE UTILITIES
// =============================================================================

/**
 * Timed viseme for pre-computed sequences.
 */
export interface TimedViseme {
  viseme: Viseme;
  startTime: number;  // ms
  duration: number;   // ms
  intensity?: number; // 0-1
}

/**
 * Create viseme weights for a specific time in a sequence.
 */
export function getVisemeWeightsAtTime(
  sequence: TimedViseme[],
  currentTime: number,
  smoothing: number = 0.3
): BlendshapeWeights {
  // Find current and next viseme
  let currentViseme: TimedViseme | null = null;
  let nextViseme: TimedViseme | null = null;

  for (let i = 0; i < sequence.length; i++) {
    const v = sequence[i];
    if (currentTime >= v.startTime && currentTime < v.startTime + v.duration) {
      currentViseme = v;
      nextViseme = sequence[i + 1] || null;
      break;
    }
  }

  if (!currentViseme) {
    return { ...VISEME_WEIGHTS.sil };
  }

  const currentWeights = { ...VISEME_WEIGHTS[currentViseme.viseme] };
  const intensity = currentViseme.intensity ?? 1;

  // Scale by intensity
  for (const key of Object.keys(currentWeights) as FacialBlendshape[]) {
    currentWeights[key] = ((currentWeights[key] as number) || 0) * intensity;
  }

  // Blend towards next viseme if close to transition
  if (nextViseme) {
    const timeInViseme = currentTime - currentViseme.startTime;
    const transitionStart = currentViseme.duration * (1 - smoothing);

    if (timeInViseme > transitionStart) {
      const blendFactor = (timeInViseme - transitionStart) / (currentViseme.duration * smoothing);
      const nextWeights = VISEME_WEIGHTS[nextViseme.viseme];

      for (const key of Object.keys(nextWeights) as FacialBlendshape[]) {
        const current = (currentWeights[key] as number) || 0;
        const next = (nextWeights[key] as number) || 0;
        currentWeights[key] = current + (next - current) * blendFactor;
      }
    }
  }

  return currentWeights;
}
