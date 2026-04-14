/**
 * PRD v1.1 §10.2 — canonical retention windows (calendar days).
 * Automated purge of the shared transition log is not applied without row-level classification;
 * operators should use volume-level retention and legal holds in production.
 */
export const RetentionPolicyDays = {
  borrower: 90,
  callRecordings: 365 * 2,
  paymentLogs: 365 * 7,
} as const;
