/**
 * Brain Provider Factory
 *
 * Creates the appropriate BrainProvider based on provider ID.
 */

import type {
  BrainProvider,
  BrainProviderConfig,
  BrainProviderId,
  BrainProviderFactory,
  BRAIN_PROVIDERS,
} from '../../interfaces/brain-provider';
import { GeminiProvider } from './gemini-provider';
import { ClaudeProvider } from './claude-provider';
import { OpenAIProvider } from './openai-provider';

export class DefaultBrainProviderFactory implements BrainProviderFactory {
  create(providerId: string, config: BrainProviderConfig): BrainProvider {
    switch (providerId) {
      case 'gemini-2.5-flash':
        return new GeminiProvider(config, 'flash');

      case 'gemini-2.5-pro':
        return new GeminiProvider(config, 'pro');

      case 'claude':
        return new ClaudeProvider(config);

      case 'openai':
        return new OpenAIProvider(config);

      case 'local':
        // Future: Ollama, llama.cpp integration
        throw new Error('Local brain provider not yet implemented. Coming in v2.');

      default:
        throw new Error(`Unknown brain provider: ${providerId}`);
    }
  }

  getSupportedProviders(): string[] {
    return [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'claude',
      'openai',
      // 'local', // Uncomment when implemented
    ];
  }
}

// Singleton factory instance
export const brainProviderFactory = new DefaultBrainProviderFactory();

// Re-export providers for direct use if needed
export { GeminiProvider } from './gemini-provider';
export { ClaudeProvider } from './claude-provider';
export { OpenAIProvider } from './openai-provider';
