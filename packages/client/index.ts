/** Distribution transport only. Authorization and operational decisions remain in Zenith. */
export type RpcId = string | number;
export interface RpcRequest {
  jsonrpc: "2.0";
  id?: RpcId;
  method: string;
  params?: Record<string, unknown>;
}
export interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId | null;
  result?: unknown;
  error?: { code: number; message: string };
}
export interface Association {
  version: 1;
  workspaceId: string;
  projectId?: string;
  environmentId?: string;
}
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2024-11-05"] as const;
export const CONTRACT_VERSION = 1;
/**
 * Wire version of the browser link (device) flow. It is deliberately separate
 * from CONTRACT_VERSION and CONTROL_VERSION: the link endpoints mint a
 * credential and are reached before one exists, so they version independently
 * of the authenticated tool contract. The connector sends this integer and the
 * backend hard-codes the same one.
 */
export const LINK_PROTOCOL_VERSION = 1;
export const MAX_REQUEST_BYTES = 65_536;
export const MAX_RESPONSE_BYTES = 262_144;
const readNames = Object.freeze([
  "zenith_get_context", "zenith_get_capabilities", "zenith_list_projects",
  "zenith_get_project", "zenith_get_manifest", "zenith_list_environments",
  "zenith_plan_deploy", "zenith_list_deployments", "zenith_get_deployment",
  "zenith_get_events", "zenith_get_findings", "zenith_get_drift", "zenith_export_project",
]);
// Retained for consumers; mutating this exported copy cannot change the security boundary.
export const READ_TOOLS: ReadonlySet<string> = new Set(readNames);
export const isReadTool = (name: unknown): name is string => typeof name === "string" && readNames.includes(name);
export class ClientError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ClientError"; }
}
function fail(code: string, message: string): never { throw new ClientError(code, message); }
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const shortString = (value: unknown, max = 128): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export function association(value: unknown): Association {
  if (!isObject(value) || value.version !== 1 || Object.keys(value).some(k => !["version", "workspaceId", "projectId", "environmentId"].includes(k)))
    return fail("invalid_association", "Use association version 1 and identifiers only; endpoints and credentials do not belong in project files.");
  for (const key of ["workspaceId", "projectId", "environmentId"] as const) {
    const v = value[key];
    if ((key === "workspaceId" || v !== undefined) && (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(v)))
      return fail("invalid_association", `Set a valid ${key} copied from Zenith.`);
  }
  if (value.environmentId !== undefined && value.projectId === undefined)
    return fail("invalid_association", "Select a project before selecting its environment.");
  return Object.freeze({ ...value }) as unknown as Association;
}
/** Never derive the credential destination from a repository-controlled file. */
export function endpoint(origin: string, allowLoopbackHttp = false): URL {
  let url: URL;
  try { url = new URL(origin); } catch { return fail("invalid_endpoint", "Set ZENITH_URL to the trusted Zenith origin."); }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname))
    return fail("invalid_endpoint", "ZENITH_URL must be an origin without credentials, path, query, or fragment.");
  const explicitLoopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?\/?$/.test(origin);
  if (url.protocol !== "https:" && !(allowLoopbackHttp && explicitLoopback))
    return fail("insecure_endpoint", "Use HTTPS, or explicitly allow a literal loopback HTTP origin for local development.");
  return new URL("/api/agent/v1/mcp", url.origin);
}
export function validateRequest(value: unknown): RpcRequest {
  if (!isObject(value) || value.jsonrpc !== "2.0" || !shortString(value.method, 100))
    return fail("invalid_request", "Send one JSON-RPC 2.0 request per line; batches are unsupported.");
  if ("id" in value && !(typeof value.id === "string" && value.id.length <= 100 || typeof value.id === "number" && Number.isSafeInteger(value.id)))
    return fail("invalid_request", "Request IDs must be a short string or a safe integer.");
  if ("params" in value && !isObject(value.params)) return fail("invalid_request", "Request params must be an object.");
  if (Object.keys(value).some(k => !["jsonrpc", "id", "method", "params"].includes(k)))
    return fail("invalid_request", "Unexpected JSON-RPC envelope field.");
  return value as unknown as RpcRequest;
}
export function errorResponse(id: RpcId | null, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function validateMethod(message: RpcRequest): void {
  const p = message.params;
  if (message.method === "initialize" && (!p || !shortString(p.protocolVersion, 40) || !isObject(p.capabilities)
    || !isObject(p.clientInfo) || !shortString(p.clientInfo.name) || !shortString(p.clientInfo.version)))
    fail("invalid_request", "Initialize with protocolVersion, capabilities, and clientInfo name/version.");
  if (message.method === "tools/call" && (!p || !shortString(p.name, 100) || p.arguments !== undefined && !isObject(p.arguments)))
    fail("invalid_request", "Tool calls require a name and object arguments.");
  if (message.method === "tools/list" && p?.cursor !== undefined && !shortString(p.cursor, 512))
    fail("invalid_request", "Use the server's bounded pagination cursor.");
}
/** Validate the supported profile, not arbitrary JSON that merely has an RPC id. */
export function validateResponse(message: RpcRequest, value: unknown): RpcResponse {
  if (!isObject(value) || value.jsonrpc !== "2.0" || value.id !== message.id || ("error" in value) === ("result" in value))
    return fail("invalid_response", "Zenith returned an invalid or mismatched response. Check protocol compatibility.");
  if ("error" in value) {
    if (!isObject(value.error) || !Number.isSafeInteger(value.error.code) || !shortString(value.error.message, 8192))
      return fail("invalid_response", "Zenith returned a malformed protocol error.");
    // A protocol error is not a trusted diagnostic channel; never reflect its raw body.
    return errorResponse(message.id ?? null, value.error.code as number, "Zenith rejected this protocol request. Inspect the server diagnostics using its request ID.");
  }
  const result = value.result;
  if (!isObject(result)) return fail("invalid_response", "The MCP result must be an object.");
  if (message.method === "initialize") {
    if (!(PROTOCOL_VERSIONS as readonly unknown[]).includes(result.protocolVersion))
      fail("protocol_mismatch", "The server selected an unsupported MCP revision. Upgrade the connector and server together.");
    if (!isObject(result.serverInfo) || !shortString(result.serverInfo.name) || !shortString(result.serverInfo.version)
      || !isObject(result.capabilities) || !isObject(result.capabilities.tools))
      fail("invalid_response", "Initialization must identify the server and its tool capability.");
    const capabilities = result.capabilities;
    if (capabilities.tools && isObject(capabilities.tools) && capabilities.tools.listChanged === true || ["prompts", "resources", "sampling", "elicitation"].some(k => k in capabilities))
      fail("unsupported_transport", "This reader does not support server-initiated capabilities or changing catalogs.");
  }
  if (message.method === "tools/list") {
    if (!Array.isArray(result.tools) || result.tools.length > 100 || result.nextCursor !== undefined && !shortString(result.nextCursor, 512))
      fail("invalid_catalog", "Zenith returned an invalid or oversized tool catalog.");
    const seen = new Set<string>();
    result.tools = result.tools.filter((tool: unknown) => {
      if (!isObject(tool) || !shortString(tool.name, 100)) return fail("invalid_catalog", "A tool is missing its name.");
      if (!isReadTool(tool.name)) return false;
      if (seen.has(tool.name) || !isObject(tool.inputSchema) || tool.inputSchema.type !== "object")
        return fail("invalid_catalog", "Read tools must have unique names and object input schemas.");
      if (tool.annotations !== undefined && (!isObject(tool.annotations) || tool.annotations.readOnlyHint === false || tool.annotations.destructiveHint === true))
        return fail("invalid_catalog", "The endpoint advertises a conflicting write capability for a read tool.");
      seen.add(tool.name); return true;
    });
  }
  if (message.method === "tools/call") {
    if (!Array.isArray(result.content) || result.content.length > 256 || result.content.some(c => !isObject(c) || c.type !== "text" || typeof c.text !== "string")
      || result.isError !== undefined && typeof result.isError !== "boolean")
      fail("invalid_response", "This reader requires bounded text tool results.");
    if (result.isError !== true && (!isObject(result.structuredContent) || result.structuredContent.contractVersion !== CONTRACT_VERSION
      || result.structuredContent.mode !== "read-only" || !("data" in result.structuredContent)))
      fail("contract_mismatch", "The endpoint does not implement Zenith reader contract version 1. No write was requested.");
  }
  return value as unknown as RpcResponse;
}
export interface Diagnostic {
  component: "zenith-client";
  requestId: string;
  method: string;
  outcome: "success" | "failure";
  durationMs: number;
  responseBytes: number;
  status?: number;
}
export interface ClientOptions {
  origin: string;
  allowLoopbackHttp?: boolean;
  association: Association;
  token: (signal?: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  onDiagnostic?: (record: Diagnostic) => void;
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); throw signal.reason; }
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}
export class ZenithClient {
  private readonly href: string;
  readonly scope: Association;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private version: string = PROTOCOL_VERSIONS[0];
  constructor(private readonly options: ClientOptions) {
    this.href = endpoint(options.origin, options.allowLoopbackHttp).href;
    this.scope = association(options.association);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 10 || this.timeoutMs > 30_000)
      fail("invalid_timeout", "Use a request timeout between 10 and 30000 milliseconds.");
  }
  /** Return a copy so a caller cannot change the destination after validation. */
  get url(): URL { return new URL(this.href); }
  get protocolVersion(): string { return this.version; }
  async request(raw: RpcRequest, signal?: AbortSignal): Promise<RpcResponse | undefined> {
    validateRequest(raw);
    let payload: string;
    try { payload = JSON.stringify(raw); } catch { return fail("invalid_request", "Send a JSON-serializable request."); }
    if (new TextEncoder().encode(payload).byteLength > MAX_REQUEST_BYTES)
      fail("request_too_large", "Request exceeds 64 KiB; narrow the request. Source upload is not supported.");
    const message = validateRequest(JSON.parse(payload)); // Snapshot before any await.
    if (message.id === undefined && message.method !== "notifications/initialized") return undefined;
    if (message.method === "notifications/initialized" && message.id !== undefined)
      return errorResponse(message.id, -32600, "An initialized notification must not have an id.");
    if (!["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"].includes(message.method))
      return message.id === undefined ? undefined : errorResponse(message.id, -32601, "Method unavailable in the read-only Zenith profile.");
    validateMethod(message);
    if (message.method === "tools/call" && !isReadTool(message.params?.name))
      return { jsonrpc: "2.0", id: message.id ?? null, result: {
        isError: true, content: [{ type: "text", text: "capability_unavailable: this connector supports inspection and non-executable previews only. Use Zenith's reviewed UI for writes." }],
      } };
    const started = Date.now(), requestId = crypto.randomUUID();
    let status: number | undefined, responseBytes = 0, outcome: Diagnostic["outcome"] = "failure";
    const abort = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
    try {
      abort.throwIfAborted();
      const token = await abortable(Promise.resolve().then(() => this.options.token(abort)), abort);
      if (!/^za_[A-Za-z0-9_-]{43}$/.test(token)) fail("invalid_credential", "Provide a Zenith agent credential; browser cookies and provider keys are not accepted.");
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`, "content-type": "application/json",
        accept: "application/json, text/event-stream", "mcp-protocol-version": this.version,
        "x-zenith-workspace": this.scope.workspaceId, "x-request-id": requestId,
      };
      if (this.scope.projectId) headers["x-zenith-project"] = this.scope.projectId;
      if (this.scope.environmentId) headers["x-zenith-environment"] = this.scope.environmentId;
      const response = await abortable(this.fetcher(this.url, { method: "POST", headers, body: payload,
        redirect: "error", credentials: "omit", cache: "no-store", signal: abort }), abort);
      status = response.status;
      if (response.status === 202 && message.id === undefined) { void response.body?.cancel().catch(() => {}); outcome = "success"; return undefined; }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const fixes: Record<number, string> = {
          401: "Credential expired, revoked, or invalid. Ask the operator to issue a scoped replacement.",
          403: "This credential does not permit the requested scope. Check project and environment selection.",
          404: "The agent endpoint is unavailable. Use Zenith master containing the agent-reader integration.",
          429: "Request limit reached. Wait before retrying this read.",
          503: "Agent access is not configured or its authority is unavailable. Run the server diagnostics.",
        };
        fail(`http_${response.status}`, fixes[response.status] ?? `Zenith returned HTTP ${response.status}. No automatic retry was made.`);
      }
      if (message.id === undefined) { void response.body?.cancel().catch(() => {}); fail("invalid_response", "An accepted notification must return HTTP 202 without an RPC response."); }
      if ((response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json" || response.headers.has("mcp-session-id")) {
        void response.body?.cancel().catch(() => {});
        fail("unsupported_transport", "This profile requires bounded stateless JSON responses. SSE-only and session-based MCP servers are not supported.");
      }
      const reader = response.body?.getReader();
      if (!reader) fail("invalid_response", "Zenith returned an empty response; check endpoint compatibility.");
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const chunk = await abortable(reader.read(), abort);
          if (chunk.done) break;
          responseBytes += chunk.value.byteLength;
          if (responseBytes > MAX_RESPONSE_BYTES) fail("response_too_large", "Response exceeds 256 KiB. Narrow the query or use pagination.");
          chunks.push(chunk.value);
        }
      } finally {
        // Do not let a hostile/incomplete body keep cancellation or shutdown blocked.
        void reader.cancel().catch(() => {}); reader.releaseLock();
      }
      const bytes = new Uint8Array(responseBytes); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      // Defense in depth for this exact credential, not a universal secret detector.
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll(token, "[REDACTED]");
      const result = validateResponse(message, JSON.parse(decoded));
      if (message.method === "initialize" && isObject(result.result)) this.version = String(result.result.protocolVersion);
      outcome = "success"; return result;
    } catch (error) {
      if (abort.aborted) fail("request_aborted", "Read cancelled or timed out. No write was requested; reconnect and inspect again.");
      if (error instanceof ClientError) throw error;
      return fail("transport_error", "Could not read a valid response from the pinned endpoint. Check connectivity and TLS; redirects and automatic retries are disabled.");
    } finally {
      try { this.options.onDiagnostic?.({ component: "zenith-client", requestId, method: message.method, outcome,
        durationMs: Date.now() - started, responseBytes, ...(status === undefined ? {} : { status }) }); } catch { /* Diagnostics never alter results or permissions. */ }
    }
  }
}
