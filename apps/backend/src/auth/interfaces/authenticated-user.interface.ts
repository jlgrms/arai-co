import { Role } from '@prisma/client';

// Shape attached to req.user after JWT validation. Mirrors the JWT payload.
export interface AuthenticatedUser {
  id: string;
  role: Role;
}
