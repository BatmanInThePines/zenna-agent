# ZENNA Avatar V2 - Architecture Documentation

> **Last Updated**: February 6, 2026
> **Version**: 2.1

## Overview

ZENNA Avatar V2 is a fully open-source 3D avatar system designed for real-time AI companion applications. It replaces the previous 2D canvas-based avatar with a WebGL-powered 3D rendering system while maintaining backwards compatibility.

## Technology Stack

| Component | Technology | License |
|-----------|------------|---------|
| 3D Engine | Three.js | MIT |
| Model Format | GLB/glTF 2.0 | Khronos |
| Animation | Morph targets / Blendshapes | - |
| Lip-sync | Custom audio analyzer | - |
| Reconstruction | Replicate TRELLIS | Commercial |
| Backend | Next.js API Routes | MIT |
| Storage | Local FS / S3-compatible | - |

## Directory Structure

```
src/
├── components/
│   └── avatar/
│       ├── index.ts                 # Central exports
│       ├── types.ts                 # TypeScript type definitions
│       ├── Avatar3D.tsx             # Three.js 3D renderer
│       ├── AvatarRenderer.tsx       # Smart wrapper (3D/2D switching)
│       └── AvatarSettings.tsx       # Customization UI panel
├── lib/
│   └── avatar/
│       ├── lip-sync.ts              # Viseme-based lip-sync engine
│       └── reconstruction-store.ts  # Job management
└── app/
    └── api/
        └── avatar/
            └── reconstruct/
                ├── route.ts         # Upload & start reconstruction
                └── status/
                    └── route.ts     # Job status polling
```

## Component Architecture

### AvatarRenderer (Smart Wrapper)

```
┌─────────────────────────────────────────┐
│           AvatarRenderer                │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │    Capability Detection         │   │
│  │    - WebGL support check        │   │
│  │    - Performance level check    │   │
│  │    - Device memory check        │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │    Render Mode Decision         │   │
│  │                                 │   │
│  │    if (webgl && modelUrl &&     │   │
│  │        prefer3D && !error)      │   │
│  │        → Avatar3D               │   │
│  │    else                         │   │
│  │        → Avatar (2D)            │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│        ┌───────┴───────┐               │
│        ▼               ▼               │
│   ┌─────────┐    ┌─────────┐          │
│   │ Avatar3D│    │Avatar 2D│          │
│   │ (WebGL) │    │(Canvas) │          │
│   └─────────┘    └─────────┘          │
└─────────────────────────────────────────┘
```

### Avatar3D Component

```
┌─────────────────────────────────────────┐
│              Avatar3D                    │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │        Three.js Scene            │  │
│  │                                  │  │
│  │  ┌─────────┐  ┌─────────────┐   │  │
│  │  │ Camera  │  │   Lights    │   │  │
│  │  │ (35°FOV)│  │ - Ambient   │   │  │
│  │  └─────────┘  │ - Key       │   │  │
│  │               │ - Fill      │   │  │
│  │  ┌─────────┐  │ - Rim       │   │  │
│  │  │ GLB     │  │ - Emotion   │   │  │
│  │  │ Model   │  └─────────────┘   │  │
│  │  └─────────┘                    │  │
│  │       │                         │  │
│  │       ▼                         │  │
│  │  ┌─────────────────────────┐   │  │
│  │  │   Blendshape Mesh       │   │  │
│  │  │   - Facial expressions  │   │  │
│  │  │   - Visemes (lip-sync)  │   │  │
│  │  │   - Eye movement        │   │  │
│  │  │   - Blinking            │   │  │
│  │  └─────────────────────────┘   │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │       Animation Loop             │  │
│  │  - updateBlink()                 │  │
│  │  - updateEyeMovement()           │  │
│  │  - updateLipSync()               │  │
│  │  - updateEmotionExpression()     │  │
│  │  - updateBreathing()             │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Data Models

### UserAvatarData (Database Schema)

```typescript
interface UserAvatarData {
  userId: string;                      // Foreign key to users table

  // Current avatar configuration
  type: 'preset' | 'custom' | 'reconstructed' | '2d-fallback';
  modelUrl?: string;                   // Path to GLB file
  imageUrl?: string;                   // Path to 2D image fallback
  thumbnailUrl?: string;               // Preview thumbnail

  // Customization
  customization?: {
    skinTone?: string;                 // Hex color
    hairStyle?: string;                // Hair model ID
    hairColor?: string;                // Hex color
    eyeColor?: string;                 // Hex color
    outfitId?: string;                 // Preset outfit ID
    topColor?: string;                 // Hex color
    bottomColor?: string;              // Hex color
    accessories?: string[];            // Array of accessory IDs
  };

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### ReconstructionJob (Processing)

```typescript
interface ReconstructionJob {
  id: string;                          // UUID
  userId: string;                      // Owner

  // Status tracking
  status: 'pending' | 'validating' | 'processing' | 'rigging' | 'blendshapes' | 'complete' | 'failed';
  progress: number;                    // 0-100
  error?: string;                      // Error message if failed

  // Input
  imageCount: number;
  method: 'single-image' | 'photogrammetry';
  inputPaths: string[];                // Uploaded image paths

  // Output
  outputModelUrl?: string;             // Generated GLB path
  outputThumbnailUrl?: string;         // Preview image

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

## UI/UX Flow Diagrams

### Avatar Settings Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    Avatar Settings Panel                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────┐  ┌────────────┐  ┌────────────────┐  ┌────────┐│
│  │ Select │  │ Customize  │  │ Set Up My      │  │Progress││
│  │ Avatar │  │            │  │ Avatar         │  │        ││
│  └────────┘  └────────────┘  └────────────────┘  └────────┘│
│       │            │                 │                │     │
│       ▼            ▼                 ▼                ▼     │
│  ┌─────────┐ ┌──────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Preset  │ │ Outfits  │  │ Instructions │  │ Progress │ │
│  │ Gallery │ │          │  │              │  │ Tracker  │ │
│  │         │ │ Skin     │  │ Upload Area  │  │          │ │
│  │ [Zenna] │ │ Tones    │  │              │  │ [=====]  │ │
│  │ [Robot] │ │          │  │ Uploaded     │  │   70%    │ │
│  │ [Orb]   │ │ Hair     │  │ Images Grid  │  │          │ │
│  │         │ │ Colors   │  │              │  │ Status:  │ │
│  │         │ │          │  │ [Generate]   │  │ Rigging  │ │
│  │         │ │ Eye      │  │              │  │          │ │
│  │         │ │ Colors   │  │              │  │          │ │
│  └─────────┘ └──────────┘  └──────────────┘  └──────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 3D Reconstruction Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   Reconstruction Pipeline                        │
└─────────────────────────────────────────────────────────────────┘

User Uploads Images
        │
        ▼
┌───────────────┐
│   Validate    │  → Check resolution (min 1024x1024)
│    Images     │  → Check format (PNG/JPEG/WebP)
│               │  → Check transparency
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  Determine    │
│   Method      │
└───────┬───────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
┌──────┐  ┌──────────────┐
│Single│  │  Multiple    │
│Image │  │   Images     │
└──┬───┘  └──────┬───────┘
   │             │
   ▼             ▼
┌──────────┐  ┌──────────────┐
│ PIFuHD/  │  │ Meshroom/    │
│ PIFuXR   │  │ OpenMVG+     │
│          │  │ OpenMVS      │
└────┬─────┘  └──────┬───────┘
     │               │
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │   Raw Mesh    │  → OBJ/PLY format
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │   Blender     │  → Clean mesh
     │   Pipeline    │  → Decimate if needed
     │               │  → UV unwrap
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │   Auto-Rig    │  → Add skeleton
     │               │  → Weight painting
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │  Blendshapes  │  → Generate expressions
     │  Generation   │  → Generate visemes
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │  Export GLB   │  → Optimized for web
     │               │  → Compressed textures
     └───────┬───────┘
             │
             ▼
     ┌───────────────┐
     │  Store &      │  → Save to storage
     │  Notify       │  → Update job status
     └───────────────┘
```

### Lip-Sync Animation Flow

```
Audio Input
     │
     ▼
┌────────────────┐
│ Audio Analyzer │  → AnalyserNode (Web Audio API)
│                │  → getFloatTimeDomainData()
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Volume & Freq  │  → RMS calculation
│   Analysis     │  → Zero-crossing rate
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Viseme Mapping │  → frequencyToViseme()
│                │  → Volume scaling
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Weight Interp  │  → Smooth transitions
│                │  → Decay non-active
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Apply to Mesh  │  → morphTargetInfluences
│                │  → 60fps update
└────────────────┘
```

## Emotion System

### Emotion Color Map

| Emotion | Primary | Secondary | Glow (RGBA) |
|---------|---------|-----------|-------------|
| Joy | #FFD700 | #FFA500 | rgba(255, 215, 0, 0.6) |
| Trust | #90EE90 | #32CD32 | rgba(144, 238, 144, 0.5) |
| Fear | #800080 | #4B0082 | rgba(128, 0, 128, 0.4) |
| Surprise | #00CED1 | #20B2AA | rgba(0, 206, 209, 0.5) |
| Sadness | #4169E1 | #1E3A8A | rgba(65, 105, 225, 0.4) |
| Anticipation | #FF8C00 | #FF6347 | rgba(255, 140, 0, 0.5) |
| Anger | #DC143C | #8B0000 | rgba(220, 20, 60, 0.5) |
| Disgust | #556B2F | #2E4A1C | rgba(85, 107, 47, 0.4) |
| Neutral | #A78BFA | #7C3AED | rgba(167, 139, 250, 0.4) |
| Curious | #06B6D4 | #0891B2 | rgba(6, 182, 212, 0.5) |
| Helpful | #10B981 | #059669 | rgba(16, 185, 129, 0.5) |
| Empathetic | #EC4899 | #DB2777 | rgba(236, 72, 153, 0.5) |
| Thoughtful | #8B5CF6 | #6D28D9 | rgba(139, 92, 246, 0.5) |
| Encouraging | #F59E0B | #D97706 | rgba(245, 158, 11, 0.6) |
| Calming | #67E8F9 | #22D3EE | rgba(103, 232, 249, 0.4) |
| Focused | #3B82F6 | #2563EB | rgba(59, 130, 246, 0.5) |

### Emotion Expression Blendshapes

```typescript
// Example: Joy expression
{
  mouthSmileLeft: 0.8,
  mouthSmileRight: 0.8,
  cheekSquintLeft: 0.4,
  cheekSquintRight: 0.4,
  browInnerUp: 0.3,
}

// Example: Fear expression
{
  eyeWideLeft: 0.7,
  eyeWideRight: 0.7,
  browInnerUp: 0.6,
  mouthFunnel: 0.3,
}
```

## API Endpoints

### POST /api/avatar/reconstruct

Start a new 3D reconstruction job.

**Request (multipart/form-data):**
```
image_0: File
angle_0: "front" | "three-quarter" | "side" | "back" | "detail"
image_1: File (optional)
angle_1: string (optional)
...
imageCount: number
method: "single-image" | "photogrammetry"
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "uuid",
    "status": "pending",
    "progress": 0,
    "imageCount": 3,
    "method": "photogrammetry",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### GET /api/avatar/reconstruct/status?jobId=xxx

Get status of a reconstruction job.

**Response:**
```json
{
  "job": {
    "id": "uuid",
    "status": "processing",
    "progress": 45,
    "imageCount": 3,
    "method": "photogrammetry",
    "outputModelUrl": null,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:01:30Z"
  }
}
```

## Blendshape Standard (ARKit Compatible)

The system uses ARKit-compatible blendshape names for maximum compatibility with various avatar formats.

### Visemes (15)
- viseme_aa, viseme_E, viseme_I, viseme_O, viseme_U
- viseme_CH, viseme_DD, viseme_FF, viseme_kk, viseme_nn
- viseme_PP, viseme_RR, viseme_SS, viseme_TH, viseme_sil

### Facial Expressions (52)
- Eyes: eyeBlinkLeft/Right, eyeSquintLeft/Right, eyeWideLeft/Right, eyeLook*
- Brows: browDownLeft/Right, browInnerUp, browOuterUpLeft/Right
- Jaw: jawForward, jawLeft, jawRight, jawOpen
- Mouth: mouthClose, mouthFunnel, mouthPucker, mouthSmile*, mouthFrown*, etc.
- Cheeks: cheekPuff, cheekSquintLeft/Right
- Nose: noseSneerLeft/Right
- Tongue: tongueOut

## Performance Considerations

### Optimization Strategies

1. **Dynamic loading**: Three.js is loaded asynchronously to avoid blocking initial render
2. **Level of Detail**: Models should be optimized for web (< 50k triangles)
3. **Texture compression**: Use compressed textures (KTX2/Basis Universal)
4. **Fallback rendering**: Automatic 2D fallback for low-end devices
5. **Animation throttling**: Reduced frame rate on mobile devices

### Recommended Model Specs

| Attribute | Recommended | Maximum |
|-----------|-------------|---------|
| Triangle count | 20,000 | 50,000 |
| Texture size | 1024×1024 | 2048×2048 |
| Blendshapes | 30-50 | 100 |
| Bones | 30-50 | 100 |
| File size | < 5MB | 10MB |

## Security Considerations

1. **File validation**: All uploaded images are validated server-side
2. **Size limits**: Maximum 10MB per image, 50MB total per job
3. **File type checking**: Magic number validation for image formats
4. **User isolation**: Jobs are scoped to authenticated users
5. **Rate limiting**: Prevent abuse of reconstruction API
6. **Cleanup**: Completed jobs and files are automatically cleaned up after 24 hours

## Future Enhancements

- [ ] Voice cloning integration for TTS
- [ ] Real-time motion capture from webcam
- [ ] Gesture recognition and animation
- [ ] Multi-user avatar sessions
- [ ] Avatar marketplace for community models
- [ ] VR/AR avatar embedding
- [ ] Fine-tuned emotion detection from conversation
