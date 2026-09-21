import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

// Root module. Layer 1 only wires the health check; domain feature modules
// (auth, patients, doctors, appointments, ...) are added in later layers.
@Module({
  imports: [HealthModule],
})
export class AppModule {}
