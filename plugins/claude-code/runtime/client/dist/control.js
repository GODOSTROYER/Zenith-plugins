/** V2 API client. No database, approval, shell or provider implementation belongs here. */
import { createHash, randomUUID } from 'node:crypto';
import { association, endpoint, ClientError, isObject } from './index.js';
export const CONTROL_VERSION = 2;
export const CONTROL_TOOLS = Object.freeze(['zenith_prepare_change', 'zenith_execute_operation', 'zenith_get_operation', 'zenith_list_operations', 'zenith_get_operation_events', 'zenith_list_revisions', 'zenith_compare_revisions', 'zenith_get_logs', 'zenith_incident_bundle', 'zenith_get_app', 'zenith_get_edit_fields']);
export const READER_TOOLS = Object.freeze(['zenith_get_context', 'zenith_get_capabilities', 'zenith_list_projects', 'zenith_get_project', 'zenith_get_manifest', 'zenith_list_environments', 'zenith_plan_deploy', 'zenith_list_deployments', 'zenith_get_deployment', 'zenith_get_events', 'zenith_get_findings', 'zenith_get_drift', 'zenith_export_project']);
const WRITES = new Set(['zenith_prepare_change', 'zenith_execute_operation']);
const allowed = (name) => CONTROL_TOOLS.includes(name) || READER_TOOLS.includes(name);
export class ControlClient {
    #scope;
    #origin;
    #allowWrites;
    options;
    fetcher;
    constructor(options) {
        this.options = { ...options };
        this.#scope = association(options.association);
        this.#origin = endpoint(options.origin, options.allowLoopbackHttp).origin;
        this.#allowWrites = options.allowWrites === true;
        this.fetcher = options.fetch ?? fetch;
        if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10 || options.timeoutMs > 30000))
            throw new ClientError('invalid_timeout', 'Use a deadline between 10 and 30000 milliseconds.');
        if (options.credentialKind === 'oauth' && !this.origin.startsWith('https://'))
            throw new ClientError('oauth_requires_https', 'OAuth credentials require a trusted HTTPS origin.');
    }
    get scope() { return this.#scope; }
    get origin() { return this.#origin; }
    get allowWrites() { return this.#allowWrites; }
    async request(path, method, body, signal, contentType = 'application/json') {
        const start = Date.now(), requestId = randomUUID(), abort = AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs ?? 20000), ...(signal ? [signal] : [])]);
        let status, responseBytes = 0;
        const wait = (work) => new Promise((resolve, reject) => { const stop = () => reject(new ClientError('request_interrupted', 'Connection interrupted. Inspect the durable operation; never assume a write failed or retry with a new request key.')); if (abort.aborted) {
            void work.catch(() => { });
            stop();
            return;
        } abort.addEventListener('abort', stop, { once: true }); work.then(resolve, reject).finally(() => abort.removeEventListener('abort', stop)); });
        try {
            abort.throwIfAborted();
            const token = await wait(this.options.token());
            const valid = this.options.credentialKind === 'oauth' ? /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) && token.length <= 16384 : /^za_[A-Za-z0-9_-]{43}$/.test(token);
            if (!valid)
                throw new ClientError('invalid_credential', 'Use the explicitly selected scoped credential type. Browser cookies and provider API keys are not accepted.');
            const headers = { authorization: `Bearer ${token}`, accept: 'application/json', 'x-zenith-workspace': this.scope.workspaceId, 'x-request-id': requestId };
            if (this.scope.projectId)
                headers['x-zenith-project'] = this.scope.projectId;
            if (this.scope.environmentId)
                headers['x-zenith-environment'] = this.scope.environmentId;
            if (body !== undefined)
                headers['content-type'] = contentType;
            const response = await wait(this.fetcher(new URL(path, this.origin), { method, headers, ...(body === undefined ? {} : { body: body }), signal: abort, redirect: 'error', credentials: 'omit', cache: 'no-store' }));
            status = response.status;
            if (!response.ok && status === 400 && (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json') {
                // A 400 carries the server's own refusal (`{error:{code,message}}`), which
                // names the field to correct. Pass a bounded copy through; nothing else.
                const text = await wait(response.text()).catch(() => '');
                let detail;
                try {
                    detail = JSON.parse(text.slice(0, 8192));
                }
                catch {
                    detail = undefined;
                }
                const err = isObject(detail) && isObject(detail.error) ? detail.error : undefined;
                if (err && typeof err.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(err.code) && typeof err.message === 'string')
                    throw new ClientError(err.code, `${err.message.slice(0, 1000)} No automatic retry was made.`);
            }
            if (!response.ok) {
                void response.body?.cancel().catch(() => { });
                throw new ClientError(`http_${status}`, status === 401 ? 'Re-authenticate; token expired, invalid, or intended for another resource.' : status === 403 ? 'Check selected IDs, resource grants and scopes in Zenith. Do not obtain broader access to bypass a refusal.' : status === 503 ? 'Control unavailable or outcome uncertain. Inspect the operation before taking another action.' : `Zenith refused the request (HTTP ${status}). No automatic retry was made.`);
            }
            if ((response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
                void response.body?.cancel().catch(() => { });
                throw new ClientError('invalid_response', 'The versioned tools API must return JSON.');
            }
            const reader = response.body?.getReader();
            if (!reader)
                throw new ClientError('invalid_response', 'Empty response.');
            const chunks = [];
            try {
                for (;;) {
                    const item = await wait(reader.read());
                    if (item.done)
                        break;
                    responseBytes += item.value.byteLength;
                    if (responseBytes > 524288)
                        throw new ClientError('response_too_large', 'Narrow the query or paginate.');
                    chunks.push(item.value);
                }
            }
            finally {
                void reader.cancel().catch(() => { });
                reader.releaseLock();
            }
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replaceAll(token, '[REDACTED]'));
        }
        catch (error) {
            if (error instanceof ClientError)
                throw error;
            throw new ClientError('transport_failed', 'Could not complete the request against the trusted endpoint. Inspect operation status before retrying a possible write.');
        }
        finally {
            try {
                this.options.diagnostic?.({ component: 'zenith-control', requestId, method, durationMs: Date.now() - start, status, responseBytes });
            }
            catch { /* diagnostics cannot change results */ }
        }
    }
    async catalog(signal) {
        const data = await this.request('/api/agent/v2/tools', 'GET', undefined, signal);
        if (!isObject(data) || data.contractVersion !== CONTROL_VERSION || data.mode !== 'reviewed-operations' || !Array.isArray(data.tools) || data.tools.length > 100)
            throw new ClientError('contract_mismatch', 'Upgrade the connector and Zenith control endpoint together.');
        const seen = new Set(), tools = [];
        for (const item of data.tools) {
            if (!isObject(item) || typeof item.name !== 'string')
                throw new ClientError('invalid_catalog', 'Invalid tool catalog.');
            if (!allowed(item.name) || !this.allowWrites && WRITES.has(item.name))
                continue;
            if (seen.has(item.name) || typeof item.description !== 'string' || item.description.length > 8192 || !isObject(item.inputSchema) || item.inputSchema.type !== 'object')
                throw new ClientError('invalid_catalog', 'Invalid or duplicate tool definition.');
            if (!WRITES.has(item.name) && isObject(item.annotations) && (item.annotations.readOnlyHint === false || item.annotations.destructiveHint === true))
                throw new ClientError('invalid_catalog', 'Read capability advertises unexpected mutation.');
            seen.add(item.name);
            tools.push({ ...item, annotations: { readOnlyHint: !WRITES.has(item.name), destructiveHint: item.name === 'zenith_execute_operation', idempotentHint: true, openWorldHint: true } });
        }
        return tools;
    }
    async call(name, args, signal) {
        if (!allowed(name) || !this.allowWrites && WRITES.has(name))
            return { isError: true, content: [{ type: 'text', text: 'capability_unavailable: this tool is not enabled in the selected connection profile.' }] };
        const body = JSON.stringify({ name, arguments: args });
        if (Buffer.byteLength(body) > 524288)
            throw new ClientError('request_too_large', 'Request exceeds 512 KiB; source uploads use the separate CLI path.');
        const value = await this.request('/api/agent/v2/tools', 'POST', body, signal);
        if (!isObject(value) || !Array.isArray(value.content) || value.content.some(c => !isObject(c) || c.type !== 'text' || typeof c.text !== 'string') || value.isError !== undefined && typeof value.isError !== 'boolean')
            throw new ClientError('invalid_response', 'Invalid tool response.');
        if (value.isError !== true && (!isObject(value.structuredContent) || value.structuredContent.contractVersion !== CONTROL_VERSION || value.structuredContent.mode !== 'reviewed-operations' || !('data' in value.structuredContent)))
            throw new ClientError('contract_mismatch', 'Incorrect response contract.');
        return value;
    }
    async upload(appId, bytes, signal) {
        if (!this.allowWrites || !this.scope.projectId)
            throw new ClientError('upload_disabled', 'Explicit writable profile and project selection are required.');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(appId) || !bytes.length || bytes.length > 20 * 1024 * 1024)
            throw new ClientError('invalid_upload', 'Choose an actual app ID and a bounded source archive.');
        const snapshot = Uint8Array.from(bytes), hash = createHash('sha256').update(snapshot).digest('hex'), data = await this.request(`/api/agent/v2/source?app=${encodeURIComponent(appId)}`, 'POST', snapshot, signal, 'application/octet-stream');
        if (!isObject(data) || typeof data.uploadId !== 'string' || data.sha256 !== hash || data.bytes !== bytes.length || typeof data.expiresAt !== 'string')
            throw new ClientError('upload_integrity', 'The server did not acknowledge the exact uploaded bytes.');
        return data;
    }
}
