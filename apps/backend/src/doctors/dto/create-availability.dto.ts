import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

// Doctor creates one of their own availability slots.
export class CreateAvailabilityDto {
  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  // Blocked slots are retained but cannot be booked.
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
}
