import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PatientsModule } from './patients/patients.module';
import { DoctorsModule } from './doctors/doctors.module';
import { AdminModule } from './admin/admin.module';

// Root module. Layer 3 wires auth + RBAC and the temporary per-role ping routes.
// Real domain feature modules arrive in Layer 4.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    PatientsModule,
    DoctorsModule,
    AdminModule,
  ],
})
export class AppModule {}
