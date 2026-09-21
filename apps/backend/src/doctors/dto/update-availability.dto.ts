import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

// Partial update of a doctor's own availability slot (times and/or blocked flag).
export class UpdateAvailabilityDto {
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
}
