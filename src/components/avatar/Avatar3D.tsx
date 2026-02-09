'use client';

/**
 * ZENNA Avatar V2 - 3D Avatar Component
 *
 * Open-source 3D avatar renderer using Three.js.
 * Supports GLB/glTF models with blendshapes, lip-sync, and emotional expressions.
 *
 * Features:
 * - Real-time 3D rendering with WebGL
 * - Facial blendshapes for expressions and lip-sync
 * - Emotion-based lighting and effects
 * - Graceful fallback to 2D canvas when 3D unavailable
 * - Compatible with ReadyPlayerMe and DLP3D models
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  Avatar3DProps,
  EmotionType,
  EMOTION_COLORS,
  STATE_ANIMATION_CONFIGS,
  BlendshapeWeights,
  FacialBlendshape,
} from './types';

// =============================================================================
// VISEME MAPPING FOR LIP-SYNC
// =============================================================================

/**
 * Maps phoneme/viseme names to blendshape weights.
 * Used for audio-driven lip-sync animation.
 */
const VISEME_MAP: Record<string, BlendshapeWeights> = {
  silence: { viseme_sil: 1, jawOpen: 0 },
  aa: { viseme_aa: 1, jawOpen: 0.6 },
  E: { viseme_E: 1, jawOpen: 0.3 },
  I: { viseme_I: 1, jawOpen: 0.2 },
  O: { viseme_O: 1, jawOpen: 0.5 },
  U: { viseme_U: 1, jawOpen: 0.3 },
  CH: { viseme_CH: 1, jawOpen: 0.2 },
  DD: { viseme_DD: 1, jawOpen: 0.15 },
  FF: { viseme_FF: 1, jawOpen: 0.1 },
  kk: { viseme_kk: 1, jawOpen: 0.2 },
  nn: { viseme_nn: 1, jawOpen: 0.1 },
  PP: { viseme_PP: 1, jawOpen: 0 },
  RR: { viseme_RR: 1, jawOpen: 0.25 },
  SS: { viseme_SS: 1, jawOpen: 0.1 },
  TH: { viseme_TH: 1, jawOpen: 0.15 },
};

// =============================================================================
// EXPRESSION PRESETS FOR EMOTIONS
// =============================================================================

/**
 * Facial expression presets for each emotion.
 */
const EMOTION_EXPRESSIONS: Record<EmotionType, BlendshapeWeights> = {
  joy: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.4, cheekSquintRight: 0.4, browInnerUp: 0.3 },
  trust: { mouthSmileLeft: 0.4, mouthSmileRight: 0.4, eyeSquintLeft: 0.2, eyeSquintRight: 0.2 },
  fear: { eyeWideLeft: 0.7, eyeWideRight: 0.7, browInnerUp: 0.6, mouthFunnel: 0.3 },
  surprise: { eyeWideLeft: 0.9, eyeWideRight: 0.9, browOuterUpLeft: 0.8, browOuterUpRight: 0.8, jawOpen: 0.4 },
  sadness: { browInnerUp: 0.5, browDownLeft: 0.3, browDownRight: 0.3, mouthFrownLeft: 0.6, mouthFrownRight: 0.6 },
  anticipation: { browOuterUpLeft: 0.3, browOuterUpRight: 0.3, eyeWideLeft: 0.3, eyeWideRight: 0.3 },
  anger: { browDownLeft: 0.8, browDownRight: 0.8, eyeSquintLeft: 0.4, eyeSquintRight: 0.4, jawForward: 0.3, noseSneerLeft: 0.5, noseSneerRight: 0.5 },
  disgust: { noseSneerLeft: 0.7, noseSneerRight: 0.7, mouthUpperUpLeft: 0.4, mouthUpperUpRight: 0.4, browDownLeft: 0.3, browDownRight: 0.3 },
  neutral: {},
  curious: { browOuterUpLeft: 0.4, browOuterUpRight: 0.4, eyeWideLeft: 0.2, eyeWideRight: 0.2 },
  helpful: { mouthSmileLeft: 0.5, mouthSmileRight: 0.5, browInnerUp: 0.2 },
  empathetic: { browInnerUp: 0.4, mouthSmileLeft: 0.3, mouthSmileRight: 0.3, eyeSquintLeft: 0.2, eyeSquintRight: 0.2 },
  thoughtful: { browDownLeft: 0.2, browDownRight: 0.2, eyeLookUpLeft: 0.3, eyeLookUpRight: 0.3 },
  encouraging: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, cheekSquintLeft: 0.3, cheekSquintRight: 0.3 },
  calming: { eyeSquintLeft: 0.3, eyeSquintRight: 0.3, mouthSmileLeft: 0.2, mouthSmileRight: 0.2 },
  focused: { browDownLeft: 0.4, browDownRight: 0.4, eyeSquintLeft: 0.3, eyeSquintRight: 0.3 },
};

// =============================================================================
// AVATAR 3D COMPONENT
// =============================================================================

export default function Avatar3D({
  state = 'idle',
  emotion = 'neutral',
  intensity = 0.7,
  modelUrl,
  avatarUrl,
  modelType = 'preset',
  customization,
  audioData,
  visemeWeights,
  fillContainer = false,
  newIntegration = null,
  onModelLoaded,
  onModelError,
  showDebug = false,
}: Avatar3DProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef<THREE.Clock | null>(null);
  const animationFrameRef = useRef<number>(0);

  // Blendshape mesh reference
  const blendshapeMeshRef = useRef<THREE.SkinnedMesh | null>(null);

  // State
  const [modelLoaded, setModelLoaded] = useState(false);
  const [webglSupported, setWebglSupported] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 320, height: 320 });
  const [loadError, setLoadError] = useState<string | null>(null);

  // Animation state
  const animStateRef = useRef({
    time: 0,
    blinkTimer: 0,
    nextBlinkTime: 2,
    eyeTarget: { x: 0, y: 0 },
    eyeTargetTimer: 0,
    currentViseme: 'silence',
    visemeTransition: 0,
    // Max Headroom motion state
    mh: {
      // Jerky head movement
      headTarget: { x: 0, y: 0, z: 0 },
      headCurrent: { x: 0, y: 0, z: 0 },
      headMoveTimer: 0,
      nextHeadMove: 0.3,
      // Position jitter
      posTarget: { x: 0, y: 0 },
      posCurrent: { x: 0, y: 0 },
      posMoveTimer: 0,
      nextPosMove: 0.5,
      // Glitch freeze
      glitchActive: false,
      glitchTimer: 0,
      nextGlitch: 3,
      glitchDuration: 0,
      // Energy burst
      burstActive: false,
      burstTimer: 0,
      burstDuration: 0,
      nextBurst: 5,
      // Stutter/loop (head bob rapid repeat)
      stutterActive: false,
      stutterTimer: 0,
      stutterCount: 0,
      stutterMax: 0,
      // Scale pulse
      scalePulse: 0,
      // Conversation energy (0-1, drives intensity)
      energy: 0.3,
      targetEnergy: 0.3,
    },
  });

  // Get emotion colors and animation config
  const colors = useMemo(() => EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral, [emotion]);
  const animConfig = useMemo(() => STATE_ANIMATION_CONFIGS[state], [state]);

  // =============================================================================
  // WEBGL SUPPORT CHECK
  // =============================================================================

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        setWebglSupported(false);
      }
    } catch {
      setWebglSupported(false);
    }
  }, []);

  // =============================================================================
  // CONTAINER SIZE OBSERVER
  // =============================================================================

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

  // Calculate canvas size
  const canvasSize = fillContainer
    ? Math.min(containerSize.width, containerSize.height)
    : 320;

  // =============================================================================
  // THREE.JS SCENE SETUP
  // =============================================================================

  useEffect(() => {
    if (!canvasRef.current || !webglSupported) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = null; // Transparent background
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(canvasSize, canvasSize);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    rendererRef.current = renderer;

    // Create clock for animations
    clockRef.current = new THREE.Clock();

    // Add lighting
    setupLighting(scene);

    return () => {
      // Cleanup
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (modelRef.current) {
        disposeModel(modelRef.current);
      }
    };
  }, [webglSupported, canvasSize]);

  // =============================================================================
  // LIGHTING SETUP
  // =============================================================================

  const setupLighting = useCallback((scene: THREE.Scene) => {
    // Ambient light — boosted to ensure dark models are visible on dark UI
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    // Key light (main) — strong front lighting
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(1, 1, 2);
    scene.add(keyLight);

    // Fill light — lifted to reduce harsh shadows on dark models
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-1, 0.5, 1);
    scene.add(fillLight);

    // Rim light (back light for separation)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    rimLight.position.set(0, 0.5, -1);
    scene.add(rimLight);

    // Emotion-colored point light (dynamic)
    const emotionLight = new THREE.PointLight(parseInt(colors.primary.replace('#', ''), 16), 0.6, 5);
    emotionLight.position.set(0, 0, 2);
    emotionLight.name = 'emotionLight';
    scene.add(emotionLight);
  }, [colors.primary]);

  // =============================================================================
  // UPDATE EMOTION LIGHTING
  // =============================================================================

  useEffect(() => {
    if (!sceneRef.current) return;

    const emotionLight = sceneRef.current.getObjectByName('emotionLight') as THREE.PointLight | undefined;
    if (emotionLight) {
      const colorHex = parseInt(colors.primary.replace('#', ''), 16);
      emotionLight.color.setHex(colorHex);
      emotionLight.intensity = 0.3 + intensity * 0.5;
    }
  }, [colors, intensity]);

  // =============================================================================
  // MODEL LOADING
  // =============================================================================

  useEffect(() => {
    if (!sceneRef.current || !modelUrl) return;

    const loader = new GLTFLoader();

    // Remove existing model
    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current);
      disposeModel(modelRef.current);
      modelRef.current = null;
      blendshapeMeshRef.current = null;
    }

    setModelLoaded(false);
    setLoadError(null);

    loader.load(
      modelUrl,
      (gltf: GLTF) => {
        const model = gltf.scene;

        // Center and scale the model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Center the model
        model.position.sub(center);

        // Scale to fit in view (target height of ~1.5 units for head)
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 1.5 / maxDim;
        model.scale.setScalar(scale);

        // Adjust position for head-focused view
        model.position.y -= size.y * scale * 0.1;

        // Find mesh with blendshapes
        model.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.SkinnedMesh && child.morphTargetDictionary) {
            blendshapeMeshRef.current = child;
          }
        });

        // Setup animation mixer if model has animations
        if (gltf.animations.length > 0) {
          mixerRef.current = new THREE.AnimationMixer(model);
        }

        sceneRef.current!.add(model);
        modelRef.current = model;
        setModelLoaded(true);
        onModelLoaded?.();
      },
      undefined,
      (error: unknown) => {
        console.error('Model loading error:', error);
        setLoadError('Failed to load 3D model');
        onModelError?.(error instanceof Error ? error : new Error(String(error)));
      }
    );
  }, [modelUrl, onModelLoaded, onModelError]);

  // =============================================================================
  // MODEL DISPOSAL
  // =============================================================================

  const disposeModel = (model: THREE.Object3D) => {
    model.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m: THREE.Material) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  };

  // =============================================================================
  // BLENDSHAPE ANIMATION
  // =============================================================================

  const updateBlendshapes = useCallback((weights: BlendshapeWeights) => {
    if (!blendshapeMeshRef.current) return;

    const mesh = blendshapeMeshRef.current;
    const dictionary = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;

    if (!dictionary || !influences) return;

    // Apply weights
    for (const [name, weight] of Object.entries(weights)) {
      const index = dictionary[name];
      if (index !== undefined && weight !== undefined) {
        // Smooth interpolation
        const currentWeight = influences[index] || 0;
        influences[index] = currentWeight + (weight - currentWeight) * 0.15;
      }
    }
  }, []);

  // =============================================================================
  // BLINK ANIMATION
  // =============================================================================

  const updateBlink = useCallback((deltaTime: number) => {
    if (!blendshapeMeshRef.current) return;

    const animState = animStateRef.current;
    const blinkRate = animConfig.blinkRate || 15;

    animState.blinkTimer += deltaTime;

    if (animState.blinkTimer >= animState.nextBlinkTime) {
      // Start blink
      updateBlendshapes({ eyeBlinkLeft: 1, eyeBlinkRight: 1 });

      // Reset blink timer with random variation
      animState.blinkTimer = 0;
      animState.nextBlinkTime = (60 / blinkRate) + (Math.random() - 0.5) * 2;

      // Auto-unblink after 0.1 seconds
      setTimeout(() => {
        updateBlendshapes({ eyeBlinkLeft: 0, eyeBlinkRight: 0 });
      }, 100);
    }
  }, [animConfig, updateBlendshapes]);

  // =============================================================================
  // EYE MOVEMENT ANIMATION
  // =============================================================================

  const updateEyeMovement = useCallback((deltaTime: number) => {
    if (!blendshapeMeshRef.current) return;

    const animState = animStateRef.current;
    const eyeMovement = animConfig.eyeMovement || 0.2;

    animState.eyeTargetTimer += deltaTime;

    // Update eye target every 2-4 seconds
    if (animState.eyeTargetTimer > 2 + Math.random() * 2) {
      animState.eyeTarget = {
        x: (Math.random() - 0.5) * eyeMovement,
        y: (Math.random() - 0.5) * eyeMovement * 0.5,
      };
      animState.eyeTargetTimer = 0;
    }

    // Apply eye look
    const { x, y } = animState.eyeTarget;

    updateBlendshapes({
      eyeLookInLeft: x > 0 ? x : 0,
      eyeLookOutLeft: x < 0 ? -x : 0,
      eyeLookInRight: x < 0 ? -x : 0,
      eyeLookOutRight: x > 0 ? x : 0,
      eyeLookUpLeft: y > 0 ? y : 0,
      eyeLookUpRight: y > 0 ? y : 0,
      eyeLookDownLeft: y < 0 ? -y : 0,
      eyeLookDownRight: y < 0 ? -y : 0,
    });
  }, [animConfig, updateBlendshapes]);

  // =============================================================================
  // LIP-SYNC FROM AUDIO DATA
  // =============================================================================

  const updateLipSync = useCallback(() => {
    if (!blendshapeMeshRef.current) return;

    // Use provided viseme weights if available
    if (visemeWeights) {
      updateBlendshapes(visemeWeights);
      return;
    }

    // Analyze audio data if available
    if (audioData && audioData.length > 0 && state === 'speaking') {
      // Simple volume-based mouth opening
      // In production, use a proper viseme analyzer
      let sum = 0;
      for (let i = 0; i < audioData.length; i++) {
        sum += Math.abs(audioData[i]);
      }
      const volume = sum / audioData.length;

      // Map volume to mouth opening
      const mouthOpen = Math.min(1, volume * 3);

      updateBlendshapes({
        jawOpen: mouthOpen * 0.6,
        viseme_aa: mouthOpen * 0.5,
        mouthFunnel: mouthOpen * 0.2,
      });
    } else if (state === 'speaking') {
      // Fallback: simple procedural lip movement when speaking
      const time = animStateRef.current.time;
      const mouthOpen = 0.3 + Math.sin(time * 8) * 0.2;

      updateBlendshapes({
        jawOpen: mouthOpen * 0.5,
        viseme_aa: mouthOpen * 0.3,
      });
    } else {
      // Close mouth when not speaking
      updateBlendshapes({
        jawOpen: 0,
        viseme_aa: 0,
        viseme_E: 0,
        viseme_I: 0,
        viseme_O: 0,
        viseme_U: 0,
        mouthFunnel: 0,
      });
    }
  }, [audioData, visemeWeights, state, updateBlendshapes]);

  // =============================================================================
  // EMOTION EXPRESSION
  // =============================================================================

  const updateEmotionExpression = useCallback(() => {
    if (!blendshapeMeshRef.current) return;

    const expressionWeights = EMOTION_EXPRESSIONS[emotion] || {};

    // Apply expression weights scaled by intensity
    const scaledWeights: BlendshapeWeights = {};
    for (const [name, weight] of Object.entries(expressionWeights)) {
      scaledWeights[name as FacialBlendshape] = (weight || 0) * intensity;
    }

    updateBlendshapes(scaledWeights);
  }, [emotion, intensity, updateBlendshapes]);

  // =============================================================================
  // BREATHING ANIMATION
  // =============================================================================

  const updateBreathing = useCallback((time: number) => {
    if (!modelRef.current) return;

    const breathe = 1 + Math.sin(time * animConfig.breathingSpeed) * animConfig.breathingAmount;
    const mh = animStateRef.current.mh;
    const scalePulse = 1 + mh.scalePulse * 0.05;
    modelRef.current.scale.setScalar(breathe * 1.5 * scalePulse); // Base scale * breathing * pulse
  }, [animConfig]);

  // =============================================================================
  // MAX HEADROOM MOTION ENGINE
  // =============================================================================
  //
  // Emulates the iconic Max Headroom style:
  // - Jerky, snap-to-pose head rotations
  // - Positional jitter (digital interference)
  // - Glitch freezes (buffering pauses)
  // - Energy bursts (rapid-fire movement when excited)
  // - Stutter loops (rapid head bobs on repeat)
  // - Intensity scales with conversation energy
  // =============================================================================

  const updateMaxHeadroomMotion = useCallback((deltaTime: number) => {
    if (!modelRef.current) return;

    const mh = animStateRef.current.mh;
    const time = animStateRef.current.time;

    // --- Energy scaling based on state ---
    // Speaking = high energy, thinking = low, idle = medium-low
    const stateEnergy: Record<string, number> = {
      idle: 0.2,
      listening: 0.35,
      thinking: 0.15,
      speaking: 0.7,
      error: 0.9,
    };
    mh.targetEnergy = stateEnergy[state] || 0.3;

    // Emotion modulates energy
    const emotionBoost: Record<string, number> = {
      joy: 0.15, surprise: 0.25, anger: 0.2, fear: 0.15,
      encouraging: 0.1, curious: 0.1, focused: -0.1, calming: -0.15,
      thoughtful: -0.1, neutral: 0, helpful: 0.05, empathetic: 0,
      trust: 0, anticipation: 0.1, sadness: -0.1, disgust: 0.05,
    };
    mh.targetEnergy += (emotionBoost[emotion] || 0);
    mh.targetEnergy = Math.max(0.05, Math.min(1, mh.targetEnergy));

    // Smooth energy transition
    mh.energy += (mh.targetEnergy - mh.energy) * deltaTime * 2;

    const energy = mh.energy;

    // --- Glitch Freeze ---
    mh.glitchTimer += deltaTime;
    if (!mh.glitchActive && mh.glitchTimer >= mh.nextGlitch) {
      // Trigger a freeze glitch (more frequent at higher energy)
      mh.glitchActive = true;
      mh.glitchTimer = 0;
      mh.glitchDuration = 0.05 + Math.random() * 0.15; // 50-200ms freeze
      mh.nextGlitch = (2 + Math.random() * 6) * (1.5 - energy); // More frequent when energetic
    }
    if (mh.glitchActive) {
      mh.glitchTimer += deltaTime;
      if (mh.glitchTimer >= mh.glitchDuration) {
        mh.glitchActive = false;
        mh.glitchTimer = 0;
      }
      // During glitch: don't update position/rotation (freeze in place)
      return;
    }

    // --- Energy Burst ---
    mh.burstTimer += deltaTime;
    if (!mh.burstActive && mh.burstTimer >= mh.nextBurst && energy > 0.4) {
      mh.burstActive = true;
      mh.burstTimer = 0;
      mh.burstDuration = 0.3 + Math.random() * 0.5;
      mh.nextBurst = (3 + Math.random() * 5) * (1.5 - energy);
    }
    if (mh.burstActive) {
      mh.burstTimer += deltaTime;
      if (mh.burstTimer >= mh.burstDuration) {
        mh.burstActive = false;
        mh.burstTimer = 0;
        mh.scalePulse = 0;
      }
    }

    const burstMultiplier = mh.burstActive ? 2.5 : 1;

    // --- Stutter/Loop (rapid head bobs) ---
    if (!mh.stutterActive && state === 'speaking' && Math.random() < 0.003 * energy) {
      mh.stutterActive = true;
      mh.stutterTimer = 0;
      mh.stutterCount = 0;
      mh.stutterMax = 2 + Math.floor(Math.random() * 4); // 2-5 rapid bobs
    }
    if (mh.stutterActive) {
      mh.stutterTimer += deltaTime;
      if (mh.stutterTimer > 0.08) { // 80ms per bob
        mh.stutterTimer = 0;
        mh.stutterCount++;
        // Alternate head position for stutter effect
        mh.headTarget.x = (mh.stutterCount % 2 === 0 ? 0.05 : -0.05) * energy;
        mh.headTarget.y = (mh.stutterCount % 2 === 0 ? 0.03 : -0.03) * energy;
        if (mh.stutterCount >= mh.stutterMax) {
          mh.stutterActive = false;
        }
      }
    }

    // --- Jerky Head Rotation ---
    mh.headMoveTimer += deltaTime;
    const headMoveInterval = mh.stutterActive ? 0.08 :
      (0.15 + Math.random() * 0.4) / (burstMultiplier * (0.5 + energy));

    if (mh.headMoveTimer >= mh.nextHeadMove && !mh.stutterActive) {
      // Snap to new rotation target (Max Headroom overshoots then corrects)
      const range = 0.12 * energy * burstMultiplier;
      mh.headTarget = {
        x: (Math.random() - 0.5) * range,        // Tilt left/right
        y: (Math.random() - 0.5) * range * 0.7,   // Nod up/down
        z: (Math.random() - 0.5) * range * 0.3,   // Roll
      };
      mh.headMoveTimer = 0;
      mh.nextHeadMove = headMoveInterval;

      // Occasional dramatic head turn
      if (Math.random() < 0.08 * energy) {
        mh.headTarget.x *= 3;
        mh.headTarget.y *= 2;
      }
    }

    // Snap interpolation (jerky, not smooth - key to Max Headroom feel)
    // High lerp = snappy, low = smooth. Max is snappy.
    const headLerp = 0.3 + energy * 0.4; // 0.3-0.7 range
    mh.headCurrent.x += (mh.headTarget.x - mh.headCurrent.x) * headLerp;
    mh.headCurrent.y += (mh.headTarget.y - mh.headCurrent.y) * headLerp;
    mh.headCurrent.z += (mh.headTarget.z - mh.headCurrent.z) * headLerp;

    // --- Positional Jitter (digital interference) ---
    mh.posMoveTimer += deltaTime;
    const posMoveInterval = (0.2 + Math.random() * 0.5) / (burstMultiplier * (0.5 + energy));

    if (mh.posMoveTimer >= mh.nextPosMove) {
      const posRange = 0.03 * energy * burstMultiplier;
      mh.posTarget = {
        x: (Math.random() - 0.5) * posRange,
        y: (Math.random() - 0.5) * posRange * 0.5,
      };
      mh.posMoveTimer = 0;
      mh.nextPosMove = posMoveInterval;
    }

    const posLerp = 0.35 + energy * 0.3;
    mh.posCurrent.x += (mh.posTarget.x - mh.posCurrent.x) * posLerp;
    mh.posCurrent.y += (mh.posTarget.y - mh.posCurrent.y) * posLerp;

    // --- Scale Pulse during bursts ---
    if (mh.burstActive) {
      mh.scalePulse = Math.sin(time * 15) * 0.3 * energy;
    } else {
      mh.scalePulse *= 0.9; // Decay
    }

    // --- Apply transforms to model ---
    const model = modelRef.current;

    // Base position (centered) + jitter
    model.rotation.x = mh.headCurrent.y; // Nod
    model.rotation.y = mh.headCurrent.x; // Turn
    model.rotation.z = mh.headCurrent.z; // Roll

    // Position jitter (add to existing centered position)
    // Store base position on first call
    if (!(model.userData as { baseY?: number }).baseY) {
      (model.userData as { baseY: number }).baseY = model.position.y;
      (model.userData as { baseX: number }).baseX = model.position.x;
    }
    const baseX = (model.userData as { baseX: number }).baseX || 0;
    const baseY = (model.userData as { baseY: number }).baseY || 0;
    model.position.x = baseX + mh.posCurrent.x;
    model.position.y = baseY + mh.posCurrent.y;

    // --- Exaggerated facial expressions during bursts ---
    if (mh.burstActive && blendshapeMeshRef.current) {
      const burstFace: BlendshapeWeights = {};
      // Wide eyes + raised brows during energy bursts (Max's iconic look)
      burstFace.eyeWideLeft = 0.3 * energy;
      burstFace.eyeWideRight = 0.3 * energy;
      burstFace.browOuterUpLeft = 0.4 * energy;
      burstFace.browOuterUpRight = 0.4 * energy;
      // Occasional smirk (Max's smug grin)
      if (Math.sin(time * 12) > 0.5) {
        burstFace.mouthSmileLeft = 0.3 * energy;
        burstFace.mouthSmileRight = 0.2 * energy; // Asymmetric smirk
      }
      updateBlendshapes(burstFace);
    }
  }, [state, emotion, updateBlendshapes]);

  // =============================================================================
  // ANIMATION LOOP
  // =============================================================================

  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !clockRef.current) return;

    const animate = () => {
      const deltaTime = clockRef.current!.getDelta();
      animStateRef.current.time += deltaTime;

      // Update mixer if exists
      if (mixerRef.current) {
        mixerRef.current.update(deltaTime);
      }

      // Update animations
      if (modelLoaded && blendshapeMeshRef.current) {
        updateBlink(deltaTime);
        updateEyeMovement(deltaTime);
        updateLipSync();
        updateEmotionExpression();
      }

      // Max Headroom motion (jerky movements, glitches, energy bursts)
      updateMaxHeadroomMotion(deltaTime);

      // Breathing animation
      updateBreathing(animStateRef.current.time);

      // Render
      rendererRef.current!.render(sceneRef.current!, cameraRef.current!);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [modelLoaded, updateBlink, updateEyeMovement, updateLipSync, updateEmotionExpression, updateBreathing, updateMaxHeadroomMotion]);

  // =============================================================================
  // RESIZE HANDLER
  // =============================================================================

  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current) return;

    rendererRef.current.setSize(canvasSize, canvasSize);
    cameraRef.current.aspect = 1;
    cameraRef.current.updateProjectionMatrix();
  }, [canvasSize]);

  // =============================================================================
  // GLOW EFFECT (CSS-based for performance)
  // =============================================================================

  const glowPulse = animConfig.glowIntensity * intensity;
  const glowSize1 = Math.round(8 + glowPulse * 12);
  const glowSize2 = Math.round(16 + glowPulse * 24);
  const glowSize3 = Math.round(24 + glowPulse * 36);

  const dropShadowFilter = [
    `drop-shadow(0 0 ${glowSize1}px ${colors.primary})`,
    `drop-shadow(0 0 ${glowSize2}px ${colors.glow})`,
    `drop-shadow(0 0 ${glowSize3}px ${colors.secondary}60)`,
  ].join(' ');

  const errorFilter = state === 'error' ? 'hue-rotate(-40deg) ' : '';

  // Brightness + contrast boost — lifts dark avatars so they pop on the dark UI
  // Applied as CSS filters (non-destructive, doesn't alter image data)
  const brightnessFilter = 'brightness(2.0) contrast(1.2) ';

  // =============================================================================
  // RENDER
  // =============================================================================

  // Fall back to 2D if WebGL not supported or no model
  if (!webglSupported || loadError) {
    return (
      <div
        ref={containerRef}
        className={`relative flex items-center justify-center ${fillContainer ? 'w-full h-full' : ''}`}
        style={{
          width: fillContainer ? '100%' : 320,
          height: fillContainer ? '100%' : 320,
        }}
      >
        {/* Fallback message */}
        <div className="text-center text-zenna-muted">
          <p className="text-sm mb-2">{loadError || '3D not supported'}</p>
          <p className="text-xs">Using 2D fallback</p>
        </div>
      </div>
    );
  }

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
      {/* 3D Canvas — brightness boost + glow */}
      <canvas
        ref={canvasRef}
        className="relative z-10"
        style={{
          width: canvasSize,
          height: canvasSize,
          filter: `${errorFilter}${brightnessFilter}${dropShadowFilter}`,
        }}
      />

      {/* Loading indicator */}
      {!modelLoaded && modelUrl && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="spinner" />
        </div>
      )}

      {/* State indicator bar */}
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

      {/* Ripple effects for speaking/listening */}
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

      {/* Integration celebration effect */}
      {newIntegration && (
        <>
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
        </>
      )}

      {/* Debug overlay */}
      {showDebug && (
        <div className="absolute top-2 left-2 text-xs text-white/50 bg-black/50 p-2 rounded">
          <div>State: {state}</div>
          <div>Emotion: {emotion}</div>
          <div>Intensity: {intensity.toFixed(2)}</div>
          <div>Model: {modelLoaded ? 'Loaded' : 'Loading...'}</div>
          <div>Blendshapes: {blendshapeMeshRef.current ? 'Yes' : 'No'}</div>
          <div>Energy: {animStateRef.current.mh.energy.toFixed(2)}</div>
          <div>Glitch: {animStateRef.current.mh.glitchActive ? 'FREEZE' : 'off'}</div>
          <div>Burst: {animStateRef.current.mh.burstActive ? 'ACTIVE' : 'off'}</div>
          <div>Stutter: {animStateRef.current.mh.stutterActive ? `${animStateRef.current.mh.stutterCount}/${animStateRef.current.mh.stutterMax}` : 'off'}</div>
        </div>
      )}
    </div>
  );
}

// Re-export types
export { EMOTION_COLORS } from './types';
export type { EmotionType, AvatarState, Avatar3DProps } from './types';
