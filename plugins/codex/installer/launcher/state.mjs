/**
 * Rollback floor recorded by the trusted launcher.
 *
 * Where it is recorded: `zenith-provenance-state.json` in the directory that
 * holds the operator's ZENITH_PROVENANCE_TRUST file, or the absolute path in
 * ZENITH_PROVENANCE_STATE. That directory already decides which publisher keys
 * this machine trusts, so it is the same custody boundary; no state is kept
 * inside the plugin package, where the package could edit its own floor.
 *
 * Enforcement is separate from recording. Enforcement is unconditional: a
 * recorded version is passed to the verifier as a minimum and an older signed
 * package is refused with `version_rollback`, even though its signature is
 * genuine. Recording is best effort, because a hardened operator may keep the
 * trust directory read-only; a failed write is reported on stderr and
 * ZENITH_PROVENANCE_STATE_REQUIRED=1 turns it into a refusal. In a read-only
 * deployment the trust file's own `minimumVersions` floor is the control.
 */
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProvenanceError, compareVersions, versionFloorKey } from '../provenance/index.mjs';

export const STATE_FILENAME = 'zenith-provenance-state.json';

export function statePath(trustPath, env = process.env) {
  const override = env.ZENITH_PROVENANCE_STATE;
  if (override === undefined) return path.join(path.dirname(trustPath), STATE_FILENAME);
  if (typeof override !== 'string' || !path.isAbsolute(override))
    throw new ProvenanceError('provenance_required', 'ZENITH_PROVENANCE_STATE must be an absolute path.');
  return override;
}

async function readState(file, platform = process.platform) {
  let info;
  try { info = await lstat(file); } catch { return undefined; } // Absent: this is the first recorded activation.
  if (!info.isFile()) throw new ProvenanceError('invalid_state', `${file} must be a regular file.`);
  if (platform !== 'win32' && (info.mode & 0o002) !== 0)
    throw new ProvenanceError('invalid_state', `${file} is world-writable; any local user could lower the rollback floor.`);
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new ProvenanceError('invalid_state', `${file} is not readable JSON. Repair or delete the recorded rollback floor.`); }
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1
    || !state.subjects || typeof state.subjects !== 'object' || Array.isArray(state.subjects))
    throw new ProvenanceError('invalid_state', `${file} is not a version-1 provenance state file.`);
  return state;
}

/** The last accepted version for this subject, or undefined on first activation. */
export async function readLastGood(file, subjectKey) {
  if (!subjectKey) return undefined;
  const state = await readState(file);
  const entry = state?.subjects?.[subjectKey];
  if (entry === undefined) return undefined;
  if (!entry || typeof entry !== 'object' || typeof entry.version !== 'string')
    throw new ProvenanceError('invalid_state', `${file} has an invalid recorded entry for ${subjectKey}.`);
  return entry;
}

/** Record a newly accepted version. Never lowers an existing floor. */
export async function recordLastGood(file, result, { required = false } = {}) {
  const subjectKey = versionFloorKey(result?.manifest);
  const version = result?.manifest?.subject?.version;
  if (!subjectKey || typeof version !== 'string')
    return { recorded: false, reason: 'The signed subject has no name or version to record.' };
  const state = (await readState(file)) ?? { version: 1, subjects: {} };
  const previous = state.subjects[subjectKey];
  if (previous && typeof previous.version === 'string' && compareVersions(version, previous.version, subjectKey) <= 0)
    return { recorded: false, reason: 'The accepted version is not newer than the recorded floor.', floor: previous.version };
  state.subjects[subjectKey] = { version, keyId: result.keyId, signedAt: result.signedAt, recordedAt: new Date().toISOString() };
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if (required) throw new ProvenanceError('state_not_recorded', `Could not record the rollback floor at ${file}: ${error.message}`);
    return { recorded: false, reason: `The rollback floor could not be written: ${error.message}` };
  }
  return { recorded: true, subject: subjectKey, version, floor: previous?.version };
}
