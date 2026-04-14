/** Internal manifest row (hidden from GET /feature-flags user map). */
export const DEMO_SEED_MANIFEST_KEY = '__DEMO_SEED_MANIFEST';

export type DemoSeedManifestV1 = {
  readonly version: 1;
  readonly campaignId: string;
  readonly approvalCorrelationIds: readonly string[];
  readonly paymentIds: readonly string[];
};
