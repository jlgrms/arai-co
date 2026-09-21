import { IsString, MaxLength, MinLength } from 'class-validator';

// Doctor-issued prescription (S5.3). Flat free-text `details` per confirmed A3
// -- no structured drug/dose sub-model.
export class CreatePrescriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  details!: string;
}
