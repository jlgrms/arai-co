import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterPatientDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  // Optional at registration; full profile fields are completed in Layer 4 (PATCH /patients/me).
  @IsOptional()
  @IsString()
  contactDetails?: string;
}
