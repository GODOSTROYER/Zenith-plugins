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
import { ProvenanceError, assertTrustDirectoryPath, compareVersions, versionFloorKey } from '../provenance/index.mjs';

export const STATE_FILENAME = 'zenith-provenance-state.json';

/**
 * Resolve the rollback-floor file and check the directory that holds it.
 *
 * The state file is a trust input: deleting it resets the floor, so anyone who
 * can write its directory can re-enable a downgrade. The default location is
 * the ZENITH_PROVENANCE_TRUST directory, which `assertTrustInputPath` has
 * already checked. An absolute-path override used to skip that check entirely,
 * so a floor kept in a shared directory was unprotected; the override now goes
 * through the same directory check, and reports the same "unverified" result
 * on Windows rather than claiming a guarantee the platform did not give.
 */
export async function statePath(trustPath, { env = process.env, platform = process.platform } = {}) {
  const override = env.ZENITH_PROVENANCE_STATE;
  if (override === undefined) {
    const file = path.join(path.dirname(trustPath), STATE_FILENAME);
    return { path: file, overridden: false, permissionsChecked: platform !== 'win32' };
  }
  if (typeof override !== 'string' || !path.isAbsolute(override))
    throw new ProvenanceError('provenance_required', 'ZENITH_PROVENANCE_STATE must be an absolute path.');
  const directory = await assertTrustDirectoryPath(path.dirname(override), 'ZENITH_PROVENANCE_STATE', { platform });
  return { path: override, overridden: true, permissionsChecked: directory.permissionsChecked, reason: directory.reason };
}

/**
 * `stat` is injectable because the two branches below cannot both be produced
 * from a real path on every platform: POSIX reports ENOTDIR for a path under a
 * regular file, while Windows reports ENOENT for the same path, which is the
 * very confusion this function exists to refuse. Tests pin both branches with
 * it; nothing outside this module passes it.
 */
async function readState(file, { platform = process.platform, stat = lstat } = {}) {
  let info;
  try { info = await stat(file); }
  catch (error) {
    // Only "absent" is a first activation. Any other error — a permission
    // denial, an I/O error, a path component that is not a directory — used to
    // land here too, which silently unset the rollback floor and accepted a
    // genuinely signed older package with exit 0. Fail closed instead.
    if (error?.code === 'ENOENT') return undefined;
    throw new ProvenanceError('state_unreadable',
      `${file} could not be read (${error?.code ?? error?.message}); refusing to treat an unreadable rollback floor as a first activation.`);
  }
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
export async function readLastGood(file, subjectKey, options) {
  if (!subjectKey) return undefined;
  const state = await readState(file, options);
  const entry = state?.subjects?.[subjectKey];
  if (entry === undefined) return undefined;
  if (!entry || typeof entry !== 'object' || typeof entry.version !== 'string')
    throw new ProvenanceError('invalid_state', `${file} has an invalid recorded entry for ${subjectKey}.`);
  return entry;
}

/** Record a newly accepted version. Never lowers an existing floor. */
export async function recordLastGood(file, result, { required = false, ...options } = {}) {
  const subjectKey = versionFloorKey(result?.manifest);
  const version = result?.manifest?.subject?.version;
  if (!subjectKey || typeof version !== 'string')
    return { recorded: false, reason: 'The signed subject has no name or version to record.' };
  // An unreadable existing floor throws here rather than being recorded over:
  // recording is best effort, reading the floor it might lower is not.
  const state = (await readState(file, options)) ?? { version: 1, subjects: {} };
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
