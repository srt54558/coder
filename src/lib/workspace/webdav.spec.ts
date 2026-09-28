import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_ARCHIVE_NAME, workspaceExport } from './archive';
import { createInitialWorkspace } from './model';
import {
	WebDavConflictError,
	hashWorkspace,
	isEmptyWorkspace,
	isPersonalFolderHref,
	writeWebDavWorkspace,
	type WebDavConnection,
	type WebDavCredentials
} from './webdav';

const credentials: WebDavCredentials = { username: 'person@example.test', password: 'test-only' };
const connection: WebDavConnection = {
	personalHref: 'https://www.wwschool.de/webdav.php/person/',
	personalName: 'person',
	workspaceHref: `https://www.wwschool.de/webdav.php/person/${WORKSPACE_ARCHIVE_NAME}`
};

afterEach(() => vi.unstubAllGlobals());

describe('wwschool workspace sync', () => {
	it('recognizes the untouched starter workspace after the welcome screen', () => {
		expect(isEmptyWorkspace({ ...createInitialWorkspace(), welcomed: true })).toBe(true);
	});

	it('picks the personal folder from the login in the WebDAV href', () => {
		const user = 'kri.avramovic@stg-segeberg.de';
		expect(isPersonalFolderHref(`/webdav.php/${user}/`, user)).toBe(true);
		expect(
			isPersonalFolderHref(
				`https://www.wwschool.de/webdav.php/${user}/`,
				user.toLocaleUpperCase('de')
			)
		).toBe(true);
		expect(isPersonalFolderHref(`/webdav.php/${encodeURIComponent(user)}/`, user)).toBe(true);
		expect(isPersonalFolderHref('/webdav.php/5079@stg-segeberg.de/', user)).toBe(false);
		expect(isPersonalFolderHref('/webdav.php/jgq1@stg-segeberg.de/', user)).toBe(false);
		expect(isPersonalFolderHref('/webdav.php/oberstufe@stg-segeberg.de/', user)).toBe(false);
	});

	it('creates a missing workspace as coder-workspace.py', async () => {
		const calls: { method: string; url: string; headers: Headers; body: string }[] = [];
		let workspaceText = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				const headers = new Headers(init?.headers);
				const body = typeof init?.body === 'string' ? init.body : '';
				calls.push({ method, url, headers, body });
				if (method === 'GET' && url === connection.workspaceHref && workspaceText) {
					return new Response(workspaceText, { status: 200 });
				}
				if (method === 'GET') return new Response(null, { status: 404 });
				if (method === 'PUT' && url === connection.workspaceHref) {
					workspaceText = body;
					return new Response(null, { status: 201 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const snapshot = createInitialWorkspace();
		const result = await writeWebDavWorkspace(credentials, connection, snapshot, null);

		expect(result.snapshot).toEqual(snapshot);
		expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'GET']);
		expect(calls[1]?.url).toBe(connection.workspaceHref);
		expect(calls[1]?.url.endsWith('/coder-workspace.py')).toBe(true);
		expect(calls[1]?.body).toContain('# BEGIN KPLUS_WORKSPACE_V1');
		expect(calls[1]?.headers.has('Content-Type')).toBe(false);
		expect(calls.some((call) => call.method === 'MOVE')).toBe(false);
		expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
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

	it('overwrites the same coder-workspace.py on later saves', async () => {
		const previousSnapshot = createInitialWorkspace('print("alt")');
		const nextSnapshot = createInitialWorkspace('print("neu")');
		const store = new Map<string, string>([
			[connection.workspaceHref, await workspaceExport(previousSnapshot)]
		]);
		const putUrls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				if (method === 'GET') {
					const text = store.get(url);
					return text ? new Response(text, { status: 200 }) : new Response(null, { status: 404 });
				}
				if (method === 'PUT' && url === connection.workspaceHref) {
					putUrls.push(url);
					store.set(url, String(init?.body ?? ''));
					return new Response(null, { status: 204 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const result = await writeWebDavWorkspace(
			credentials,
			connection,
			nextSnapshot,
			await hashWorkspace(previousSnapshot)
		);

		expect(result.snapshot).toEqual(nextSnapshot);
		expect(putUrls).toEqual([connection.workspaceHref]);
		expect([...store.keys()]).toEqual([connection.workspaceHref]);
	});

	it('writes later saves to the same workspace url', async () => {
		const first = createInitialWorkspace('print("eins")');
		const second = createInitialWorkspace('print("zwei")');
		const store = new Map<string, string>();
		const putUrls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				if (method === 'GET') {
					const text = store.get(url);
					return text ? new Response(text, { status: 200 }) : new Response(null, { status: 404 });
				}
				if (method === 'PUT') {
					putUrls.push(url);
					store.set(url, String(init?.body ?? ''));
					return new Response(null, { status: 201 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		await writeWebDavWorkspace(credentials, connection, first, null);
		await writeWebDavWorkspace(credentials, connection, second, await hashWorkspace(first));

		expect(putUrls).toEqual([connection.workspaceHref, connection.workspaceHref]);
		expect([...store.keys()]).toEqual([connection.workspaceHref]);
	});
});
