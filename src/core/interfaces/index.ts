/**
 * Core Interfaces - Zenna Agent
 *
 * This module exports all core interfaces that define Zenna's architecture.
 * These interfaces enable:
 * - Pluggable LLM providers
 * - Swappable voice pipeline (ASR/TTS)
 * - Portable memory storage
 * - User isolation
 * - Future local-first migration
 */

// Brain (LLM) Provider
export * from './brain-provider';

// Voice Pipeline (ASR + TTS)
export * from './voice-pipeline';

// Memory Store (Short-term + Long-term + External)
export * from './memory-store';

// User Identity & Isolation
export * from './user-identity';

// Zenna Bridge (Future Local Runtime)
export * from './zenna-bridge';
