/**
 * How this build was activated, as the provenance gate reported it.
 *
 * The value is passed down from packages/bridge/cli.mjs, which is the only
 * place that runs the gate. Nothing here reads the environment or the package
 * directory: a command must not be able to talk itself into claiming it is
 * publisher-verified, and an outside variable must not be able to silence the
 * preview warning.
 */
export type Activation = 'unsigned-preview' | 'verified' | 'development';

/** The one sentence every gated command leads with on a preview build. */
export const PREVIEW_NOTICE = 'unsigned preview build — not publisher-verified. '
  + 'These bytes carry no publisher signature: installing from a marketplace proves only that your client downloaded this package. '
  + 'Zenith still authorises every call, and every change is reviewed in the browser. See docs/provenance.md.';

export const isPreview = (activation?: Activation): boolean => activation === 'unsigned-preview';

/** The client identity the link protocol carries, with the preview state inside it.
 *  The protocol has no verification field, and the approval page shows this name to
 *  the person granting access, so the state belongs in the name they read. The
 *  suffix keeps the protocol's own 60-character, letters/digits/space/._- shape. */
export function withVerification(name: string, activation?: Activation): string {
  return isPreview(activation) ? `${name} - unsigned preview`.slice(0, 60) : name;
}
