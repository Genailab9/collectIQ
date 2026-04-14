/**
 * Opaque adapter payload. SMEK forwards this verbatim without interpreting business meaning.
 */
export interface AdapterEnvelope {
  readonly kind: string;
  readonly body: unknown;
  /** Read-only adapter operation: no transition persistence, adapter side-effect free by contract. */
  readonly nonMutating?: boolean;
}
