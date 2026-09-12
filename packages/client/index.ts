/** Distribution-side transport only. Operational decisions remain in Zenith. */
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
export const MAX_REQUEST_BYTES = 65_536;
export const MAX_RESPONSE_BYTES = 262_144;
export const READ_TOOLS = new Set([
  "zenith_get_context", "zenith_get_capabilities", "zenith_list_projects",
  "zenith_get_project", "zenith_get_manifest", "zenith_list_environments",
  "zenith_plan_deploy", "zenith_list_deployments", "zenith_get_deployment",
  "zenith_get_events", "zenith_get_findings", "zenith_get_drift", "zenith_export_project",
]);
export class ClientError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ClientError"; }
}
function fail(code: string, message: string): never { throw new ClientError(code, message); }
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
  return value as unknown as Association;
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
  if (!isObject(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string" || value.method.length > 100)
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
export interface ClientOptions {
  origin: string;
  allowLoopbackHttp?: boolean;
  association: Association;
  token: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export class ZenithClient {
  readonly url: URL;
  readonly scope: Association;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private version: string = PROTOCOL_VERSIONS[0];
  constructor(private readonly options: ClientOptions) {
    this.url = endpoint(options.origin, options.allowLoopbackHttp);
    this.scope = association(options.association);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 10 || this.timeoutMs > 30_000)
      fail("invalid_timeout", "Use a request timeout between 10 and 30000 milliseconds.");
  }
  async request(raw: RpcRequest, signal?: AbortSignal): Promise<RpcResponse | undefined> {
    const message = validateRequest(raw);
    const payload = JSON.stringify(message);
    if (new TextEncoder().encode(payload).byteLength > MAX_REQUEST_BYTES)
      fail("request_too_large", "Request exceeds 64 KiB; narrow the request. Source upload is not supported.");
    // This release is read-only even if connected accidentally to a newer server.
    if (message.method === "tools/call" && !READ_TOOLS.has(String(message.params?.name)))
      return { jsonrpc: "2.0", id: message.id ?? null, result: {
        isError: true, content: [{ type: "text", text: "capability_unavailable: this connector supports inspection and non-executable previews only. Use Zenith's reviewed UI for writes." }],
      } };
    if (!["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"].includes(message.method))
      return message.id === undefined ? undefined : errorResponse(message.id, -32601, "Method unavailable in the read-only Zenith profile.");
    const token = await this.options.token();
    if (!/^za_[A-Za-z0-9_-]{43}$/.test(token)) fail("invalid_credential", "Provide a Zenith agent credential; browser cookies and provider keys are not accepted.");
    const abort = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`, "content-type": "application/json",
      accept: "application/json, text/event-stream", "mcp-protocol-version": this.version,
      "x-zenith-workspace": this.scope.workspaceId, "x-request-id": crypto.randomUUID(),
    };
    if (this.scope.projectId) headers["x-zenith-project"] = this.scope.projectId;
    if (this.scope.environmentId) headers["x-zenith-environment"] = this.scope.environmentId;
    try {
      const response = await this.fetcher(this.url, { method: "POST", headers, body: payload, redirect: "error", signal: abort });
      if (response.status === 202 && message.id === undefined) { await response.body?.cancel(); return undefined; }
      if (!response.ok) {
        await response.body?.cancel();
        const fixes: Record<number, string> = {
          401: "Credential expired, revoked, or invalid. Ask the operator to issue a scoped replacement.",
          403: "This credential does not permit the requested scope. Check project and environment selection.",
          404: "The agent endpoint is unavailable. Install the reviewed Zenith companion changes.",
          429: "Request limit reached. Wait before retrying this read.",
          503: "Agent access is not configured or its authority is unavailable. Run the server diagnostics.",
        };
        fail(`http_${response.status}`, fixes[response.status] ?? `Zenith returned HTTP ${response.status}. Check the server using its request ID; no automatic retry was made.`);
      }
      if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        fail("unsupported_transport", "This profile requires bounded JSON responses. SSE-only and stateful MCP servers are not supported.");
      }
      if (response.headers.has("mcp-session-id")) {
        await response.body?.cancel(); fail("unsupported_transport", "A stateless Zenith endpoint is required; a session-based server was returned.");
      }
      const reader = response.body?.getReader();
      if (!reader) fail("invalid_response", "Zenith returned an empty response; check endpoint compatibility.");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); fail("response_too_large", "Response exceeds 256 KiB. Narrow the query or use pagination."); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!isObject(result) || result.jsonrpc !== "2.0" || result.id !== message.id || ("error" in result) === ("result" in result))
        fail("invalid_response", "Zenith returned an invalid or mismatched response. Check protocol compatibility.");
      if (message.method === "initialize" && isObject(result.result)) {
        const v = String(result.result.protocolVersion);
        if (!(PROTOCOL_VERSIONS as readonly string[]).includes(v)) fail("protocol_mismatch", "The server selected an unsupported MCP revision. Upgrade the connector and server together.");
        this.version = v;
      }
      // Never let accidental future server additions grant this bridge write tools.
      if (message.method === "tools/list" && isObject(result.result) && Array.isArray(result.result.tools))
        result.result.tools = result.result.tools.filter((t: unknown) => isObject(t) && READ_TOOLS.has(String(t.name)));
      return result as unknown as RpcResponse;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      if (abort.aborted) fail("request_aborted", "Read cancelled or timed out. No write was requested; reconnect and inspect again.");
      return fail("transport_error", "Could not read a valid response from the pinned endpoint. Check connectivity and TLS; redirects and automatic retries are disabled.");
    }
  }
}
