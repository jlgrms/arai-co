import { IsUUID } from 'class-validator';

// Reschedule targets a new slot; the SAME appointment row is updated (S5.3).
export class RescheduleAppointmentDto {
  @IsUUID()
  availabilityId!: string;
}