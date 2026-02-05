/**
 * Product Configurations
 *
 * Zenna can power multiple products as a headless AI backend.
 * Each product has its own system prompt, guardrails, and capabilities.
 *
 * Currently supported products:
 * - 360aware: Road safety assistant for Australian drivers
 */

export * from './360aware';

export { getProductConfig, isValidProduct, buildProductSystemPrompt } from './360aware';
export type { ProductConfig } from './360aware';
