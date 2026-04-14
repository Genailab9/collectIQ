import { Global, Module } from '@nestjs/common';
import { SYNC_ADAPTER } from '../adapter.tokens';
import { CollectiqSyncAdapter } from './collectiq-sync.adapter';

@Global()
@Module({
  providers: [
    CollectiqSyncAdapter,
    { provide: SYNC_ADAPTER, useExisting: CollectiqSyncAdapter },
  ],
  exports: [
    CollectiqSyncAdapter,
    { provide: SYNC_ADAPTER, useExisting: CollectiqSyncAdapter },
  ],
})
export class SyncAdapterModule {}
