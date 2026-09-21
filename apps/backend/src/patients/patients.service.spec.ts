import { NotFoundException } from '@nestjs/common';
import { PatientsService } from './patients.service';

// RBAC-scoping (sub-items 1): the patient service must always resolve the
// profile from the caller's own userId — never from a client-supplied id.
describe('PatientsService RBAC-scoping', () => {
  it('looks up own profile by userId; unknown user -> 404', async () => {
    const prisma = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new PatientsService(prisma);

    await expect(svc.getOwnProfile('nobody')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.patientProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'nobody' } }),
    );
  });
});
