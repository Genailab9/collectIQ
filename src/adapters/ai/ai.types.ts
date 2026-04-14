/**
 * Read-only negotiation context. No approvals, amounts, or commitments are implied by this DTO.
 */
export interface AiNegotiationInput {
  readonly tenantId: string;
  readonly correlationId: string;
  /** Recent conversation text for analysis (caller-supplied; adapter does not persist). */
  readonly conversationTranscript: string;
  /** Optional structured or free-text facts for prompting only (read-only). */
  readonly accountFacts?: string;
}
