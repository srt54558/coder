import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_ARCHIVE_NAME, workspaceExport } from './archive';
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
	workspaceHref: `https://www.wwschool.de/webdav.php/person/${WORKSPACE_ARCHIVE_NAME}`
};

afterEach(() => vi.unstubAllGlobals());

function emptyPropfind(): Response {
	return new Response(
		`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"></D:multistatus>`,
		{ status: 207 }
	);
}

describe('wwschool workspace sync', () => {
	it('recognizes the untouched starter workspace after the welcome screen', () => {
		expect(isEmptyWorkspace({ ...createInitialWorkspace(), welcomed: true })).toBe(true);
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
				if (method === 'PROPFIND') return emptyPropfind();
				if (method === 'DELETE') return new Response(null, { status: 404 });
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
		expect(calls.find((call) => call.method === 'PUT')?.url).toBe(connection.workspaceHref);
		expect(calls.find((call) => call.method === 'PUT')?.url.endsWith('/coder-workspace.py')).toBe(
			true
		);
		expect(calls.find((call) => call.method === 'PUT')?.body).toContain(
			'# BEGIN KPLUS_WORKSPACE_V1'
		);
		expect(calls.find((call) => call.method === 'PUT')?.headers.has('Content-Type')).toBe(false);
		expect(calls.some((call) => call.method === 'MOVE')).toBe(false);
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

	it('deletes the previous file and puts the same coder-workspace.py', async () => {
		const previousSnapshot = createInitialWorkspace('print("alt")');
		const nextSnapshot = createInitialWorkspace('print("neu")');
		let workspaceText = await workspaceExport(previousSnapshot);
		const store = new Map<string, string>([[connection.workspaceHref, workspaceText]]);
		const putUrls: string[] = [];
		const deleted: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				if (method === 'GET') {
					const text = store.get(url);
					return text ? new Response(text, { status: 200 }) : new Response(null, { status: 404 });
				}
				if (method === 'PROPFIND') {
					return new Response(
						`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav.php/person/${WORKSPACE_ARCHIVE_NAME}</D:href>
    <D:propstat>
      <D:prop><D:resourcetype/><D:displayname>${WORKSPACE_ARCHIVE_NAME}</D:displayname></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`,
						{ status: 207 }
					);
				}
				if (method === 'DELETE') {
					deleted.push(url);
					store.delete(url);
					return new Response(null, { status: 204 });
				}
				if (method === 'PUT') {
					if (store.has(url)) {
						throw new Error(`PUT created a second file at ${url}`);
					}
					putUrls.push(url);
					store.set(url, String(init?.body ?? ''));
					return new Response(null, { status: 201 });
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
		expect(deleted).toContain(connection.workspaceHref);
		expect(putUrls).toEqual([connection.workspaceHref]);
		expect(store.size).toBe(1);
		expect(store.has(connection.workspaceHref)).toBe(true);
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
				if (method === 'PROPFIND') return emptyPropfind();
				if (method === 'DELETE') {
					store.delete(url);
					return new Response(null, { status: 404 });
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
