import { Role } from '@prisma/client';

// Minimum JWT payload per Layer 3: userId (as `sub`) + role.
export interface JwtPayload {
  sub: string;
  role: Role;
}
