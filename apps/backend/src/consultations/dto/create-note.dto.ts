import { IsOptional, IsString, MaxLength } from 'class-validator';

// Doctor-authored consultation note (S5.3: findings, recommendations,
// summaries). At least one field must be present -- enforced in the service so
// the failure is a 400 with a clear message rather than a silent empty note.
export class CreateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  findings?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  recommendations?: string;
}
