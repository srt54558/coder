import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceExport } from './archive';
import { createInitialWorkspace } from './model';
import {
	WebDavConflictError,
	hashWorkspace,
	isEmptyWorkspace,
	writeWebDavWorkspace,
	type WebDavConnection,
	type WebDavCredentials
} from './webdav';

const credentials: WebDavCredentials = { username: 'person@example.test', password: 'test-only' };
const connection: WebDavConnection = {
	personalHref: 'https://www.wwschool.de/webdav.php/person/',
	personalName: 'person',
	workspaceHref: 'https://www.wwschool.de/webdav.php/person/python-workspace.py'
};
const legacyHref = 'https://www.wwschool.de/webdav.php/person/kplus-coder-workspace.json';

afterEach(() => vi.unstubAllGlobals());

describe('wwschool workspace sync', () => {
	it('recognizes the untouched starter workspace after the welcome screen', () => {
		expect(isEmptyWorkspace({ ...createInitialWorkspace(), welcomed: true })).toBe(true);
	});

	it('creates a missing workspace as a compressed python archive', async () => {
		const calls: { method: string; url: string; headers: Headers; body: string }[] = [];
		let stagedText = '';
		let workspaceText = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				const headers = new Headers(init?.headers);
				const body = typeof init?.body === 'string' ? init.body : '';
				calls.push({ method, url, headers, body });
				if (method === 'GET' && !workspaceText) {
					return new Response(null, { status: 404 });
				}
				if (method === 'PUT') {
					stagedText = body;
					return new Response(null, { status: 201 });
				}
				if (method === 'MOVE') {
					workspaceText = stagedText;
					return new Response(null, { status: 201 });
				}
				if (method === 'GET') return new Response(workspaceText, { status: 200 });
				if (method === 'DELETE') return new Response(null, { status: 404 });
				throw new Error(`Unexpected WebDAV method: ${method}`);
			})
		);

		const snapshot = createInitialWorkspace();
		const result = await writeWebDavWorkspace(credentials, connection, snapshot, null);

		expect(result.snapshot).toEqual(snapshot);
		expect(result.kind).toBe('archive');
		expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'PUT', 'MOVE', 'GET']);
		expect(calls[1]?.url).toBe(legacyHref);
		expect(calls[2]?.body).toContain('# BEGIN KPLUS_WORKSPACE_V1');
		expect(calls[2]?.body).toContain('import gzip');
		expect(calls[2]?.headers.has('Content-Type')).toBe(false);
		expect(calls[3]?.headers.get('Destination')).toBe(connection.workspaceHref);
		expect(calls[3]?.headers.get('Overwrite')).toBe('F');
	});

	it('stops before writing when the remote file differs from the expected base', async () => {
		const snapshot = createInitialWorkspace();
		const remoteText = await workspaceExport(snapshot);
		const fetch = vi.fn(async () => new Response(remoteText, { status: 200 }));
		vi.stubGlobal('fetch', fetch);

		await expect(
			writeWebDavWorkspace(credentials, connection, snapshot, null)
		).rejects.toBeInstanceOf(WebDavConflictError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('replaces a synced workspace without leaving a backup file', async () => {
		const previousSnapshot = createInitialWorkspace('print("alt")');
		const nextSnapshot = createInitialWorkspace('print("neu")');
		let workspaceText = await workspaceExport(previousSnapshot);
		let stagedText = '';
		const calls: { method: string; url: string; headers: Headers }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				const headers = new Headers(init?.headers);
				calls.push({ method, url, headers });
				if (method === 'GET') {
					if (url === connection.workspaceHref && workspaceText) {
						return new Response(workspaceText, { status: 200 });
					}
					return new Response(null, { status: 404 });
				}
				if (method === 'PUT') {
					stagedText = String(init?.body ?? '');
					return new Response(null, { status: 201 });
				}
				if (method === 'MOVE') {
					workspaceText = stagedText;
					return new Response(null, { status: 201 });
				}
				if (method === 'DELETE') return new Response(null, { status: 204 });
				throw new Error(`Unexpected WebDAV method: ${method}`);
			})
		);

		const result = await writeWebDavWorkspace(
			credentials,
			connection,
			nextSnapshot,
			await hashWorkspace(previousSnapshot)
		);

		expect(result.snapshot).toEqual(nextSnapshot);
		expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
		expect(calls.filter((call) => call.method === 'MOVE')).toHaveLength(1);
		expect(calls.find((call) => call.method === 'MOVE')?.headers.get('Destination')).toBe(
			connection.workspaceHref
		);
		expect(calls.find((call) => call.method === 'MOVE')?.headers.get('Overwrite')).toBe('T');
		expect(calls.some((call) => call.headers.get('Destination')?.includes('backup'))).toBe(false);
	});

	it('migrates an old json workspace into the compressed python file', async () => {
		const snapshot = createInitialWorkspace('print("json")');
		const jsonText = JSON.stringify({
			application: 'kplus-coder',
			version: 1,
			snapshot
		});
		let stagedText = '';
		let archiveText = '';
		let jsonExists = true;
		const calls: { method: string; url: string }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				calls.push({ method, url });
				if (method === 'GET' && url === connection.workspaceHref) {
					return archiveText
						? new Response(archiveText, { status: 200 })
						: new Response(null, { status: 404 });
				}
				if (method === 'GET' && url === legacyHref) {
					return jsonExists
						? new Response(jsonText, { status: 200 })
						: new Response(null, { status: 404 });
				}
				if (method === 'PUT') {
					stagedText = String(init?.body ?? '');
					return new Response(null, { status: 201 });
				}
				if (method === 'MOVE') {
					archiveText = stagedText;
					return new Response(null, { status: 201 });
				}
				if (method === 'DELETE' && url === legacyHref) {
					jsonExists = false;
					return new Response(null, { status: 204 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const result = await writeWebDavWorkspace(
			credentials,
			connection,
			snapshot,
			await hashWorkspace(snapshot)
		);

		expect(result.kind).toBe('archive');
		expect(jsonExists).toBe(false);
		expect(calls.some((call) => call.method === 'DELETE' && call.url === legacyHref)).toBe(true);
	});
});
