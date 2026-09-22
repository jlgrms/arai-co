// Shared fixture-reclamation helper for the evidence harnesses.
//
// WHY THIS EXISTS
//   Eleven harnesses registered a throwaway account per run via
//   POST /auth/register/patient and never removed it. Only *slots* were brought
//   under the "put it back" rule (commit a513584); accounts were not. By the
//   start of Layer 8, 58 of 68 accounts in the database were harness leftovers
//   (84%), and because GET /admin/users orders by createdAt desc they sorted
//   ABOVE the three real patients and swamped the admin Users screen.
//
//   `scripts/db-clean-harness-users.sh --apply` was the interim mitigation: a
//   manual, whole-database sweep. This helper is the real fix (DEFERRED item 1):
//   each harness now removes exactly what that run created, on every exit path.
//
// THE ONE RULE
//   A harness may only remove what THAT RUN created. Nothing here deletes by
//   email pattern, date range, or role -- only by an id captured from the
//   response to a request this process just made. A prefix sweep in the cleaner
//   script is a safety net for a crashed run, never the mechanism.
//
// WHY SQL AND NOT AN API CALL
//   There is no user-DELETE endpoint (only Availability has one), so a user
//   fixture can only be removed by SQL. This shells out to the same
//   `docker exec ... psql` the cleanup script uses. The schema cascades
//   User -> PatientProfile/DoctorProfile -> Appointment -> ConsultationSession
//   -> Note/Prescription, so one DELETE removes the whole subtree.
//
// USAGE
//   import { createReclaimer } from './lib/reclaim.mjs';
//
//   const reclaim = createReclaimer({ label: 'l6s2' });
//   ...
//   const reg = await (await fetch(...)).json();     // register a fixture
//   reclaim.trackUser(reg.user.id, email);           // capture the id
//   ...
//   await reclaim.run('success path');               // explicit, reported
//
//   `createReclaimer` installs process exit + SIGINT hooks itself, so a throw
//   or a Ctrl-C still reclaims. Call `reclaim.run()` explicitly on the success
//   path so the count is printed as part of the harness's own output; the hooks
//   are the safety net for the paths that never reach that line.
import { spawnSync } from 'node:child_process';

const CONTAINER = 'telehealth-postgres';
const PG_USER = 'telehealth';
const PG_DB = 'telehealth';

/** Runs one SQL statement against the live database. Returns { ok, stdout, stderr }. */
export function psql(sql) {
  const res = spawnSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  );
  if (res.error) return { ok: false, stdout: '', stderr: String(res.error.message) };
  return { ok: res.status === 0, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

/** Quotes a single-quoted SQL string literal. Ids are uuids, but never interpolate raw. */
function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Deletes one row and reports whether a row was actually removed.
 *
 * psql exits 0 for a DELETE that matched nothing, so `ok` alone cannot tell
 * "removed the fixture" from "the fixture was never there".
 *
 * Worse -- and this was caught only by instrumenting the helper -- with
 * `-t -A`, `DELETE ... RETURNING id` does NOT return empty output when no row
 * matched. It returns the command tag `DELETE 0`, which is a non-empty string.
 * A naive "stdout is non-empty means success" check therefore reported
 * `reclaimed 1/1` for a delete that removed nothing: exactly the
 * "reports attempts, not successes" defect this task exists to eliminate.
 *
 * The reliable signal is the row count in the trailing command tag:
 *   DELETE 0
 *   DELETE 1
 * So the tag is parsed rather than the output length trusted.
 *
 * A row that is already gone is NOT treated as a failure (the cleaner script may
 * have run, or an earlier exit-hook invocation may have won the race); it is
 * reported as `absent` and NOT counted as reclaimed, so the summary can never
 * overstate what this run removed.
 */
function deleteById(table, id) {
  const r = psql(`DELETE FROM "${table}" WHERE id = ${lit(id)};`);
  if (!r.ok) return { outcome: 'failed', detail: r.stderr.split('\n').slice(-1)[0] || 'psql failed' };
  const tag = (r.stdout || '').split('\n').slice(-1)[0].trim(); // e.g. "DELETE 1"
  const count = Number((tag.match(/^DELETE\s+(\d+)$/) || [])[1]);
  if (count === 0) return { outcome: 'absent', detail: 'no row matched (already removed)' };
  if (!Number.isInteger(count)) {
    return { outcome: 'failed', detail: `unreadable psql output: ${JSON.stringify(r.stdout).slice(0, 120)}` };
  }
  return { outcome: 'reclaimed', detail: id };
}

/**
 * Creates a reclaimer for one harness run.
 *
 * @param {object} opts
 * @param {string} opts.label  short tag used in the printed report, e.g. 'l6s2'.
 * @returns {{
 *   trackUser: (id: string, email?: string) => void,
 *   trackAppointment: (id: string) => void,
 *   trackSlot: (id: string) => void,
 *   trackNotification: (id: string) => void,
 *   run: (reason?: string) => Promise<{ reclaimed: number, failed: number }>,
 *   ids: () => object,
 * }}
 */
export function createReclaimer({ label = 'harness' } = {}) {
  const users = new Map(); // id -> email (email only for the printed report)
  const appointments = new Set();
  const slots = new Set();
  const notifications = new Set();
  let done = false;

  function trackUser(id, email) {
    if (id) users.set(id, email || '(no email captured)');
  }
  function trackAppointment(id) {
    if (id) appointments.add(id);
  }
  function trackSlot(id) {
    if (id) slots.add(id);
  }
  function trackNotification(id) {
    if (id) notifications.add(id);
  }

  /**
   * Deletes everything this run tracked, per item, and REPORTS the outcome.
   *
   * Deliberately reports successes, not attempts. The earlier per-harness
   * cleanup blocks were removed for exactly this defect: `evidence-cancelled-join`
   * logged "reclaim 4/4" while a DELETE was 409ing, so the report said success
   * and hid a live appointment. Here a failure is counted as a failure.
   */
  async function run(reason = 'explicit') {
    if (done) return { reclaimed: 0, failed: 0, absent: 0 };
    done = true;

    const total = users.size + appointments.size + slots.size + notifications.size;
    if (total === 0) {
      console.log(`\n== Fixture cleanup (${label}, ${reason}) == nothing created, nothing to reclaim`);
      return { reclaimed: 0, failed: 0, absent: 0 };
    }

    console.log(`\n== Fixture cleanup (${label}, ${reason}) ==`);
    let reclaimed = 0;
    let absent = 0;
    const failures = [];

    // Order matters: appointments and slots before users. Deleting a user does
    // cascade its appointments away, but a slot is owned by a SEEDED doctor and
    // would survive as an orphan, so it must be removed explicitly either way.
    // Notification has NO foreign key to Appointment -- it links only to User
    // (`Notification_userId_fkey`). So deleting an appointment does NOT cascade
    // its notifications away; they survive as orphans addressed to the seeded
    // participants. They are tracked explicitly for that reason.
    const plan = [
      ['Notification', notifications, 'notification'],
      ['Appointment', appointments, 'appointment'],
      ['Availability', slots, 'availability slot'],
      ['User', users.keys(), 'user'],
    ];

    for (const [table, ids, noun] of plan) {
      for (const id of ids) {
        const r = deleteById(table, id);
        if (r.outcome === 'reclaimed') {
          reclaimed += 1;
          const email = table === 'User' ? ` (${users.get(id)})` : '';
          console.log(`  reclaimed ${noun} ${id}${email}`);
        } else if (r.outcome === 'absent') {
          absent += 1;
          console.log(`  already gone: ${noun} ${id} — ${r.detail}`);
        } else {
          failures.push(`${noun} ${id}: ${r.detail}`);
        }
      }
    }

    console.log(`  reclaimed ${reclaimed}/${total} fixture item(s)` + (absent ? `, ${absent} already gone` : ''));
    if (failures.length) {
      console.log(`  WARNING: ${failures.length} item(s) NOT reclaimed (the database will drift):`);
      for (const f of failures) console.log(`    ${f}`);
    }
    return { reclaimed, failed: failures.length, absent };
  }

  // Safety net for the paths that never reach an explicit run(): a rejected
  // promise at top level, an uncaught throw, or Ctrl-C.
  //
  // KNOWN LIMIT: `kill -9` / SIGKILL does not run exit hooks, so a hard kill
  // still leaks. That is the accepted residual risk (DEFERRED item 1); the
  // cleaner script's prefix sweep is the recovery path for it.
  process.on('exit', () => {
    if (done) return;
    // `run` is async but every statement it runs is spawnSync, so the work is
    // synchronous in practice; an async call here still completes before exit
    // because spawnSync blocks. We cannot await in an exit handler, so this is
    // fire-and-forget by necessity -- hence the explicit run() on success paths.
    void run('process exit');
  });
  process.on('SIGINT', () => {
    void run('SIGINT');
    process.exit(130);
  });

  return {
    trackUser,
    trackAppointment,
    trackSlot,
    trackNotification,
    run,
    ids: () => ({
      users: [...users.keys()],
      appointments: [...appointments],
      slots: [...slots],
      notifications: [...notifications],
    }),
  };
}
