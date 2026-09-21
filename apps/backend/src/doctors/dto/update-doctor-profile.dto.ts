import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Partial update for a doctor's OWN profile.
// approvalStatus is admin-only (sub-item 9) — intentionally not editable here.
export class UpdateDoctorProfileDto {
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
}
