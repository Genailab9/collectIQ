import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { AiAdapter } from '../ai.adapter';
import { AiOutputValidationError, AiProviderError } from '../ai.errors';
import type { AiNegotiationInput } from '../ai.types';
import type { AiNegotiationSuggestion } from '../schemas/ai-negotiation-suggestion.schema';
import { AiNegotiationSuggestionSchema } from '../schemas/ai-negotiation-suggestion.schema';
import { OpenAiAiConfig } from './openai-ai.config';

const NEGOTIATION_SYSTEM_PROMPT = `You are a collections negotiation assistant.

STRICT RULES (non-negotiable):
- You do NOT approve anything, authorize payments, or make financial commitments.
- You do NOT change any system state; you only analyze text you are given.
- You MUST output a single JSON object with exactly these keys and no others:
  "intent", "offerSuggestion", "negotiationStrategy"
- All values MUST be non-empty strings.
- "intent": concise description of what the borrower appears to want or resist (observation only).
- "offerSuggestion": a non-binding framing of a possible settlement path (suggestion only; not an offer approval).
- "negotiationStrategy": non-binding conversational guidance for the human/agent (not executable commands).

Output JSON only. No markdown, no code fences, no extra keys.`;

@Injectable()
export class OpenAiNegotiationAdapter implements AiAdapter {
  constructor(private readonly cfg: OpenAiAiConfig) {}

  async suggestNegotiation(input: AiNegotiationInput): Promise<AiNegotiationSuggestion> {
    const apiKey = this.cfg.apiKey;
    if (!apiKey || this.cfg.bootMode === 'demo-safe') {
      return {
        intent: 'Borrower requests a feasible repayment plan.',
        offerSuggestion: 'Propose a structured 3-installment repayment schedule.',
        negotiationStrategy: 'Confirm affordability, recap terms, and guide borrower to payment confirmation.',
      };
    }
    const client = new OpenAI({ apiKey });
    const userPayload = [
      `tenantId=${input.tenantId}`,
      `correlationId=${input.correlationId}`,
      '',
      'CONVERSATION_TRANSCRIPT:',
      input.conversationTranscript,
      input.accountFacts ? `\nACCOUNT_FACTS (read-only context):\n${input.accountFacts}` : '',
    ].join('\n');

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: this.cfg.negotiationModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: NEGOTIATION_SYSTEM_PROMPT },
          { role: 'user', content: userPayload },
        ],
      });
    } catch (cause) {
      throw new AiProviderError('OpenAI negotiation request failed.', cause);
    }

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new AiProviderError('OpenAI returned an empty completion.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new AiOutputValidationError('Model output was not valid JSON.', [
        'JSON.parse failed for model output',
      ]);
    }

    const result = AiNegotiationSuggestionSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      );
      throw new AiOutputValidationError('Model output failed strict schema validation.', issues);
    }

    return result.data;
  }
}
