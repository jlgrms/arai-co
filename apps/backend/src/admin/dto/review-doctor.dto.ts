import { ApprovalStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Admin doctor-profile review (S5.4, Flag 2 = gatekeep + direct edit).
// approvalStatus AND the profile fields (name/biography/specialization) are all
// optional so the admin can approve/reject, edit profile data, or both in one call.
//
// Field-level constraints MIRROR the doctor's own UpdateDoctorProfileDto exactly
// (same decorators) so the admin path cannot bypass validation the self-service
// route enforces. email/passwordHash/userId remain non-editable here.
export class ReviewDoctorDto {
  @IsOptional()
  @IsEnum(ApprovalStatus)
  approvalStatus?: ApprovalStatus;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  biography?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  specialization?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}