import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// Partial update for a patient's OWN profile. email/passwordHash are not editable here
// (auth concern, out of scope) and avatarInitialsOrRef is server-generated from name.
export class UpdatePatientProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // ISO date string, e.g. "1990-04-12".
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  contactDetails?: string;

  @IsOptional()
  @IsString()
  basicMedicalHistory?: string;
}
