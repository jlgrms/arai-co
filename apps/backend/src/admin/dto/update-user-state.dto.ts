import { AccountState } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

// Admin user-management action (S5.4). accountState is required and constrained
// to the DB enum; reason is OPTIONAL (Flag 1 — C4 AuditLog.reason is nullable).
export class UpdateUserStateDto {
  @IsEnum(AccountState)
  accountState!: AccountState;

  @IsOptional()
  @IsString()
  reason?: string;
}