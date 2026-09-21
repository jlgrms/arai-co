import { IsUUID } from 'class-validator';

// The client supplies ONLY the target slot. doctor/patient/scheduledAt are
// derived server-side from the slot + JWT so nothing can be spoofed (S5.2).
export class CreateAppointmentDto {
  @IsUUID()
  availabilityId!: string;
}
