export class SyncStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncStateConflictError';
  }
}
