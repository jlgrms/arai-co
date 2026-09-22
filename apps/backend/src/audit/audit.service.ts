import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditedRecordTypeValue } from './audit.types';

// Input contract for a single audit row. affectedRecordId is the id of the
// TARGET record (the User being suspended, the DoctorProfile being reviewed,
// the Appointment being cancelled) — always the affected record, never the admin.
export interface AuditEntry {
  adminUserId: string;
  action: string;
  affectedRecordType: AuditedRecordTypeValue;
  affectedRecordId: string;
  reason?: string | null;
}

// Shared audit mechanism (sub-item 9, Flag 4). Every admin action funnels
// through this one method so AuditLog rows have a single consistent shape.
// Synchronous, in-process Prisma write — no queue, no external sink.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        action: entry.action,
        affectedRecordType: entry.affectedRecordType,
        affectedRecordId: entry.affectedRecordId,
        reason: entry.reason ?? null,
      },
    });
  }
}