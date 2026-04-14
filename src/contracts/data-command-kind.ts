export const DataCommandKind = {
  IngestionPersist: 'data.ingestion.persist',
} as const;

export type DataCommandKind = (typeof DataCommandKind)[keyof typeof DataCommandKind];
