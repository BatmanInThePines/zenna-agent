/**
 * Zenna Bridge Interface (STUB)
 *
 * Future: Local-first runtime target (e.g., Raspberry Pi)
 * This interface defines the contract for a local Zenna installation.
 *
 * Current Status: Interface only, no implementation.
 *
 * Migration Path:
 * 1. Cloud Zenna uses cloud providers (Pinecone, Supabase, ElevenLabs, Deepgram)
 * 2. Local Zenna Bridge implements these same interfaces with local alternatives:
 *    - SQLite + sqlite-vss for memory
 *    - Local Whisper for ASR
 *    - Piper/Coqui for TTS
 *    - Ollama/llama.cpp for LLM
 *
 * Success Criteria: Swap providers and infrastructure, not logic.
 */

import type { BrainProvider, BrainProviderConfig } from './brain-provider';
import type { ASRProvider, TTSProvider, ASRConfig, TTSConfig } from './voice-pipeline';
import type { MemoryStore } from './memory-store';
import type { IdentityStore } from './user-identity';

// ============================================
// BRIDGE CONFIGURATION
// ============================================

export interface ZennaBridgeConfig {
  /**
   * Bridge identifier (unique per installation)
   */
  bridgeId: string;

  /**
   * Bridge name (human-readable)
   */
  name: string;

  /**
   * Local network address
   */
  localAddress: string;

  /**
   * Hardware info
   */
  hardware?: {
    platform: string; // e.g., 'raspberrypi4'
    memory: number; // MB
    storage: number; // GB
  };

  /**
   * Provider configurations for local mode
   */
  providers: {
    brain?: {
      type: 'ollama' | 'llama-cpp' | 'custom';
      model: string;
      endpoint?: string;
    };
    asr?: {
      type: 'whisper-local' | 'vosk' | 'custom';
      model?: string;
    };
    tts?: {
      type: 'piper' | 'coqui' | 'espeak' | 'custom';
      voice?: string;
    };
    memory?: {
      type: 'sqlite' | 'sqlite-vss';
      path: string;
    };
  };
}

// ============================================
// BRIDGE INTERFACE
// ============================================

/**
 * Zenna Bridge - Local runtime interface
 *
 * A bridge is a self-contained Zenna installation that can run
 * entirely offline on local hardware.
 */
export interface ZennaBridge {
  /**
   * Bridge configuration
   */
  readonly config: ZennaBridgeConfig;

  /**
   * Bridge status
   */
  getStatus(): Promise<ZennaBridgeStatus>;

  /**
   * Initialize the bridge (start all local services)
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the bridge
   */
  shutdown(): Promise<void>;

  /**
   * Get local brain provider
   */
  getBrainProvider(): BrainProvider;

  /**
   * Get local ASR provider
   */
  getASRProvider(): ASRProvider;

  /**
   * Get local TTS provider
   */
  getTTSProvider(): TTSProvider;

  /**
   * Get local memory store
   */
  getMemoryStore(): MemoryStore;

  /**
   * Get local identity store
   */
  getIdentityStore(): IdentityStore;

  /**
   * Sync with cloud (if hybrid mode enabled)
   */
  syncWithCloud?(cloudEndpoint: string): Promise<SyncResult>;

  /**
   * Export all data for migration
   */
  exportData(): Promise<ExportBundle>;

  /**
   * Import data from another source
   */
  importData(bundle: ExportBundle): Promise<void>;
}

// ============================================
// BRIDGE STATUS & SYNC
// ============================================

export interface ZennaBridgeStatus {
  online: boolean;
  uptime: number; // seconds
  lastSyncAt?: Date;
  services: {
    brain: ServiceStatus;
    asr: ServiceStatus;
    tts: ServiceStatus;
    memory: ServiceStatus;
    identity: ServiceStatus;
  };
  resources: {
    cpuUsage: number; // 0-100
    memoryUsage: number; // 0-100
    storageUsage: number; // 0-100
  };
}

export interface ServiceStatus {
  available: boolean;
  provider: string;
  latencyMs?: number;
  error?: string;
}

export interface SyncResult {
  success: boolean;
  syncedAt: Date;
  itemsSynced: {
    memories: number;
    conversations: number;
    settings: number;
  };
  errors?: string[];
}

export interface ExportBundle {
  version: string;
  exportedAt: Date;
  data: {
    users: unknown[];
    memories: unknown[];
    conversations: unknown[];
    settings: unknown[];
  };
  checksum: string;
}

// ============================================
// BRIDGE FACTORY (STUB)
// ============================================

/**
 * Factory for creating Zenna Bridge instances
 * Implementation deferred to v2
 */
export interface ZennaBridgeFactory {
  /**
   * Detect available local bridges on the network
   */
  discoverBridges(): Promise<ZennaBridgeConfig[]>;

  /**
   * Create a bridge connection
   */
  connect(config: ZennaBridgeConfig): Promise<ZennaBridge>;

  /**
   * Create a new local bridge (for initial setup)
   */
  createBridge(config: Partial<ZennaBridgeConfig>): Promise<ZennaBridge>;
}

// ============================================
// PLACEHOLDER IMPLEMENTATION
// ============================================

/**
 * Stub implementation that throws "not implemented" errors
 * This exists to define the contract for future local-first migration
 */
export class ZennaBridgeStub implements ZennaBridge {
  readonly config: ZennaBridgeConfig = {
    bridgeId: 'stub',
    name: 'Zenna Bridge (Not Implemented)',
    localAddress: 'localhost',
    providers: {},
  };

  async getStatus(): Promise<ZennaBridgeStatus> {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  async initialize(): Promise<void> {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  async shutdown(): Promise<void> {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  getBrainProvider(): BrainProvider {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  getASRProvider(): ASRProvider {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  getTTSProvider(): TTSProvider {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  getMemoryStore(): MemoryStore {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  getIdentityStore(): IdentityStore {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  async exportData(): Promise<ExportBundle> {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }

  async importData(): Promise<void> {
    throw new Error('Zenna Bridge is not yet implemented. Coming in v2.');
  }
}
