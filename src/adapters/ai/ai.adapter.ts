import type { AiNegotiationInput } from './ai.types';
import type { AiNegotiationSuggestion } from './schemas/ai-negotiation-suggestion.schema';

/**
 * Swappable AI provider for negotiation assistance.
 * Implementations MUST be read-only: no persistence, no approvals, no payments, no state mutation.
 */
export interface AiAdapter {
  suggestNegotiation(input: AiNegotiationInput): Promise<AiNegotiationSuggestion>;
}
