import { Global, Module } from '@nestjs/common';
import { AtRestCipherService } from './at-rest-cipher.service';

@Global()
@Module({
  providers: [AtRestCipherService],
  exports: [AtRestCipherService],
})
export class DataLifecycleModule {}
