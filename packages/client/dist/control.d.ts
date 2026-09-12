import { type Association } from './index.js';
export declare const CONTROL_VERSION = 2;
export declare const CONTROL_TOOLS: readonly string[];
export declare const READER_TOOLS: readonly string[];
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, boolean>;
    requiredScope?: string;
}
export interface ControlResult {
    content: {
        type: 'text';
        text: string;
    }[];
    structuredContent?: {
        contractVersion: 2;
        mode: 'reviewed-operations';
        data: unknown;
    };
    isError?: boolean;
}
export interface ControlOptions {
    origin: string;
    association: Association;
    allowLoopbackHttp?: boolean;
    allowWrites?: boolean;
    credentialKind?: 'opaque' | 'oauth';
    token: () => Promise<string>;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    diagnostic?: (record: Record<string, unknown>) => void;
}
export declare class ControlClient {
    #private;
    private readonly options;
    private readonly fetcher;
    constructor(options: ControlOptions);
    get scope(): Association;
    get origin(): string;
    get allowWrites(): boolean;
    private request;
    catalog(signal?: AbortSignal): Promise<ToolDefinition[]>;
    call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ControlResult>;
    upload(appId: string, bytes: Uint8Array, signal?: AbortSignal): Promise<{
        uploadId: string;
        sha256: string;
        bytes: number;
        expiresAt: string;
    }>;
}
