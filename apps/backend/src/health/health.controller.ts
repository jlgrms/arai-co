import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  // Liveness probe used by Docker Compose healthchecks and local verification.
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
