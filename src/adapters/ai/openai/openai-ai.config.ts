import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OpenAiAiConfig {
  constructor(private readonly config: ConfigService) {}

  get apiKey(): string | undefined {
    const k = this.config.get<string>('OPENAI_API_KEY')?.trim();
    return k || undefined;
  }

  get negotiationModel(): string {
    return this.config.get<string>('OPENAI_NEGOTIATION_MODEL') ?? 'gpt-4o-mini';
  }
}
