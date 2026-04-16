import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './lib/errors/global-http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const dataDir = join(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.NEXT_PUBLIC_APP_URL?.trim() || '*',
    credentials: true,
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // Stripe signatures require the exact raw payload bytes.
  app.use('/webhooks/payment/stripe', express.raw({ type: 'application/json' }));
  app.use('/saas/billing/webhook', express.raw({ type: 'application/json' }));
  app.use((req: express.Request & { rawBody?: Buffer }, _res: express.Response, next: express.NextFunction) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
    }
    next();
  });
  /** PRD §16 — honor `X-Forwarded-Proto` when TLS terminates at a reverse proxy. */
  if (process.env.COLLECTIQ_TRUST_PROXY === '1' || process.env.COLLECTIQ_REQUIRE_TLS === 'true') {
    const server = app.getHttpAdapter().getInstance() as { set?: (name: string, val: unknown) => void };
    server.set?.('trust proxy', 1);
  }
  const bootMode =
    (process.env.APP_BOOT_MODE ?? '').trim().toLowerCase() === 'strict' ? 'strict' : 'demo-safe';
  const providerMode = (key?: string) =>
    key?.trim() && bootMode !== 'demo-safe' ? 'live' : 'mock';

  logger.log('CollectIQ boot diagnostics');
  logger.log(`mode=${bootMode}`);
  logger.log(`stripe=${providerMode(process.env.STRIPE_SECRET_KEY)}`);
  logger.log(`twilio=${providerMode(process.env.TWILIO_AUTH_TOKEN)}`);
  logger.log(`openai=${providerMode(process.env.OPENAI_API_KEY)}`);
  logger.log('compliance=active smek=ready');

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
