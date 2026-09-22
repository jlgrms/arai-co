import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Exports AuditService so AdminModule can record on every admin action.
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}