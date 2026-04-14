import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DemoService } from './demo.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post('seed')
  @HttpCode(201)
  async seed(@Body() _body: Record<string, never>) {
    return this.demo.seed();
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Body() _body: Record<string, never>) {
    return this.demo.reset();
  }
}
