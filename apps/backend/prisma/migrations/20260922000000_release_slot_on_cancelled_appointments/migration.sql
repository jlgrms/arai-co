-- Data migration: release the availability slot link for appointments that were
-- cancelled BEFORE the sub-item 5 cancel fix.
--
-- Background: Appointment.availabilityId is @unique, and the DB holds the FK even
-- after a row status flips to CANCELLED. Appointments cancelled before the fix
-- therefore still "occupy" their slot at the constraint level (even though the
-- booking-conflict rule treats CANCELLED as non-blocking), which blocks re-booking
-- with a Prisma P2002.
--
-- The cancel path now nulls availabilityId going forward. This backfills history so
-- pre-fix rows do not shadow their slots. scheduledAt + doctorProfileId are preserved
-- for audit (only the slot link is released).

UPDATE "Appointment"
SET "availabilityId" = NULL
WHERE "status" = 'CANCELLED'
  AND "availabilityId" IS NOT NULL;
