import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataLifecycleModule } from '../data-lifecycle/data-lifecycle.module';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { NotificationFeedEntity } from './entities/notification-feed.entity';
import { NotificationOutboxEntity } from './entities/notification-outbox.entity';
import { SurvivalJobEntity } from './entities/survival-job.entity';
import { TenantSealedCredentialEntity } from './entities/tenant-sealed-credential.entity';
import { AdminAuditLogService } from './admin-audit-log.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { TenantCredentialService } from './tenant-credential.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationOutboxEntity,
      NotificationFeedEntity,
      SurvivalJobEntity,
      AdminAuditLogEntity,
      TenantSealedCredentialEntity,
    ]),
    DataLifecycleModule,
  ],
  providers: [NotificationOutboxService, AdminAuditLogService, TenantCredentialService],
  exports: [
    TypeOrmModule,
    NotificationOutboxService,
    AdminAuditLogService,
    TenantCredentialService,
  ],
})
export class SurvivalCoreModule {}
