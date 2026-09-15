/**
 * The two activation shapes a generated package can be built in, in one place.
 *
 * A generated package states its own activation mode in `provenance-mode.json`
 * and carries the matching `.mcp.json`. The two must agree, because the mode is
 * what decides whether the runtime activation gate requires a publisher
 * signature:
 *
 * - `unsigned-preview` — the committed development shape. The descriptor runs
 *   the packaged bridge directly with `node`, so a marketplace install
 *   activates with nothing for an operator to configure, and the gate in
 *   packages/provenance/consumer.mjs lets it through while every user-facing
 *   command says the build is not publisher-verified.
 * - `signed-release` — the production shape. The descriptor invokes
 *   `zenith-plugin-launcher`, which is also what the launcher binds its own
 *   invocation to (`assertDescriptorBinding`), and the gate requires the signed
 *   package envelope and the operator trust file exactly as before.
 *
 * scripts/build.mjs writes one of these, scripts/check.mjs asserts the
 * committed packages are the preview shape, and scripts/provenance.mjs signs
 * and launches the release shape in its selftest.
 */
export const PROVENANCE_MODE_FILE = 'provenance-mode.json';
export const UNSIGNED_PREVIEW = 'unsigned-preview';
export const SIGNED_RELEASE = 'signed-release';
export const ACTIVATION_MODES = Object.freeze([UNSIGNED_PREVIEW, SIGNED_RELEASE]);
export const LAUNCHER_COMMAND = 'zenith-plugin-launcher';
export const BRIDGE_ENTRY = 'runtime/bridge/cli.mjs';
export const CLIENTS = Object.freeze(['codex', 'claude-code']);

/** The host variable each client interpolates into its own plugin descriptor. */
export const packageVariable = client => (client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}');

const PREVIEW_NOTICE = 'Unsigned preview build. A marketplace fetch proves only that the client downloaded this package; '
  + 'it does not authenticate a publisher. Move to the signed release path for publisher authentication. See docs/provenance.md.';
const RELEASE_NOTICE = 'Signed release build. Activation runs through zenith-plugin-launcher and requires the signed package '
  + 'envelope (ZENITH_PROVENANCE_MANIFEST) and the operator trust file (ZENITH_PROVENANCE_TRUST). See docs/provenance.md.';

function assertMode(mode) {
  if (!ACTIVATION_MODES.includes(mode)) throw new Error(`Unknown package activation mode: ${mode}`);
  return mode;
}

/** The MCP server entry for one client, in one activation mode. */
export function mcpServerEntry(client, mode) {
  const root = packageVariable(client);
  return assertMode(mode) === SIGNED_RELEASE
    ? { command: LAUNCHER_COMMAND, args: ['--package-dir', root, '--entry', BRIDGE_ENTRY, 'stdio'], env: { ZENITH_API_VERSION: '2' } }
    : { command: 'node', args: [`${root}/${BRIDGE_ENTRY}`, 'stdio'], env: { ZENITH_API_VERSION: '2' } };
}

/** The whole `.mcp.json` document: Codex reads an unwrapped server map, Claude Code a wrapped one. */
export function mcpDescriptor(client, mode) {
  const server = { zenith: mcpServerEntry(client, mode) };
  return client === 'codex' ? server : { mcpServers: server };
}

/**
 * The mode-dependent paragraphs of a generated package's README. A package that
 * activates without a publisher signature has to say so where an operator reads
 * it, not only in the source repository's documentation.
 */
export function readmeFragments(client, mode) {
  const root = packageVariable(client);
  if (assertMode(mode) === SIGNED_RELEASE) return {
    banner: '> **Signed release build.** Activation runs through `zenith-plugin-launcher`, which verifies these bytes against a signed Ed25519 envelope before Node imports any module from here. It fails closed without ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST.',
    commands: [
      'From this installed package directory, run:', '', '```bash',
      'node runtime/bridge/cli.mjs --help', 'node runtime/bridge/cli.mjs --version', '```', '',
      'Only --help and --version run ungated. doctor, stdio, setup and the v2 control commands, login included, require provenance inputs and fail closed with code provenance_required naming the missing variable. A command that opens a network connection and writes a credential is deliberately the last one that should run before this package has been verified. Run them through the trusted launcher instead:',
      '', '```bash', 'zenith-plugin-launcher --package-dir ABSOLUTE_PATH_TO_THIS_PACKAGE --entry runtime/bridge/cli.mjs doctor', '```',
    ].join('\n'),
    gate: 'Production installers/launchers must provide absolute ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST paths. ZENITH_PROVENANCE_MANIFEST must be a sign-package envelope for this exact package directory, not a release manifest; a release manifest is refused with subject_mismatch. Whenever code in this package runs, the gate proves the package bytes match that signed Ed25519 envelope before the MCP/control surface opens, and ZENITH_REQUIRE_PROVENANCE=0 cannot disable it. It does not prove how this package was registered: an MCP client reads its server configuration before any code here runs, so the host MCP configuration is the trust root. A trusted installer must own that configuration and point it at an absolute zenith-plugin-launcher path outside this directory. The copy of the launcher under installer/ in this package is an installer input, not a trust root. See docs/provenance.md in the source repository.',
  };
  return {
    banner: [
      '> **Unsigned preview build — not publisher-verified.** This package activates without a publisher signature, so installing it from a marketplace proves only that your client downloaded this repository\'s package. It does not prove who produced these bytes.',
      '>',
      `> The MCP descriptor runs the packaged bridge directly: \`node ${root}/${BRIDGE_ENTRY} stdio\`. \`provenance-mode.json\` records the same mode, and \`login\`, \`status\` and \`doctor\` repeat it in their output. For publisher authentication use the signed release path in docs/provenance.md.`,
    ].join('\n'),
    commands: [
      'From this installed package directory, run:', '', '```bash',
      'node runtime/bridge/cli.mjs --help', 'node runtime/bridge/cli.mjs login', 'node runtime/bridge/cli.mjs status', '```', '',
      'In this preview build every command runs without provenance inputs. Set ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST, or ZENITH_REQUIRE_PROVENANCE=1, and the preview marker is ignored: the package is then verified against the signed envelope exactly as a release is, and fails closed without one.',
    ].join('\n'),
    gate: 'What the preview does and does not guarantee. It guarantees nothing about the publisher: your client fetched this package over HTTPS from the repository you named, and integrity.json records the file hashes of the build that produced it, which is transport and reproducibility rather than publisher authentication. Anyone who can write this directory can change these bytes and the inventory together. It does not weaken the operations themselves: Zenith still authorises every call against the credential the browser issued, every change is reviewed in the browser before it runs, and this package still cannot approve itself. For publisher authentication install the signed release, which invokes zenith-plugin-launcher and verifies the package against a signed Ed25519 envelope and an operator-owned trust file. See docs/provenance.md in the source repository.',
  };
}

/** The `provenance-mode.json` a generated package carries. Deterministic: no clock, no revision. */
export function provenanceModeDocument(client, version, mode) {
  return {
    version: 1,
    mode: assertMode(mode),
    client,
    packageVersion: version,
    generatedFrom: `zenith-integrations@${version}`,
    generator: 'scripts/build.mjs',
    verification: mode === SIGNED_RELEASE ? RELEASE_NOTICE : PREVIEW_NOTICE,
  };
}
