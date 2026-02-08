# Zenna Agent - Architecture Document

> **Document Purpose**: This document provides a comprehensive technical overview of the Zenna Agent system for consumption by Anthropic Claude models (Sonnet/Opus) when evaluating future feature considerations.
>
> **Last Updated**: February 8, 2026
> **Version**: 1.3

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Technology Stack](#3-technology-stack)
4. [Architecture Diagram](#4-architecture-diagram)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Backend Architecture](#6-backend-architecture)
7. [Database Schema](#7-database-schema)
8. [Memory System](#8-memory-system)
9. [External App API (360Aware)](#9-external-app-api-360aware)
10. [External Services & Integrations](#10-external-services--integrations)
11. [MCP & Claude Code Configuration](#11-mcp--claude-code-configuration)
12. [Authentication & Security](#12-authentication--security)
13. [Voice Pipeline](#13-voice-pipeline)
14. [Avatar System](#14-avatar-system)
15. [Smart Home Integration](#15-smart-home-integration)
16. [Key Design Patterns](#16-key-design-patterns)
17. [Environment Configuration](#17-environment-configuration)
18. [Future Considerations](#18-future-considerations)

---

## 1. Executive Summary

**Zenna** is a multi-user, voice-first AI assistant platform built on Next.js 14+ with the following core capabilities:

- **Multi-User Support**: Complete user isolation with role-based access (user/admin/father)
- **Voice Conversation**: Real-time STT (Deepgram) → LLM → TTS (ElevenLabs) pipeline
- **Claude as Primary Brain**: Anthropic Claude Sonnet 4 as default LLM (better rate limits than Gemini free tier)
- **Three-Tier Memory System**: Short-term (session), Long-term (Pinecone RAG), External context (Notion)
- **External App API Access**: Partner app integration via shared secrets (e.g., 360Aware)
- **Smart Home Control**: Philips Hue integration with natural language commands and scheduling
- **Knowledge Integration**: Notion OAuth for external context injection
- **3D Avatar Reconstruction**: Cloud-based image-to-3D pipeline via Replicate TRELLIS
- **Animated Avatar Display**: Max Headroom-style motion engine for dynamic avatar presentation
- **Subscription Management**: Stripe-powered tiered subscriptions with session limits

**Primary Use Case**: Personal/family AI assistant with voice interaction, smart home control, and personalized responses based on user identity and external knowledge sources.

**Secondary Use Case**: Backend AI service for partner applications (360Aware) with guardrailed system prompts.

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ZENNA AGENT                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Voice     │    │    Chat     │    │   Avatar    │    │   Smart     │  │
│  │   Input     │───▶│  Processing │───▶│   Display   │    │    Home     │  │
│  │  (Deepgram) │    │   (LLM)     │    │  (Three.js) │    │   (Hue)     │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│         │                 │                   │                  │          │
│         ▼                 ▼                   ▼                  ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        NEXT.JS API LAYER                            │   │
│  │   /api/zenna/*  │  /api/settings/*  │  /api/avatar/*  │  /api/hue/* │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                 │                   │                  │          │
│         ▼                 ▼                   ▼                  ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         SUPABASE                                    │   │
│  │        PostgreSQL  │  Auth  │  Storage  │  Row-Level Security      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### Core Framework
| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 14.x (App Router) | Full-stack React framework |
| **React** | 18.x | UI library |
| **TypeScript** | 5.x | Type safety |
| **Tailwind CSS** | 3.x | Styling |

### Backend Services
| Service | Purpose | API Type |
|---------|---------|----------|
| **Supabase** | Database, Auth, Storage | REST/Realtime |
| **Vercel** | Hosting, Serverless Functions | Edge/Serverless |

### AI/ML Services
| Service | Purpose | Model/Version |
|---------|---------|---------------|
| **Anthropic Claude** | Primary LLM | claude-sonnet-4-20250514 (default) |
| **Google Gemini** | Fallback LLM | gemini-2.0-flash |
| **OpenAI** | Alternative LLM | User-configured |
| **Pinecone** | Vector Store (RAG) | Long-term memory |
| **ElevenLabs** | Text-to-Speech | eleven_turbo_v2_5 |
| **Deepgram** | Speech-to-Text | nova-2 |
| **Replicate** | 3D Reconstruction | TRELLIS model |

### Frontend Libraries
| Library | Purpose |
|---------|---------|
| **Three.js** | 3D avatar rendering |
| **@react-three/fiber** | React Three.js bindings |
| **@react-three/drei** | Three.js helpers |
| **Framer Motion** | Animations |
| **Lucide React** | Icons |
| **Radix UI** | Accessible components |

### Development Tools
| Tool | Purpose |
|------|---------|
| **Claude Code** | AI-assisted development |
| **MCP Servers** | Stitch (UI design), Chrome automation |
| **ESLint** | Code linting |
| **Prettier** | Code formatting |

---

## 4. Architecture Diagram

### High-Level Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐      │
│  │ VoiceOrb   │   │ ChatPanel  │   │ Avatar3D   │   │ Settings   │      │
│  │ Component  │   │ Component  │   │ Component  │   │ Panel      │      │
│  └─────┬──────┘   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘      │
│        │                │                │                │              │
│        └────────────────┴────────────────┴────────────────┘              │
│                              │                                           │
│                    ┌─────────▼─────────┐                                 │
│                    │  React Hooks      │                                 │
│                    │  - useVoice       │                                 │
│                    │  - useChat        │                                 │
│                    │  - useSettings    │                                 │
│                    │  - useAvatar      │                                 │
│                    └─────────┬─────────┘                                 │
│                              │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS SERVER (Vercel)                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        API Routes                                │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │ /api/auth/*        │ Login, Logout, Session validation          │    │
│  │ /api/zenna/chat    │ Non-streaming LLM + TTS                    │    │
│  │ /api/zenna/chat-stream │ SSE streaming LLM responses            │    │
│  │ /api/zenna/transcribe  │ Audio → Text (Deepgram)                │    │
│  │ /api/zenna/tts-stream  │ Text → Audio stream (ElevenLabs)       │    │
│  │ /api/zenna/speak   │ Direct TTS without LLM                     │    │
│  │ /api/settings/*    │ User preferences, avatar                   │    │
│  │ /api/avatar/*      │ 3D reconstruction pipeline                 │    │
│  │ /api/integrations/notion/* │ OAuth + knowledge sync             │    │
│  │ /api/integrations/hue/*    │ OAuth + light control              │    │
│  │ /api/routines/*    │ Scheduled automation                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     Core Providers                               │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │ SupabaseIdentityStore │ Auth, sessions, user management         │    │
│  │ BrainProviderFactory  │ LLM provider abstraction (Claude/Gemini)│    │
│  │ MemoryService         │ 3-tier memory (short/long/external)     │    │
│  │ ElevenLabsTTS         │ Voice synthesis                         │    │
│  │ DeepgramASR           │ Voice recognition                       │    │
│  │ RoutineExecutor       │ Scheduled task execution                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    SUPABASE     │  │  EXTERNAL APIs  │  │    REPLICATE    │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • PostgreSQL    │  │ • Claude API    │  │ • TRELLIS Model │
│ • Auth          │  │ • Gemini API    │  │ • Webhook       │
│ • Storage       │  │ • ElevenLabs    │  │ • GPU Compute   │
│ • RLS Policies  │  │ • Deepgram      │  │                 │
│                 │  │ • Pinecone      │  │                 │
│                 │  │ • Notion API    │  │                 │
│                 │  │ • Hue API       │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 5. Frontend Architecture

### Directory Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Auth route group
│   │   └── login/page.tsx        # Login page (OAuth + credential)
│   ├── chat/page.tsx             # Main chat interface
│   ├── paywall/page.tsx          # Subscription selection (post-OAuth)
│   ├── settings/page.tsx         # User settings
│   ├── api/                      # API routes (see Backend)
│   │   └── auth/[...nextauth]/   # NextAuth.js handler
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Landing/redirect
│   └── globals.css               # Global styles
│
├── components/
│   ├── chat/
│   │   ├── ChatPanel.tsx         # Message display
│   │   ├── MessageBubble.tsx     # Individual messages
│   │   └── InputBar.tsx          # Text input
│   ├── voice/
│   │   ├── VoiceOrb.tsx          # Animated voice button
│   │   └── AudioVisualizer.tsx   # Waveform display
│   ├── avatar/
│   │   ├── Avatar3DViewer.tsx    # Three.js canvas
│   │   ├── AvatarModel.tsx       # GLB model loader
│   │   ├── MaxHeadroomEngine.ts  # Animation system
│   │   └── AvatarReconstruction.tsx # Upload UI
│   ├── settings/
│   │   ├── SettingsPanel.tsx     # Settings container
│   │   ├── IntegrationCard.tsx   # OAuth connect cards
│   │   └── VoiceSettings.tsx     # TTS configuration
│   └── ui/                       # Reusable UI components
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Dialog.tsx
│       └── ...
│
├── hooks/
│   ├── useVoiceConversation.ts   # Complete voice pipeline
│   ├── useVoiceActivityDetection.ts # VAD for always-listen
│   ├── useAudioPlayer.ts         # TTS playback
│   ├── useChat.ts                # Chat state management
│   ├── useSettings.ts            # User preferences
│   └── useAvatar.ts              # Avatar state
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser client
│   │   └── server.ts             # Server client
│   ├── avatar/
│   │   └── reconstruction-store.ts # Job state management
│   └── utils.ts                  # Shared utilities
│
└── core/                         # Backend-focused code
    └── providers/                # Service abstractions
```

### Key React Components

#### VoiceOrb (`components/voice/VoiceOrb.tsx`)
- Animated circular button for voice interaction
- States: idle, listening, processing, speaking
- Visual feedback via CSS animations and audio level indicators
- Integrates with `useVoiceConversation` hook

#### Avatar3DViewer (`components/avatar/Avatar3DViewer.tsx`)
- Three.js canvas with React Three Fiber
- Loads GLB models from Supabase Storage
- Implements MaxHeadroomEngine for lip-sync and idle animations
- Responsive sizing with device detection

#### ChatPanel (`components/chat/ChatPanel.tsx`)
- Displays conversation history
- Supports streaming text display
- Shows emotion indicators on assistant messages
- Auto-scroll with manual override

### Custom Hooks

#### useVoiceConversation
```typescript
interface VoiceConversationReturn {
  // State
  state: 'idle' | 'listening' | 'processing' | 'thinking' | 'speaking' | 'error';
  transcript: string;
  streamingText: string;
  audioLevel: number;

  // Actions
  startListening(): Promise<void>;
  stopListening(): void;
  interrupt(): void;
  sendMessage(text: string): Promise<void>;
  setAlwaysListening(enabled: boolean): void;
  initialize(): Promise<void>;
}
```

**Features**:
- Push-to-talk and always-listening modes
- Voice Activity Detection (VAD) for hands-free operation
- Barge-in support (interrupt while speaking)
- Streaming text and audio playback
- Error recovery and state management

---

## 6. Backend Architecture

### API Route Structure

```
src/app/api/
├── auth/
│   ├── [...nextauth]/route.ts    # NextAuth.js handler (OAuth + session)
│   ├── login/route.ts            # POST: Legacy credential login
│   ├── logout/route.ts           # POST: End session (clears all cookies)
│   └── session/route.ts          # GET: Get current session info
│
├── zenna/
│   ├── chat/route.ts             # POST: Non-streaming chat
│   ├── chat-stream/route.ts      # POST: SSE streaming chat
│   ├── transcribe/route.ts       # POST: Audio → text
│   ├── tts-stream/route.ts       # POST: Text → audio stream
│   ├── speak/route.ts            # POST: Direct TTS
│   └── greet/route.ts            # POST: Greeting endpoint
│
├── settings/
│   ├── route.ts                  # GET/PATCH: User settings
│   ├── master/route.ts           # GET/PATCH: Master config (Father only)
│   ├── password/route.ts         # POST: Change password
│   ├── avatar/route.ts           # POST/GET/DELETE: Avatar image
│   └── validate-key/route.ts     # POST: Validate API keys
│
├── admin/
│   └── users/
│       ├── route.ts              # GET: List all users (Admin only)
│       └── [id]/
│           ├── role/route.ts     # PATCH: Change user role (Father only)
│           ├── suspend/route.ts  # POST/DELETE: Suspend/unsuspend user
│           ├── archive/route.ts  # POST/DELETE: Archive/restore user
│           └── export/route.ts   # POST: Initiate data export
│
├── avatar/
│   ├── upload/route.ts           # POST: Single image upload
│   └── reconstruct/
│       ├── route.ts              # POST/GET: Start/list jobs
│       ├── status/route.ts       # GET: Poll job status
│       └── webhook/route.ts      # POST: Replicate callback
│
├── integrations/
│   ├── notion/
│   │   ├── connect/route.ts      # GET/POST: OAuth flow
│   │   ├── callback/route.ts     # GET: OAuth callback
│   │   └── ingest/route.ts       # POST: Knowledge sync
│   └── hue/
│       ├── connect/route.ts      # GET/POST: OAuth flow
│       └── callback/route.ts     # GET: OAuth callback
│
├── routines/
│   ├── route.ts                  # GET/POST: List/create routines
│   ├── execute/route.ts          # POST/GET: Cron execution
│   └── [id]/route.ts             # PATCH/DELETE: Manage routine
│
├── stripe/
│   ├── checkout/route.ts         # POST: Create Stripe checkout session
│   └── webhook/route.ts          # POST: Stripe webhook handler
│
├── subscriptions/
│   └── activate-trial/route.ts   # POST: Activate free trial
│
└── onboarding/
    └── welcome/route.ts          # POST: Complete onboarding
```

### Core Providers

#### SupabaseIdentityStore (`core/providers/identity/supabase-identity.ts`)
```typescript
class SupabaseIdentityStore {
  // User Management
  createUser(username: string, password: string, role: string): Promise<User>
  authenticate(username: string, password: string): Promise<AuthResult>
  getUser(userId: string): Promise<User>

  // Session Management
  createSession(userId: string): Promise<Session>
  validateSession(sessionId: string): Promise<boolean>
  generateToken(user: User, session: Session): Promise<string>
  verifyToken(token: string): Promise<TokenPayload>

  // Settings
  updateSettings(userId: string, updates: Partial<Settings>): Promise<void>
  getMasterConfig(): Promise<MasterConfig>
  updateMasterConfig(updates: Partial<MasterConfig>): Promise<void>

  // Conversation History
  getSessionHistory(sessionId: string, userId: string): Promise<Turn[]>
  addSessionTurn(sessionId: string, userId: string, role: string, content: string): Promise<void>
  trimSessionHistory(sessionId: string, userId: string, maxTurns: number): Promise<void>

  // Role Checks
  isFather(userId: string): Promise<boolean>
}
```

#### BrainProviderFactory (`core/providers/brain/index.ts`)
```typescript
interface BrainProvider {
  generateResponse(messages: Message[], options?: Options): Promise<Response>
  generateResponseStream?(messages: Message[], options?: Options): AsyncGenerator<string>
}

class BrainProviderFactory {
  create(providerId: string, config: { apiKey?: string }): BrainProvider
  // Supported: 'gemini-flash', 'gemini-pro', 'claude', 'openai', 'local'
}
```

#### Voice Providers
```typescript
// ElevenLabs TTS
class ElevenLabsTTSProvider {
  synthesize(text: string): Promise<AudioBuffer>
  stream(text: string): ReadableStream
}

// Deepgram ASR
class DeepgramASRProvider {
  transcribe(audioBuffer: Buffer): Promise<string>
  startListening(): WebSocket  // Real-time streaming
}
```

### Request Flow Example (Chat)

```
1. Client sends POST /api/zenna/chat-stream
   Body: { message: "Turn on the bedroom lights" }

2. API Route Handler:
   a. Extract JWT from cookie
   b. Verify token via SupabaseIdentityStore
   c. Fetch user settings and master config
   d. Build system prompt with:
      - Master config system prompt
      - Immutable rules
      - Guardrails (blocked topics)
      - Integration context (Notion pages, Hue lights)
      - User's personal prompt
   e. Retrieve session history (last 40 turns)

3. LLM Call:
   a. Create BrainProvider (Gemini default)
   b. Stream response chunks via SSE
   c. Detect action blocks in response:
      ```json
      {"action": "control_lights", "target": "bedroom", "state": "on"}
      ```

4. Action Execution:
   a. Parse JSON action blocks from response
   b. Execute Hue API call via stored OAuth token
   c. Strip action blocks from display text

5. Post-Processing:
   a. Analyze response for emotion
   b. Save turn to session_turns table
   c. Trim history if > 40 turns

6. Response Stream:
   data: {"type": "text", "content": "I'll turn on "}
   data: {"type": "text", "content": "the bedroom lights "}
   data: {"type": "text", "content": "for you."}
   data: {"type": "complete", "fullResponse": "I'll turn on the bedroom lights for you.", "emotion": "helpful"}
```

---

## 7. Database Schema

### Supabase PostgreSQL Tables

#### `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(255) UNIQUE,  -- Optional, for legacy credential login
  password_hash VARCHAR(255),    -- Optional, for legacy credential login
  role VARCHAR(50) DEFAULT 'user',  -- 'user' | 'admin' | 'admin-support' | 'father' (legacy)
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
```

**Settings JSONB Structure**:
```typescript
interface UserSettings {
  theme?: 'light' | 'dark' | 'system';
  personalPrompt?: string;
  avatarUrl?: string;  // Base64 data URL
  voiceId?: string;
  brainProvider?: 'gemini-flash' | 'gemini-pro' | 'claude' | 'openai';
  apiKeys?: {
    anthropic?: string;
    openai?: string;
  };
  integrations?: {
    hue?: {
      accessToken: string;
      refreshToken: string;
      username: string;
      expiresAt: number;
    };
  };
  externalContext?: {
    notion?: {
      token: string;
      workspaceId: string;
      workspaceName: string;
      ingestionStatus: 'pending' | 'in_progress' | 'complete' | 'failed';
      ingestionProgress: number;
    };
  };
}
```

#### `sessions`
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

#### `conversations`
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255),
  summary TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_started_at ON conversations(started_at);
```

#### `conversation_turns`
```sql
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  audio_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_turns_conversation ON conversation_turns(conversation_id);
CREATE INDEX idx_turns_user ON conversation_turns(user_id);
CREATE INDEX idx_turns_created ON conversation_turns(created_at);
```

#### `session_turns` (Short-term Memory)
```sql
CREATE TABLE session_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  audio_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Used for current session context without loading full history
```

#### `master_config`
```sql
CREATE TABLE master_config (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'master',
  system_prompt TEXT NOT NULL,
  guardrails JSONB DEFAULT '{"blockedTopics": []}'::jsonb,
  voice JSONB DEFAULT '{}'::jsonb,
  default_brain JSONB DEFAULT '{"provider": "gemini-flash"}'::jsonb,
  immutable_rules TEXT[] DEFAULT '{}',
  greeting TEXT,
  default_avatar_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `avatar_reconstruction_jobs`
```sql
CREATE TABLE avatar_reconstruction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',  -- pending | validating | processing | complete | failed
  progress INTEGER DEFAULT 0,  -- 0-100
  image_count INTEGER,
  method VARCHAR(50),  -- 'single' | 'multi-view'
  input_paths TEXT[],
  output_model_url TEXT,
  output_thumbnail_url TEXT,
  replicate_prediction_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_user ON avatar_reconstruction_jobs(user_id);
CREATE INDEX idx_jobs_status ON avatar_reconstruction_jobs(status);
```

#### `subscriptions`
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tier VARCHAR(50) NOT NULL,     -- 'trial' | 'standard' | 'pro' | 'platinum'
  status VARCHAR(50) NOT NULL,   -- 'active' | 'expired' | 'suspended' | 'archived'
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

**Subscription Tiers & Pricing**:
| Tier | Price | Session Limit | Memory Limit |
|------|-------|---------------|--------------|
| Trial | Free (90 days) | 12 | 100 MB |
| Standard | $9.99/month | 50 | 500 MB |
| Pro | $29.99/month | 100 | 2 GB |
| Platinum | $89.99/month | Unlimited | Unlimited |

#### `scheduled_routines`
```sql
CREATE TABLE scheduled_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  integration_id VARCHAR(100) NOT NULL,  -- 'hue'
  action_id VARCHAR(100) NOT NULL,  -- 'turn-on', 'turn-off', 'set-brightness'
  name VARCHAR(255) NOT NULL,
  description TEXT,
  schedule JSONB NOT NULL,  -- {type, time, daysOfWeek?}
  parameters JSONB DEFAULT '{}'::jsonb,  -- {target, brightness, color}
  enabled BOOLEAN DEFAULT true,
  next_execution_at TIMESTAMPTZ,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Schedule JSONB Structure**:
```typescript
interface Schedule {
  type: 'daily' | 'weekly' | 'once';
  time: string;  // "HH:MM" format
  daysOfWeek?: number[];  // 0-6 for weekly
  date?: string;  // ISO date for once
}
```

#### `user_session_tracking` (Rate Limiting)
```sql
CREATE TABLE user_session_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  session_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_session_tracking_user_date ON user_session_tracking(user_id, date);
```

#### `user_consumption` (Usage Metrics)
```sql
CREATE TABLE user_consumption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  api_calls INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  tts_characters INTEGER DEFAULT 0,
  asr_minutes DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);
```

#### `admin_audit_log`
```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,  -- 'role_change', 'suspend', 'archive', 'export'
  target_user_id UUID REFERENCES users(id),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_admin ON admin_audit_log(admin_id);
CREATE INDEX idx_audit_target ON admin_audit_log(target_user_id);
```

#### `data_export_requests` (GDPR Compliance)
```sql
CREATE TABLE data_export_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',  -- pending | processing | ready | expired
  download_url TEXT,
  expires_at TIMESTAMPTZ,  -- 24 hours after ready
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `accounts` (NextAuth OAuth)
```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL,  -- 'google', 'github', 'apple'
  provider_account_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at BIGINT,
  token_type VARCHAR(50),
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_account_id)
);
```

### Helper Functions (PL/pgSQL)

```sql
-- Check if user has sessions remaining for their tier
CREATE OR REPLACE FUNCTION check_session_limit(uid UUID, tier VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  today_count INTEGER;
  tier_limit INTEGER;
BEGIN
  -- Get tier limit
  tier_limit := CASE tier
    WHEN 'trial' THEN 12
    WHEN 'standard' THEN 50
    WHEN 'pro' THEN 100
    WHEN 'platinum' THEN 999999
    ELSE 12
  END;

  -- Get today's count
  SELECT COALESCE(session_count, 0) INTO today_count
  FROM user_session_tracking
  WHERE user_id = uid AND date = CURRENT_DATE;

  RETURN COALESCE(today_count, 0) < tier_limit;
END;
$$ LANGUAGE plpgsql;

-- Increment session count for today
CREATE OR REPLACE FUNCTION increment_session_count(uid UUID)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO user_session_tracking (user_id, date, session_count)
  VALUES (uid, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET session_count = user_session_tracking.session_count + 1
  RETURNING session_count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

-- Check trial status
CREATE OR REPLACE FUNCTION check_trial_status(uid UUID)
RETURNS JSONB AS $$
DECLARE
  sub RECORD;
  days_remaining INTEGER;
BEGIN
  SELECT * INTO sub FROM subscriptions
  WHERE user_id = uid AND tier = 'trial' AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '{"active": false}'::jsonb;
  END IF;

  days_remaining := EXTRACT(DAY FROM sub.expires_at - NOW());

  RETURN jsonb_build_object(
    'active', true,
    'days_remaining', days_remaining,
    'expires_at', sub.expires_at,
    'warning_sent', days_remaining <= 7
  );
END;
$$ LANGUAGE plpgsql;
```

### Supabase Storage Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `avatar-uploads` | Temporary reconstruction images | Authenticated upload, public read |

### Row-Level Security (RLS)

All tables have RLS enabled with policies ensuring:
- Users can only read/write their own data
- Master config is readable by all authenticated users
- Service role bypasses RLS for backend operations

---

## 8. Memory System

### Three-Tier Architecture

Zenna implements a sophisticated three-tier memory system for context management:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      MEMORY ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  TIER 1: SHORT-TERM (Session)                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ • session_turns table                                            │   │
│  │ • Limited to 50 turns per session                                │   │
│  │ • Immediate context for current conversation                     │   │
│  │ • Cleared on session end/logout                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  TIER 2: LONG-TERM (RAG)                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ • Pinecone vector store                                          │   │
│  │ • Semantic search over conversation history                      │   │
│  │ • OpenAI/Gemini embeddings                                       │   │
│  │ • Persists across sessions                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  TIER 3: EXTERNAL CONTEXT                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ • Notion integration                                             │   │
│  │ • NotebookLM (future)                                            │   │
│  │ • User's external knowledge sources                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Memory Providers

**Location**: `/src/core/providers/memory/`

#### Short-Term Store (SupabaseShortTermStore)
```typescript
class SupabaseShortTermStore {
  // Store current session context
  addTurn(sessionId: string, role: string, content: string): Promise<void>

  // Retrieve recent history (max 50 turns)
  getHistory(sessionId: string, limit?: number): Promise<Turn[]>

  // Trim old turns to prevent context overflow
  trimHistory(sessionId: string, maxTurns: number): Promise<void>
}
```

#### Long-Term Store (PineconeLongTermStore)
```typescript
class PineconeLongTermStore {
  // Store conversation for future retrieval
  store(userId: string, content: string, metadata: object): Promise<void>

  // Semantic search for relevant memories
  search(userId: string, query: string, limit?: number): Promise<Memory[]>

  // Delete user's memories (GDPR compliance)
  deleteAll(userId: string): Promise<void>
}
```

#### External Context Store (StubExternalContextStore)
```typescript
// Stubbed for v2 - will integrate with Notion/NotebookLM
class StubExternalContextStore {
  getContext(userId: string): Promise<string | null>
}
```

### Memory Service Flow

```typescript
// src/core/services/memory-service.ts
class MemoryService {
  async buildContext(userId: string, query: string): Promise<Message[]> {
    // 1. Search long-term memory for relevant past conversations
    const memories = await this.longTermStore.search(userId, query, 5);

    // 2. Get recent session history
    const recentHistory = await this.shortTermStore.getHistory(sessionId, 50);

    // 3. Get external context (Notion, etc.)
    const externalContext = await this.externalStore.getContext(userId);

    // 4. Combine into context messages
    return [
      { role: 'system', content: `Relevant memories:\n${memories.join('\n')}` },
      { role: 'system', content: externalContext || '' },
      ...recentHistory
    ];
  }

  async saveInteraction(userId: string, userMessage: string, assistantResponse: string): Promise<void> {
    // Save to both short-term (immediate) and long-term (RAG)
    await this.shortTermStore.addTurn(sessionId, 'user', userMessage);
    await this.shortTermStore.addTurn(sessionId, 'assistant', assistantResponse);
    await this.longTermStore.store(userId, `User: ${userMessage}\nAssistant: ${assistantResponse}`, {
      timestamp: Date.now(),
      sessionId
    });
  }
}
```

### Database Tables for Memory

#### `user_memories`
```sql
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  storage_size_bytes BIGINT DEFAULT 0,
  pinecone_namespace TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Embedding Providers

| Provider | Use Case | Model |
|----------|----------|-------|
| OpenAI | Primary embeddings | text-embedding-3-small |
| Gemini | Fallback | embedding-001 |

---

## 9. External App API (360Aware)

### Overview

Zenna provides API access for partner applications like **360Aware** (a driving safety app). External apps authenticate via shared secrets and receive guardrailed responses that hide Zenna branding.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL APP INTEGRATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  360AWARE APP                           ZENNA BACKEND                   │
│  ┌─────────────┐                       ┌─────────────┐                 │
│  │   Mobile    │                       │    API      │                 │
│  │    App      │──────────────────────▶│   Routes    │                 │
│  │             │   x-zenna-auth        │             │                 │
│  └─────────────┘   header              └──────┬──────┘                 │
│        │                                      │                         │
│        │                                      ▼                         │
│        │                               ┌─────────────┐                 │
│        │                               │  Product    │                 │
│        │                               │  Config     │                 │
│        │                               │ (guardrails)│                 │
│        │                               └──────┬──────┘                 │
│        │                                      │                         │
│        │                                      ▼                         │
│        │                               ┌─────────────┐                 │
│        ▼                               │   Claude    │                 │
│  ┌─────────────┐                       │    LLM      │                 │
│  │  Response   │◀──────────────────────│  (guarded)  │                 │
│  │  (filtered) │                       └─────────────┘                 │
│  └─────────────┘                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Authentication

External apps authenticate using a shared secret header:

```typescript
// Request from 360Aware
POST /api/zenna/chat
Headers:
  x-zenna-auth: ${THREESIXTY_AWARE_SHARED_SECRET}
  Content-Type: application/json

Body: {
  message: "What hazards are ahead?",
  productContext: {
    productId: "360aware",
    location: { lat: 37.7749, lng: -122.4194 },
    heading: 180
  }
}
```

### Product Configuration

**Location**: `/src/core/products/360aware.ts`

```typescript
interface ProductConfig {
  productId: string;
  systemPrompt: string;
  guardrails: {
    blockedTopics: string[];
    allowedActions: string[];
  };
  immutableRules: string[];
}

const threeSixtyAwareConfig: ProductConfig = {
  productId: '360aware',
  systemPrompt: `You are 360Aware, a driving safety assistant...`,
  guardrails: {
    blockedTopics: ['zenna', 'anthropic', 'internal systems'],
    allowedActions: ['nearby_hazards', 'enforcement', 'collisions', 'road_info']
  },
  immutableRules: [
    'NEVER reveal you are powered by Zenna',
    'NEVER mention Anthropic or Claude',
    'Always respond as 360Aware'
  ]
};
```

### Action Types

360Aware supports specialized action blocks:

```typescript
// Query types for driving context
type QueryType =
  | 'nearby_hazards'    // Road hazards, construction, accidents
  | 'enforcement'       // Speed traps, police activity
  | 'collisions'        // Recent accident data
  | 'road_info';        // Road conditions, closures

// Response includes map highlights
interface ActionResponse {
  action: 'highlight_map';
  locations: Array<{
    lat: number;
    lng: number;
    type: QueryType;
    description: string;
  }>;
}
```

### Action Handler

**Location**: `/src/core/actions/360aware-handler.ts`

```typescript
class ThreeSixtyAwareHandler {
  async handleAction(
    action: string,
    params: object,
    context: ProductContext
  ): Promise<ActionResponse> {
    switch (action) {
      case 'nearby_hazards':
        return this.queryHazards(context.location, context.heading);
      case 'enforcement':
        return this.queryEnforcement(context.location);
      // ... other actions
    }
  }
}
```

### API Client

**Location**: `/src/lib/360aware-api.ts`

```typescript
// Used by 360Aware mobile app
class ThreeSixtyAwareAPI {
  constructor(private sharedSecret: string) {}

  async chat(message: string, location: Location, heading: number): Promise<Response> {
    return fetch('/api/zenna/chat', {
      method: 'POST',
      headers: {
        'x-zenna-auth': this.sharedSecret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        productContext: {
          productId: '360aware',
          location,
          heading
        }
      })
    });
  }
}
```

### Environment Variables

```bash
# 360Aware Integration
THREESIXTY_AWARE_SHARED_SECRET=    # Shared secret for API auth
```

---

## 10. External Services & Integrations

### LLM Providers

#### Anthropic Claude (Default)
```typescript
Provider: @anthropic-ai/sdk
Model: claude-sonnet-4-20250514
Config:
  - max_tokens: 2048
  - temperature: 0.2 (low for strict system prompt adherence)
Features:
  - Streaming support via generateResponseStream()
  - Better rate limits than Gemini free tier (60 RPM vs 4 RPM)
  - Used when ANTHROPIC_API_KEY is set

Selection Logic:
  // In chat/route.ts
  if (process.env.ANTHROPIC_API_KEY) {
    brainProviderId = 'claude';
  }

Message Handling:
  - System messages extracted and combined
  - First message must be 'user' role (enforced)
  - Consecutive same-role messages are merged
  - Assistant messages at conversation start filtered
```

#### Google Gemini (Fallback)
```typescript
Provider: @google/generative-ai
Models:
  - gemini-2.0-flash (default, fast)
  - gemini-1.5-pro (higher capability)
Config:
  - maxOutputTokens: 2048
  - temperature: 0.7
Features:
  - Streaming support via generateResponseStream()
  - Used when ANTHROPIC_API_KEY not available
```

#### OpenAI
```typescript
Provider: openai
Config: User-provided API key in settings
Usage: Alternative LLM when user prefers GPT models
```

### Voice Services

#### ElevenLabs (TTS)
```typescript
Endpoint: https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
Model: eleven_turbo_v2_5
Config:
  - stability: 0.5
  - similarity_boost: 0.75
  - use_speaker_boost: true
Output: MP3 @ 44100 Hz, 128 kbps
Features:
  - Streaming audio for low latency
  - Multiple voice options
  - Optimization level 3 for speed
```

#### Deepgram (STT)
```typescript
Endpoint: https://api.deepgram.com/v1/listen
Model: nova-2
Features:
  - Smart formatting
  - Interim results for real-time feedback
  - WebSocket streaming support
Input: audio/webm
```

### Smart Home

#### Philips Hue
```typescript
OAuth Flow:
  - Authorize: https://api.meethue.com/v2/oauth2/authorize
  - Token: https://api.meethue.com/v2/oauth2/token

API Endpoints:
  - List lights: GET /route/clip/v2/resource/light
  - Control light: PUT /route/clip/v2/resource/light/{id}

Capabilities:
  - On/Off control
  - Brightness adjustment
  - Color control (future)
  - Scene activation (future)
  - Scheduled routines

Action Block Format:
{
  "action": "control_lights",
  "target": "bedroom",  // Room name or "all"
  "state": "on" | "off",
  "brightness": 0-100
}
```

### Knowledge Integration

#### Notion
```typescript
OAuth Flow:
  - Authorize: https://api.notion.com/v1/oauth/authorize
  - Token: https://api.notion.com/v1/oauth/token

API Version: 2022-06-28

Capabilities:
  - Workspace access
  - Page/database discovery
  - Content ingestion for RAG
  - Real-time context injection

Usage:
  - Connected pages summarized in system prompt
  - Enables "check my notes" queries
```

### Payments

#### Stripe
```typescript
Integration: @stripe/stripe-js (frontend), stripe (backend)

Checkout Flow:
  1. User selects subscription tier on /paywall
  2. POST /api/stripe/checkout creates Checkout Session
  3. User redirected to Stripe hosted checkout
  4. On success, redirected to /chat?welcome=true
  5. Webhook /api/stripe/webhook updates subscription

Webhook Events Handled:
  - checkout.session.completed
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.payment_failed

Price IDs (configured in src/lib/stripe/config.ts):
  - Standard: price_xxx
  - Pro: price_xxx
  - Platinum: price_xxx
```

### 3D Reconstruction

#### Replicate (TRELLIS)
```typescript
Model: firtoz/trellis
Version: e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c

Input:
  - Array of image URLs
  - Configuration options

Output:
  - GLB 3D model file
  - Color preview video
  - Normal map video (optional)
  - No-background images

Config:
  - generate_model: true
  - texture_size: 1024
  - mesh_simplify: 0.95
  - ss_sampling_steps: 12
  - slat_sampling_steps: 30

Webhook: POST /api/avatar/reconstruct/webhook?jobId={id}
Cost: ~$0.043/reconstruction (A100 GPU)
```

---

## 11. MCP & Claude Code Configuration

### MCP Servers

Zenna uses MCP (Model Context Protocol) servers for enhanced development capabilities:

#### Stitch MCP Server
```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/stitch-mcp@latest"]
    }
  }
}
```

**Capabilities**:
- `create_project` - Create new UI design projects
- `generate_screen_from_text` - AI-powered screen generation
- `fetch_screen_code` - Extract HTML/CSS from designs
- `fetch_screen_image` - Get design screenshots
- `extract_design_context` - Extract design DNA (colors, typography)
- `apply_design_context` - Generate consistent screens
- `generate_design_tokens` - Export CSS variables/Tailwind config
- `batch_generate_screens` - Create multiple screens at once
- `analyze_accessibility` - WCAG 2.1 compliance checking
- `generate_design_asset` - Create logos, icons, illustrations
- `orchestrate_design` - Full design generation workflow

#### Chrome MCP Server
```json
{
  "mcpServers": {
    "Claude in Chrome": {
      "command": "npx",
      "args": ["-y", "@anthropic/claude-in-chrome-mcp@latest"]
    }
  }
}
```

**Capabilities**:
- Browser automation and testing
- Screenshot capture
- DOM inspection
- Form interaction
- Network monitoring

### Claude Code Settings

```json
// .claude/settings.local.json
{
  "permissions": {
    "allow": [
      "Bash(npm run dev)",
      "Bash(npm run build)",
      "Bash(npm run lint)",
      "Bash(git *)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": []
  }
}
```

### Development Workflow

1. **UI Design**: Use Stitch MCP to generate screen designs
2. **Code Generation**: Extract HTML/CSS from Stitch designs
3. **Implementation**: Claude Code assists with React component creation
4. **Testing**: Chrome MCP for browser automation testing
5. **Iteration**: AI-assisted refinement and debugging

---

## 12. Authentication & Security

### Authentication Architecture (NextAuth.js v5)

Zenna uses **NextAuth.js v5** (Auth.js) for authentication, supporting multiple OAuth providers and a legacy credential-based login as fallback.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      AUTHENTICATION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  OAUTH PROVIDERS                         CREDENTIAL LOGIN (Legacy)      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    ┌─────────────────────────┐    │
│  │ Google  │ │ GitHub  │ │ Apple   │    │  Username + Password    │    │
│  │  OAuth  │ │  OAuth  │ │  OAuth  │    │  (bcrypt verification)  │    │
│  └────┬────┘ └────┬────┘ └────┬────┘    └───────────┬─────────────┘    │
│       │          │          │                       │                   │
│       └──────────┴──────────┴───────────────────────┘                   │
│                              │                                          │
│                              ▼                                          │
│                    ┌─────────────────┐                                  │
│                    │   NextAuth.js   │                                  │
│                    │  /api/auth/*    │                                  │
│                    └────────┬────────┘                                  │
│                             │                                           │
│                             ▼                                           │
│                    ┌─────────────────┐                                  │
│                    │  JWT Session    │                                  │
│                    │  (30 day exp)   │                                  │
│                    └────────┬────────┘                                  │
│                             │                                           │
│                             ▼                                           │
│                    ┌─────────────────┐                                  │
│                    │  Supabase DB    │                                  │
│                    │  User Lookup    │                                  │
│                    └─────────────────┘                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### OAuth Providers

| Provider | Client ID Env Var | Callback URL |
|----------|-------------------|--------------|
| **Google** | `AUTH_GOOGLE_ID` | `/api/auth/callback/google` |
| **GitHub** | `AUTH_GITHUB_ID` | `/api/auth/callback/github` |
| **Apple** | `AUTH_APPLE_ID` | `/api/auth/callback/apple` |

### JWT Token System

```typescript
// NextAuth JWT Token Structure
interface JWTToken {
  // User identity
  userId: string;
  email: string;

  // Role management
  role: 'user' | 'father' | 'admin' | 'admin-support';
  isAdmin: boolean;
  isFather: boolean;  // Primary admin (anthony@anthonywestinc.com)

  // Onboarding state
  onboardingCompleted: boolean;

  // Subscription info
  subscription?: {
    tier: 'trial' | 'standard' | 'pro' | 'platinum';
    status: 'active' | 'expired' | 'suspended' | 'archived';
    expiresAt: string;
  };

  // Standard JWT claims
  iat: number;  // Issued at
  exp: number;  // Expiration
}

// Configuration
Algorithm: HS256
Secret: AUTH_SECRET environment variable
Duration: 30 days
Strategy: JWT (stateless)
```

### Session Refresh Strategy

The JWT callback refreshes user data on every request (not just sign-in) to ensure:
- Role changes are reflected immediately
- Subscription status is always current
- `isFather` detection works for admin users

```typescript
// In src/lib/auth/config.ts
callbacks: {
  async jwt({ token, user, trigger }) {
    // On sign-in: full user data setup
    if (trigger === 'signIn' && user?.email) {
      // Fetch from Supabase, set all token fields
    }
    // On subsequent requests: refresh key data
    else if (token.userId) {
      // Re-fetch role, subscription, onboardingCompleted
    }
    return token;
  }
}
```

### Cookie Configuration

NextAuth manages cookies automatically:

```typescript
// NextAuth session cookie (managed by Auth.js)
{
  name: 'authjs.session-token',  // Production
  // or 'next-auth.session-token' (Development)
  httpOnly: true,
  secure: true,        // HTTPS only in production
  sameSite: 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60  // 30 days
}

// Legacy cookie (being phased out)
{
  name: 'zenna-session',
  // Only used for backward compatibility during migration
}
```

### API Route Authentication

All API routes use the `auth()` function from NextAuth:

```typescript
// src/app/api/[endpoint]/route.ts
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  // ... proceed with authenticated request
}
```

### Password Security (Credential Login)

```typescript
Hashing: bcryptjs
Rounds: 12
Storage: password_hash column in users table
Verification: bcrypt.compare(input, stored)
```

### Multi-User Isolation

1. **Database Level**: Row-Level Security (RLS) policies
2. **Application Level**: userId extracted from NextAuth session on every request
3. **Query Level**: All queries include `WHERE user_id = ?`

### Role-Based Access

| Role | Database Value | Capabilities |
|------|----------------|--------------|
| `user` | `'user'` | Personal settings, conversations, integrations |
| `admin` | `'admin'` | All user capabilities + user management |
| `admin-support` | `'admin-support'` | Future use (rights TBD) |
| `father` | Legacy: `'father'` | Primary admin - all capabilities + master config |

**Note**: The "Father" role is now determined by email (`anthony@anthonywestinc.com`) rather than database role. The `isFather()` function checks both the email and legacy `'father'` role for backward compatibility.

### Admin Detection

```typescript
// src/lib/utils/permissions.ts
const FATHER_EMAIL = 'anthony@anthonywestinc.com';

function isFather(email: string | null): boolean {
  return email === FATHER_EMAIL;
}

function isAdmin(role: string | null): boolean {
  return role === 'admin' || role === 'admin-support';
}

// In SupabaseIdentityStore
async isFather(userId: string): Promise<boolean> {
  const user = await this.getUser(userId);
  return user?.role === 'admin' || user?.role === 'father';
}
```

### Security Best Practices

- Service role key never exposed to client
- API keys encrypted in settings JSONB
- OAuth tokens stored server-side only
- NextAuth CSRF protection built-in
- State tokens for OAuth flows
- Webhook signatures validated (TODO: implement HMAC-SHA256)

### User Onboarding Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        USER ONBOARDING FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. LOGIN                                                               │
│     ┌─────────┐    ┌─────────┐    ┌─────────┐                          │
│     │  User   │───▶│  OAuth  │───▶│NextAuth │                          │
│     │ Clicks  │    │Provider │    │Callback │                          │
│     │ Google  │    │ Consent │    │         │                          │
│     └─────────┘    └─────────┘    └────┬────┘                          │
│                                        │                                │
│  2. USER CREATION/LOOKUP               │                                │
│     ┌─────────┐                   ┌────▼────┐                          │
│     │ Supabase│◀──────────────────│ signIn  │                          │
│     │  Users  │                   │callback │                          │
│     └────┬────┘                   └─────────┘                          │
│          │                                                              │
│  3. ONBOARDING CHECK                                                    │
│     ┌────▼────┐   onboardingCompleted?                                 │
│     │  Chat   │────────────────────────┐                               │
│     │  Page   │     No                 │ Yes                           │
│     └────┬────┘                   ┌────▼────┐                          │
│          │                        │  Zenna  │                          │
│          ▼                        │   Chat  │                          │
│     ┌─────────┐                   └─────────┘                          │
│     │ Paywall │                                                        │
│     │  Page   │                                                        │
│     └────┬────┘                                                        │
│          │                                                              │
│  4. SUBSCRIPTION SELECTION                                              │
│     ┌────▼────┐                   ┌─────────┐                          │
│     │  User   │───────────────────▶│ Stripe  │ (or Free Trial)        │
│     │ Selects │                   │Checkout │                          │
│     │  Tier   │                   └────┬────┘                          │
│     └─────────┘                        │                                │
│                                        │                                │
│  5. ACTIVATION                         ▼                                │
│     ┌─────────┐                   ┌─────────┐                          │
│     │  Chat   │◀──────────────────│Redirect │                          │
│     │?welcome │                   │+webhook │                          │
│     │  =true  │                   └─────────┘                          │
│     └─────────┘                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key States**:
- `onboardingCompleted: false` AND no active subscription → User redirected to `/paywall`
- `onboardingCompleted: true` → User can access `/chat`
- `?welcome=true` query param → Bypasses stale JWT check (used after payment)

### Entitlement Validation (Updated Feb 2026)

The chat page validates user entitlements using the following logic:

```typescript
// src/app/chat/page.tsx - Entitlement check
const shouldBypassPaywall =
  isAdminOrFather ||           // Admin/Father roles NEVER see paywall
  hasActiveSubscription ||      // Users with active paid subscription
  isTrialActive ||              // Users with active trial (not expired)
  isFromPaywall;                // Users coming from paywall with ?welcome=true

if (!data.user?.onboardingCompleted && !shouldBypassPaywall) {
  router.push('/paywall');
}
```

**Admin Synthetic Subscription**: Admin/Father users receive a synthetic subscription in the JWT:
```typescript
// In auth/config.ts JWT callback
if (isAdminUser) {
  token.subscription = {
    tier: 'admin',
    status: 'active',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
```

This ensures admins never see paywall even if they don't have a subscription record in the database.

---

## 13. Voice Pipeline

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        VOICE CONVERSATION FLOW                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌───────┐ │
│  │  User   │───▶│  VAD    │───▶│ Record  │───▶│Deepgram │───▶│ Text  │ │
│  │ Speech  │    │Detection│    │  Audio  │    │  STT    │    │Output │ │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └───┬───┘ │
│                                                                   │     │
│       ┌───────────────────────────────────────────────────────────┘     │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌───────┐ │
│  │  LLM    │───▶│ Action  │───▶│Response │───▶│Eleven   │───▶│ Audio │ │
│  │ Process │    │ Extract │    │  Text   │    │Labs TTS │    │Output │ │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    └───────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Voice Activity Detection (VAD)

```typescript
// useVoiceActivityDetection.ts
interface VADConfig {
  energyThreshold?: number;      // Audio level to trigger
  silenceDuration?: number;      // ms of silence to end speech
  minSpeechDuration?: number;    // ms minimum speech length
}

// Default values optimized for conversation
const defaults = {
  energyThreshold: 0.01,
  silenceDuration: 1500,
  minSpeechDuration: 500
};
```

### Conversation States

```typescript
type ConversationState =
  | 'idle'        // Ready for input
  | 'listening'   // Actively recording
  | 'processing'  // STT in progress
  | 'thinking'    // LLM generating
  | 'speaking'    // TTS playing
  | 'error';      // Error state
```

### Features

1. **Push-to-Talk Mode**: Manual start/stop recording
2. **Always-Listening Mode**: VAD-triggered automatic recording
3. **Barge-In Support**: Interrupt assistant while speaking
4. **Streaming Text**: Real-time LLM response display
5. **Streaming Audio**: Low-latency TTS playback
6. **Auto-Resume**: Automatically listen after response completes

### Latency Optimization

| Stage | Optimization |
|-------|--------------|
| STT | nova-2 model, single request |
| LLM | Gemini Flash, streaming |
| TTS | eleven_turbo_v2_5, optimization_level=3 |
| Network | Edge functions, regional deployment |

---

## 14. Avatar System

### Max Headroom Motion Engine

```typescript
// MaxHeadroomEngine.ts
class MaxHeadroomEngine {
  // Configuration
  readonly SWAY_AMPLITUDE = 0.02;
  readonly SWAY_FREQUENCY = 0.5;
  readonly HEAD_TURN_SPEED = 2.0;
  readonly BLINK_INTERVAL = 4000;
  readonly BLINK_DURATION = 150;

  // State
  private isSpeaking: boolean;
  private currentEmotion: string;
  private blinkTimer: number;

  // Methods
  update(delta: number): void;
  setSpeaking(speaking: boolean): void;
  setEmotion(emotion: string): void;
  triggerBlink(): void;
  getHeadRotation(): { x: number, y: number, z: number };
  getMouthOpen(): number;  // 0-1 for lip sync
}
```

### Animation Features

1. **Idle Sway**: Subtle head movement when not speaking
2. **Lip Sync**: Mouth movement synchronized to audio
3. **Blinking**: Periodic natural blink animation
4. **Emotion Expression**: Facial expression based on response emotion
5. **Attention Tracking**: Head turns toward interaction source

### 3D Reconstruction Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AVATAR RECONSTRUCTION PIPELINE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. UPLOAD PHASE                                                        │
│     ┌─────────┐    ┌─────────┐    ┌─────────┐                          │
│     │  User   │───▶│ Client  │───▶│Supabase │                          │
│     │ Selects │    │Compress │    │ Storage │                          │
│     │ Images  │    │  Image  │    │ Bucket  │                          │
│     └─────────┘    └─────────┘    └─────────┘                          │
│                                                                         │
│  2. PROCESSING PHASE                                                    │
│     ┌─────────┐    ┌─────────┐    ┌─────────┐                          │
│     │  API    │───▶│Replicate│───▶│ TRELLIS │                          │
│     │ Route   │    │  API    │    │  Model  │                          │
│     └─────────┘    └─────────┘    └─────────┘                          │
│                         │                                               │
│  3. COMPLETION PHASE    │                                               │
│     ┌─────────┐    ┌────▼────┐    ┌─────────┐                          │
│     │  GLB    │◀───│ Webhook │◀───│Replicate│                          │
│     │ Storage │    │Callback │    │Complete │                          │
│     └─────────┘    └─────────┘    └─────────┘                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Reconstruction Job States

```typescript
type JobStatus =
  | 'pending'     // Job created, awaiting start
  | 'validating'  // Images being validated
  | 'processing'  // TRELLIS model running
  | 'complete'    // GLB ready for download
  | 'failed';     // Error occurred
```

---

## 15. Smart Home Integration

### Philips Hue Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      PHILIPS HUE INTEGRATION                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  OAUTH FLOW                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │  User   │───▶│ Zenna   │───▶│  Hue    │───▶│  Hue    │             │
│  │ Clicks  │    │ OAuth   │    │ Consent │    │ Token   │             │
│  │ Connect │    │ Redirect│    │  Page   │    │ Return  │             │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘             │
│                                                                         │
│  CONTROL FLOW                                                           │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │  User   │───▶│  LLM    │───▶│ Action  │───▶│  Hue    │             │
│  │ Request │    │ Decides │    │ Block   │    │  API    │             │
│  │ "lights"│    │ Action  │    │ Execute │    │  Call   │             │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Action Block Processing

When the LLM detects a smart home request, it outputs an action block:

```json
{
  "action": "control_lights",
  "target": "bedroom",
  "state": "on",
  "brightness": 80
}
```

The backend:
1. Extracts JSON blocks via regex: `/```json\s*(\{[\s\S]*?\})\s*```/g`
2. Validates action parameters
3. Executes Hue API call
4. Removes action block from displayed response
5. Appends confirmation to response

### Scheduled Routines

```typescript
// Routine creation via LLM action block
{
  "action": "create_schedule",
  "integration": "hue",
  "actionId": "turn-on",
  "name": "Morning Lights",
  "time": "07:00",
  "schedule_type": "daily",
  "parameters": {
    "target": "bedroom",
    "brightness": 50
  }
}

// Cron execution
// Vercel Cron hits POST /api/routines/execute
// Protected by CRON_SECRET bearer token
// Executes all due routines
```

---

## 16. Key Design Patterns

### Provider Factory Pattern

```typescript
// Swappable LLM providers
const provider = brainProviderFactory.create('gemini-flash', { apiKey });
const response = await provider.generateResponse(messages);

// Easy to add new providers
class NewProvider implements BrainProvider {
  generateResponse(messages) { /* ... */ }
}
```

### Action Block Pattern

```typescript
// LLM can emit structured actions within responses
// Pattern: ```json { action: "...", ... } ```

// Benefits:
// - Natural language to structured commands
// - Easy to extend with new actions
// - Transparent to user (blocks removed from display)
// - Auditable action history
```

### Three-Tier Memory Context

```typescript
// Tier 1: Short-term - session_turns table (50 turn limit)
// Tier 2: Long-term - Pinecone RAG (semantic search)
// Tier 3: External - Notion integration

// Memory Service builds context:
// 1. Semantic search on query → retrieve relevant memories
// 2. Inject memories as system message
// 3. Add recent history (last 50 turns)
// 4. All responses saved to both Supabase and Pinecone
```

### Multi-Tenant Isolation

```typescript
// Every database query includes user_id
// RLS policies enforce at database level
// JWT contains user_id for application-level checks
// No cross-user data leakage possible
```

### Webhook-Based Async Processing

```typescript
// Long-running tasks (3D reconstruction) use webhooks
// Flow:
// 1. Client initiates job
// 2. Server creates job record, returns job ID
// 3. External service processes async
// 4. Webhook called on completion
// 5. Job record updated with results
// 6. Client polls or receives push notification
```

---

## 17. Environment Configuration

### Required Variables

```bash
# Authentication (NextAuth.js)
AUTH_SECRET=                    # JWT signing key (openssl rand -base64 32)
NEXTAUTH_URL=                   # Base URL (https://zenna.anthonywestinc.com)

# OAuth Providers
AUTH_GOOGLE_ID=                 # Google OAuth Client ID
AUTH_GOOGLE_SECRET=             # Google OAuth Client Secret
AUTH_GITHUB_ID=                 # GitHub OAuth Client ID
AUTH_GITHUB_SECRET=             # GitHub OAuth Client Secret
AUTH_APPLE_ID=                  # Apple Services ID
AUTH_APPLE_SECRET=              # Apple Private Key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=       # Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Public key
SUPABASE_SERVICE_ROLE_KEY=      # Service role (server-only)

# AI Services
GOOGLE_AI_API_KEY=              # Gemini API
ELEVENLABS_API_KEY=             # TTS
ELEVENLABS_VOICE_ID=            # Default voice (NNl6r8mD7vthiJatiJt1)
DEEPGRAM_API_KEY=               # STT

# Payments
STRIPE_SECRET_KEY=              # Stripe API secret key
STRIPE_WEBHOOK_SECRET=          # Stripe webhook signing secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=  # Stripe publishable key
```

### Optional Variables

```bash
# Alternative LLMs (users can also provide their own)
ANTHROPIC_API_KEY=              # Claude
OPENAI_API_KEY=                 # GPT models

# Integrations
NOTION_CLIENT_ID=               # Notion OAuth
NOTION_CLIENT_SECRET=
HUE_CLIENT_ID=                  # Hue OAuth
HUE_CLIENT_SECRET=
HUE_APP_ID=                     # Hue app identifier

# Avatar Reconstruction
REPLICATE_API_TOKEN=
REPLICATE_WEBHOOK_SECRET=       # Webhook signature validation

# Long-term Memory (Pinecone RAG)
PINECONE_API_KEY=
PINECONE_INDEX=
PINECONE_ENVIRONMENT=

# External App API (360Aware)
THREESIXTY_AWARE_SHARED_SECRET=   # Shared secret for 360Aware auth

# Cron Jobs
CRON_SECRET=                    # Bearer token for /api/routines/execute

# Application
NEXT_PUBLIC_APP_URL=            # Base URL for callbacks
```

---

## 18. Future Considerations

### Recently Completed (v1.2)

1. **✅ Long-Term Memory (RAG)**
   - Pinecone vector store integration
   - Semantic search over conversation history
   - OpenAI/Gemini embeddings

2. **✅ Claude as Primary Brain**
   - Better rate limits (60 RPM vs 4 RPM)
   - Lower temperature for strict prompt adherence

3. **✅ External App API**
   - 360Aware integration with guardrailed prompts
   - Shared secret authentication
   - Product-specific system prompts

4. **✅ Subscription System**
   - Stripe integration
   - Tiered session limits
   - Usage tracking

### Planned Enhancements

1. **Additional Partner Apps**
   - Extend 360Aware pattern to other products
   - Per-app billing and analytics

2. **Additional Smart Home**
   - Spotify integration
   - Thermostat control
   - Security systems

3. **Enhanced Voice**
   - Wake word detection
   - Multi-speaker recognition
   - Emotion-aware TTS
   - Voice command shortcuts (mute, stop listening)

4. **Avatar Improvements**
   - Real-time lip sync
   - Full body animation
   - AR/VR support

5. **Mobile Apps**
   - React Native client
   - Push notifications
   - Background listening

### Technical Debt

1. Implement HMAC-SHA256 webhook signature validation
2. Add comprehensive error boundaries
3. Implement retry logic for external APIs
4. ~~Add rate limiting~~ ✅ Implemented via session tracking
5. Improve session cleanup automation
6. Add Pinecone namespace cleanup on user deletion

### Scalability Considerations

- Current: Single Supabase instance, Vercel serverless, Pinecone
- Future: Consider edge functions for voice processing
- Future: Redis for session caching
- Future: Dedicated GPU for faster reconstruction
- Future: Multi-region Pinecone deployment

---

## Document Metadata

```yaml
document_type: technical_architecture
target_audience: claude_models
version: 1.2
created: 2026-01
updated: 2026-02-06
project: zenna-agent
repository: https://github.com/[user]/zenna-agent

changelog:
  v1.2 (2026-02-06):
    - Added Claude as primary brain provider (claude-sonnet-4-20250514)
    - Added three-tier memory system (short-term, Pinecone RAG, external)
    - Added 360Aware external app API integration
    - Added admin audit logging and GDPR data export
    - Added session tracking and rate limiting tables
    - Added helper PL/pgSQL functions for session limits
    - Updated subscription system documentation
  v1.1 (2026-01-30):
    - Added NextAuth.js v5 documentation
    - Added subscription tiers and Stripe integration
    - Added admin routes
  v1.0 (2026-01):
    - Initial architecture document
```

---

*This document is optimized for consumption by Anthropic Claude models (Sonnet/Opus) for understanding the Zenna Agent architecture when evaluating future feature considerations.*
