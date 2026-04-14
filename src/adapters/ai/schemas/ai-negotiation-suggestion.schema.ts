import { z } from 'zod';

/**
 * Strict output contract: suggestions only. No approval fields, no payment execution fields.
 */
export const AiNegotiationSuggestionSchema = z
  .object({
    intent: z
      .string()
      .min(1)
      .max(4000)
      .describe('Detected borrower intent (observational, not a decision).'),
    offerSuggestion: z
      .string()
      .min(1)
      .max(8000)
      .describe('Non-binding suggested settlement framing (not an approved offer).'),
    negotiationStrategy: z
      .string()
      .min(1)
      .max(8000)
      .describe('Non-binding next conversational moves (not instructions to execute payments).'),
  })
  .strict();

export type AiNegotiationSuggestion = z.infer<typeof AiNegotiationSuggestionSchema>;
