import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialWorkspace } from './model';
import {
	CODER_FOLDER_NAME,
	coderProjectPath,
	connectWebDav,
	isEmptyWorkspace,
	isPersonalFolderHref,
	listWebDavProjectTree,
	webDavRelativeDir,
	writeWebDavProjectFile,
	type WebDavConnection,
	type WebDavCredentials
} from './webdav';

const credentials: WebDavCredentials = { username: 'person@example.test', password: 'test-only' };
const connection: WebDavConnection = {
	personalHref: 'https://www.wwschool.de/webdav.php/person@example.test/storage/',
	personalName: 'person',
	projectHref: 'https://www.wwschool.de/webdav.php/person@example.test/storage/coder-kplus/'
};

function collectionListing(
	selfHref: string,
	children: { href: string; name: string }[] = []
): string {
	const row = (href: string, name: string) =>
		`<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>${name}</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
	return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${row(selfHref, 'self')}${children
		.map((child) => row(child.href, child.name))
		.join('')}</D:multistatus>`;
}

afterEach(() => vi.unstubAllGlobals());

describe('wwschool project folder', () => {
	it('recognizes the untouched starter workspace after the welcome screen', () => {
		expect(isEmptyWorkspace({ ...createInitialWorkspace(), welcomed: true })).toBe(true);
	});

	it('maps explorer folders onto coder-kplus', () => {
		expect(coderProjectPath('', 'main.py')).toBe('coder-kplus/main.py');
		expect(coderProjectPath('src/lib', 'app.py')).toBe('coder-kplus/src/lib/app.py');
		expect(CODER_FOLDER_NAME).toBe('coder-kplus');
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

	it('creates coder-kplus under personal storage on connect', async () => {
		const calls: { method: string; url: string }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				calls.push({ method, url });
				if (method === 'PROPFIND' && url === 'https://www.wwschool.de/webdav.php/') {
					return new Response(
						collectionListing('/webdav.php/', [
							{
								href: '/webdav.php/person@example.test/',
								name: 'Person'
							}
						]),
						{ status: 207 }
					);
				}
				if (
					method === 'PROPFIND' &&
					url === 'https://www.wwschool.de/webdav.php/person@example.test/'
				) {
					return new Response(
						collectionListing('/webdav.php/person@example.test/', [
							{
								href: '/webdav.php/person@example.test/storage/',
								name: 'storage'
							}
						]),
						{ status: 207 }
					);
				}
				if (method === 'PROPFIND' && url === connection.personalHref) {
					return new Response(collectionListing('/webdav.php/person@example.test/storage/'), {
						status: 207
					});
				}
				if (method === 'MKCOL' && url === connection.projectHref) {
					return new Response(null, { status: 201 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const result = await connectWebDav(credentials);
		expect(result.projectHref).toBe(connection.projectHref);
		expect(result.personalHref).toBe(connection.personalHref);
		expect(calls.map((call) => call.method)).toEqual(['PROPFIND', 'PROPFIND', 'PROPFIND', 'MKCOL']);
	});

	it('puts the open file into coder-kplus without a Content-Type header', async () => {
		const calls: { method: string; url: string; headers: Headers; body: string }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				const headers = new Headers(init?.headers);
				const body = typeof init?.body === 'string' ? init.body : '';
				calls.push({ method, url, headers, body });
				if (method === 'PUT' && url.endsWith('/coder-kplus/main.py')) {
					return new Response(null, { status: 201 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const href = await writeWebDavProjectFile(
			credentials,
			connection,
			'',
			'main.py',
			'print("hallo")'
		);

		expect(href).toBe(`${connection.projectHref}main.py`);
		expect(calls.map((call) => call.method)).toEqual(['PUT']);
		expect(calls[0]?.body).toBe('print("hallo")');
		expect(calls[0]?.headers.has('Content-Type')).toBe(false);
		expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
	});

	it('creates nested folders with MKCOL before putting the file', async () => {
		const calls: { method: string; url: string }[] = [];
		const srcHref = `${connection.projectHref}src/`;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				calls.push({ method, url });
				if (method === 'PROPFIND' && url === connection.projectHref) {
					return new Response(
						collectionListing('/webdav.php/person@example.test/storage/coder-kplus/'),
						{ status: 207 }
					);
				}
				if (method === 'MKCOL' && url === srcHref) {
					return new Response(null, { status: 201 });
				}
				if (method === 'PUT' && url === `${srcHref}hi.py`) {
					return new Response(null, { status: 201 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const href = await writeWebDavProjectFile(credentials, connection, 'src', 'hi.py', 'print(1)');
		expect(href).toBe(`${srcHref}hi.py`);
		expect(calls).toEqual([
			{ method: 'PROPFIND', url: connection.projectHref },
			{ method: 'MKCOL', url: srcHref },
			{ method: 'PUT', url: `${srcHref}hi.py` }
		]);
	});

	it('reuses an existing nested folder instead of calling MKCOL', async () => {
		const srcHref = `${connection.projectHref}src/`;
		const methods: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				methods.push(method);
				if (method === 'PROPFIND' && url === connection.projectHref) {
					return new Response(
						collectionListing('/webdav.php/person@example.test/storage/coder-kplus/', [
							{ href: '/webdav.php/person@example.test/storage/coder-kplus/src/', name: 'src' }
						]),
						{ status: 207 }
					);
				}
				if (method === 'PUT' && url === `${srcHref}hi.py`) {
					return new Response(null, { status: 201 });
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		await writeWebDavProjectFile(credentials, connection, 'src', 'hi.py', 'print(1)');
		expect(methods).toEqual(['PROPFIND', 'PUT']);
	});

	it('maps a listed folder href back onto a path inside coder-kplus', () => {
		expect(webDavRelativeDir(connection.projectHref, connection.projectHref)).toBe('');
		expect(webDavRelativeDir(connection.projectHref, `${connection.projectHref}src/lib/`)).toBe(
			'src/lib'
		);
	});

	it('lists files in coder-kplus without treating them as folders', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = init?.method ?? 'GET';
				const url = String(input);
				if (method === 'PROPFIND' && url === connection.projectHref) {
					return new Response(
						`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">` +
							`<D:response><D:href>/webdav.php/person@example.test/storage/coder-kplus/</D:href>` +
							`<D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>` +
							`<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
							`<D:response><D:href>/webdav.php/person@example.test/storage/coder-kplus/main.py</D:href>` +
							`<D:propstat><D:prop><D:resourcetype/><D:displayname>main.py</D:displayname></D:prop>` +
							`<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>` +
							`</D:multistatus>`,
						{ status: 207 }
					);
				}
				throw new Error(`Unexpected WebDAV ${method} ${url}`);
			})
		);

		const tree = await listWebDavProjectTree(credentials, connection);
		expect(tree.folders).toEqual([
			{
				id: connection.projectHref,
				name: CODER_FOLDER_NAME,
				parentId: null,
				href: connection.projectHref
			}
		]);
		expect(tree.files).toEqual([
			{
				id: `${connection.projectHref}main.py`,
				name: 'main.py',
				folderId: connection.projectHref,
				href: `${connection.projectHref}main.py`
			}
		]);
	});
});
