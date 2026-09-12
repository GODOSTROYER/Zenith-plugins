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
    error?: {
        code: number;
        message: string;
    };
}
export interface Association {
    version: 1;
    workspaceId: string;
    projectId?: string;
    environmentId?: string;
}
export declare const PROTOCOL_VERSIONS: readonly ["2025-11-25", "2025-06-18", "2024-11-05"];
export declare const CONTRACT_VERSION = 1;
export declare const MAX_REQUEST_BYTES = 65536;
export declare const MAX_RESPONSE_BYTES = 262144;
export declare const READ_TOOLS: ReadonlySet<string>;
export declare const isReadTool: (name: unknown) => name is string;
export declare class ClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare const isObject: (value: unknown) => value is Record<string, unknown>;
export declare function association(value: unknown): Association;
/** Never derive the credential destination from a repository-controlled file. */
export declare function endpoint(origin: string, allowLoopbackHttp?: boolean): URL;
export declare function validateRequest(value: unknown): RpcRequest;
export declare function errorResponse(id: RpcId | null, code: number, message: string): RpcResponse;
/** Validate the supported profile, not arbitrary JSON that merely has an RPC id. */
export declare function validateResponse(message: RpcRequest, value: unknown): RpcResponse;
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
export declare class ZenithClient {
    private readonly options;
    private readonly href;
    readonly scope: Association;
    private readonly fetcher;
    private readonly timeoutMs;
    private version;
    constructor(options: ClientOptions);
    /** Return a copy so a caller cannot change the destination after validation. */
    get url(): URL;
    get protocolVersion(): string;
    request(raw: RpcRequest, signal?: AbortSignal): Promise<RpcResponse | undefined>;
}
