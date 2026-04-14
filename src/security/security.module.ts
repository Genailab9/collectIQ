import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PiiEncryptionService } from './pii-encryption.service';
import { PrdSecurityMiddleware } from './prd-security.middleware';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrdSecurityMiddleware, PiiEncryptionService],
  exports: [PiiEncryptionService],
})
export class SecurityModule {}
