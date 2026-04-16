import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrdResilienceValidityService } from '../recovery/prd-resilience-validity.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const validity = app.get(PrdResilienceValidityService);
    const result = await validity.runProductionGate({ actor: 'system' });
    if (result.result !== 'PASS') {
      const summary = result.checks.map((c) => `${c.name}:${c.status}:${c.message}`).join(' | ');
      throw new Error(`Resilience production gate failed: ${summary}`);
    }
    process.stdout.write('resilience_production_gate: PASS\n');
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
