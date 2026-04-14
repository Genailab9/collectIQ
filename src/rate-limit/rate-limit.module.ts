import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RateLimiterService } from './rate-limiter.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
