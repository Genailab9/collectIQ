/**
 * SMEK → AI adapter command kinds (structural routing only).
 */
export const AiCommandKind = {
  NegotiationSuggest: 'ai.negotiation.suggest',
} as const;

export type AiCommandKind = (typeof AiCommandKind)[keyof typeof AiCommandKind];
