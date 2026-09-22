import { IsOptional, IsString } from 'class-validator';

// Admin appointment-oversight cancel (S5.4, Flag 3). reason is OPTIONAL.
export class CancelAppointmentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}