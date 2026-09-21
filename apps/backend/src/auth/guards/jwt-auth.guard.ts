import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Rejects requests with no/invalid/expired JWT as 401 (Passport default behaviour).
// Account-state enforcement happens in JwtStrategy.validate (403 for non-ACTIVE).
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
