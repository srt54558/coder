import { openDB, type IDBPDatabase } from 'idb';
import type { WorkspaceSnapshot } from './model';

const WEBDAV_ROOT = 'https://www.wwschool.de/webdav.php';
const WEBDAV_ROOT_HREF = `${WEBDAV_ROOT}/`;
export const CODER_FOLDER_NAME = 'coder-kplus';
const MAX_FILE_BYTES = 20_000_000;
const DATABASE_NAME = 'kplus-python-webdav';
const STORE_NAME = 'private-data';
const SESSION_CREDENTIALS_KEY = 'kplus-coder-webdav-session';

interface PrivateRecord {
	key: string;
	value: unknown;
}

interface PrivateDatabase {
	[STORE_NAME]: {
		key: string;
		value: PrivateRecord;
	};
}

export interface WebDavCredentials {
	username: string;
	password: string;
}

export interface WebDavConnection {
	personalHref: string;
	personalName: string;
	projectHref: string;
}

export type WebDavSyncState = WebDavConnection;

export interface WebDavTreeFolder {
	id: string;
	name: string;
	parentId: string | null;
	href: string;
}

export interface WebDavTreeFile {
	id: string;
	name: string;
	folderId: string;
	href: string;
}

export interface WebDavTree {
	folders: WebDavTreeFolder[];
	files: WebDavTreeFile[];
}

export class WebDavError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'WebDavError';
	}
}

let databasePromise: Promise<IDBPDatabase<PrivateDatabase>> | undefined;

function database(): Promise<IDBPDatabase<PrivateDatabase>> {
	databasePromise ??= openDB<PrivateDatabase>(DATABASE_NAME, 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'key' });
			}
		}
	});
	return databasePromise;
}

async function readPrivateRecord<T>(key: string): Promise<T | null> {
	const db = await database();
	const record = await db.get(STORE_NAME, key);
	return (record?.value as T | undefined) ?? null;
}

async function writePrivateRecord(key: string, value: unknown): Promise<void> {
	const db = await database();
	await db.put(STORE_NAME, { key, value });
}

function readSessionCredentials(): WebDavCredentials | null {
	try {
		const raw = sessionStorage.getItem(SESSION_CREDENTIALS_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<WebDavCredentials>;
		if (typeof value.username !== 'string' || typeof value.password !== 'string') return null;
		if (!value.username || !value.password) return null;
		return { username: value.username, password: value.password };
	} catch {
		return null;
	}
}

function writeSessionCredentials(credentials: WebDavCredentials): void {
	try {
		sessionStorage.setItem(SESSION_CREDENTIALS_KEY, JSON.stringify(credentials));
	} catch {
		throw new WebDavError('Die Anmeldung für diese Sitzung konnte nicht gespeichert werden.');
	}
}

function clearSessionCredentials(): void {
	try {
		sessionStorage.removeItem(SESSION_CREDENTIALS_KEY);
	} catch {
		// Ohne Sitzungsspeicher bleiben nur die gespeicherten Zugangsdaten.
	}
}

export async function saveWebDavCredentials(credentials: WebDavCredentials): Promise<void> {
	if (!crypto.subtle)
		throw new WebDavError('Dieser Browser unterstützt keine sichere lokale Anmeldung.');
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
		'encrypt',
		'decrypt'
	]);
	const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
	const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
	await writePrivateRecord('credentials', { key, iv: iv.buffer, ciphertext });
	clearSessionCredentials();
}

export async function rememberWebDavCredentials(
	credentials: WebDavCredentials,
	persist: boolean
): Promise<void> {
	if (persist) {
		await saveWebDavCredentials(credentials);
		return;
	}
	await clearPersistentWebDavCredentials();
	writeSessionCredentials(credentials);
}

export function hasSessionWebDavCredentials(): boolean {
	return readSessionCredentials() !== null;
}

export async function loadWebDavCredentials(): Promise<WebDavCredentials | null> {
	const session = readSessionCredentials();
	if (session) return session;
	const saved = await readPrivateRecord<{
		key: CryptoKey;
		iv: ArrayBuffer;
		ciphertext: ArrayBuffer;
	}>('credentials');
	if (!saved) return null;
	try {
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: saved.iv },
			saved.key,
			saved.ciphertext
		);
		const value = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<WebDavCredentials>;
		if (typeof value.username !== 'string' || typeof value.password !== 'string') return null;
		return { username: value.username, password: value.password };
	} catch {
		return null;
	}
}

async function clearPersistentWebDavCredentials(): Promise<void> {
	const db = await database();
	await db.delete(STORE_NAME, 'credentials');
}

export async function clearWebDavCredentials(): Promise<void> {
	clearSessionCredentials();
	await clearPersistentWebDavCredentials();
}

export async function loadWebDavSyncState(): Promise<WebDavSyncState | null> {
	const stored = await readPrivateRecord<Partial<WebDavSyncState>>('sync-state');
	if (
		!stored ||
		typeof stored.personalHref !== 'string' ||
		typeof stored.personalName !== 'string' ||
		typeof stored.projectHref !== 'string' ||
		!stored.personalHref ||
		!stored.personalName ||
		!stored.projectHref
	) {
		return null;
	}
	return {
		personalHref: stored.personalHref,
		personalName: stored.personalName,
		projectHref: stored.projectHref
	};
}

export async function saveWebDavSyncState(state: WebDavSyncState): Promise<void> {
	await writePrivateRecord('sync-state', state);
}

function basicAuthorization(credentials: WebDavCredentials): string {
	const bytes = new TextEncoder().encode(`${credentials.username}:${credentials.password}`);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `Basic ${btoa(binary)}`;
}

function checkedUrl(value: string, parent?: string): URL {
	const url = new URL(value, WEBDAV_ROOT);
	const root = new URL(WEBDAV_ROOT);
	const rootPath = root.pathname.replace(/\/+$/u, '');
	const urlPath = url.pathname.replace(/\/+$/u, '');
	const isRootEndpoint = urlPath === rootPath;
	if (url.origin !== root.origin || (!isRootEndpoint && !url.pathname.startsWith(`${rootPath}/`))) {
		throw new WebDavError('Der persönliche Ordner liegt außerhalb des WebDAV-Bereichs.');
	}
	if (parent && !url.pathname.startsWith(new URL(parent).pathname)) {
		throw new WebDavError('Der WebDAV-Pfad liegt außerhalb des persönlichen Ordners.');
	}
	return url;
}

function folderUrl(href: string): URL {
	const url = checkedUrl(href);
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url;
}

function childFileHref(folderHref: string, filename: string): string {
	return new URL(filename, folderUrl(folderHref)).href;
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code !== undefined && (code < 0x20 || code === 0x7f)) return true;
	}
	return false;
}

function childCollectionHref(parentHref: string, name: string): string {
	if (
		!name ||
		name.trim() !== name ||
		name === '.' ||
		name === '..' ||
		name.includes('/') ||
		name.includes('\\') ||
		hasControlCharacter(name)
	) {
		throw new WebDavError('Ungültiger Ordnername.');
	}
	return folderUrl(new URL(`${name}/`, folderUrl(parentHref)).href).href;
}

function assertProjectFolder(connection: WebDavConnection, parentHref: string): string {
	const root = folderUrl(connection.projectHref);
	const parent = folderUrl(parentHref);
	if (
		parent.origin !== root.origin ||
		(parent.href !== root.href && !parent.pathname.startsWith(root.pathname))
	) {
		throw new WebDavError('Der Ordner liegt außerhalb des K+ Coder-Projektordners.');
	}
	return parent.href;
}

export function coderProjectPath(relativeDir: string, filename: string): string {
	const dir = relativeDir.replace(/^\/+|\/+$/gu, '');
	return dir ? `${CODER_FOLDER_NAME}/${dir}/${filename}` : `${CODER_FOLDER_NAME}/${filename}`;
}

async function request(
	credentials: WebDavCredentials,
	url: string,
	method: string,
	headers: Record<string, string> = {},
	body?: string
): Promise<Response> {
	checkedUrl(url);
	try {
		return await fetch(url, {
			method,
			mode: 'cors',
			credentials: 'omit',
			cache: 'no-store',
			headers: { Authorization: basicAuthorization(credentials), ...headers },
			body
		});
	} catch {
		throw new WebDavError(
			'wwschool ist momentan nicht erreichbar. Die Dateien bleiben im offenen Workspace erhalten.'
		);
	}
}

function friendlyStatus(status: number, action: string): string {
	if (status === 401) return 'Die Anmeldung bei wwschool wurde abgelehnt.';
	if (status === 403) return 'wwschool verweigert den Zugriff auf diesen persönlichen Ordner.';
	if (status === 404) return 'Der persönliche WebDAV-Ordner wurde nicht gefunden.';
	if (status === 507) return 'Im WebDAV-Ordner ist nicht genügend Speicherplatz frei.';
	return `wwschool konnte ${action} nicht ausführen (HTTP ${status}).`;
}

function decodeXmlText(value: string): string {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
		.replace(/&lt;/gu, '<')
		.replace(/&gt;/gu, '>')
		.replace(/&quot;/gu, '"')
		.replace(/&apos;/gu, "'")
		.replace(/&amp;/gu, '&')
		.trim();
}

function xmlTagText(block: string, localName: string): string {
	const pattern = new RegExp(
		`<(?:[A-Za-z0-9]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${localName}>`,
		'i'
	);
	return decodeXmlText(pattern.exec(block)?.[1] ?? '');
}

function davResponseBlocks(xml: string): string[] {
	return xml.match(/<(?:[A-Za-z0-9]+:)?response\b[\s\S]*?<\/(?:[A-Za-z0-9]+:)?response>/gi) ?? [];
}

function responseIsCollection(block: string): boolean {
	return /<(?:[A-Za-z0-9]+:)?resourcetype\b[\s\S]*?<(?:[A-Za-z0-9]+:)?collection\b/i.test(block);
}

function decodeSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function listedResources(
	xml: string,
	scopeHref: string
): { href: string; name: string; collection: boolean }[] {
	const scope = checkedUrl(scopeHref);
	const scopePath = scope.pathname.replace(/\/+$/u, '');
	return davResponseBlocks(xml).flatMap((response) => {
		const href = xmlTagText(response, 'href');
		if (!href) return [];
		const listedUrl = new URL(href, scope);
		if (
			listedUrl.origin === scope.origin &&
			listedUrl.pathname.replace(/\/+$/u, '') === scopePath
		) {
			return [];
		}
		const url = checkedUrl(listedUrl.href, scope.href);
		const collection = responseIsCollection(response);
		const name = xmlTagText(response, 'displayname') || pathTail(url.href);
		return [
			{
				href: collection ? (url.href.endsWith('/') ? url.href : `${url.href}/`) : url.href,
				name,
				collection
			}
		];
	});
}

function listedCollections(xml: string, scopeHref: string): { href: string; name: string }[] {
	return listedResources(xml, scopeHref)
		.filter((row) => row.collection)
		.map(({ href, name }) => ({ href, name }));
}

function pathTail(href: string): string {
	const url = new URL(href, WEBDAV_ROOT);
	return decodeSegment(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
}

export function isPersonalFolderHref(href: string, username: string): boolean {
	return pathTail(href).toLocaleLowerCase('de') === username.trim().toLocaleLowerCase('de');
}

function findPersonalCollection(xml: string, username: string): { href: string; name: string } {
	const rows = listedCollections(xml, WEBDAV_ROOT);
	const matches = rows.filter((row) => isPersonalFolderHref(row.href, username));
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) throw new WebDavError('Der persönliche Ordner ist nicht eindeutig.');
	throw new WebDavError('Der persönliche Ordner wurde in der WebDAV-Liste nicht gefunden.');
}

async function findPersonalStorageCollection(
	credentials: WebDavCredentials,
	accountFolder: { href: string; name: string }
): Promise<{ href: string; name: string }> {
	const response = await request(credentials, accountFolder.href, 'PROPFIND', { Depth: '1' });
	if (response.status !== 207) {
		throw new WebDavError(
			friendlyStatus(response.status, 'den persönlichen Ordner lesen'),
			response.status
		);
	}
	const folders = listedCollections(await response.text(), accountFolder.href);
	const storage = folders.filter(
		(folder) => pathTail(folder.href).toLocaleLowerCase('de') === 'storage'
	);
	if (storage.length === 1) return storage[0];
	if (storage.length > 1) {
		throw new WebDavError('Der persönliche Ablageordner wurde nicht eindeutig erkannt.');
	}
	return accountFolder;
}

function findNamedCollection(
	xml: string,
	parentHref: string,
	name: string
): { href: string; name: string } | null {
	const wanted = name.trim().toLocaleLowerCase('de');
	const matches = listedCollections(xml, parentHref).filter(
		(folder) => pathTail(folder.href).toLocaleLowerCase('de') === wanted
	);
	if (matches.length > 1) {
		throw new WebDavError(`Der Ordner ${name} wurde nicht eindeutig erkannt.`);
	}
	return matches[0] ?? null;
}

async function listChildCollections(
	credentials: WebDavCredentials,
	folderHref: string
): Promise<string> {
	const href = folderUrl(folderHref).href;
	const response = await request(credentials, href, 'PROPFIND', { Depth: '1' });
	if (response.status !== 207) {
		throw new WebDavError(
			friendlyStatus(response.status, 'die Ordnerliste lesen'),
			response.status
		);
	}
	return response.text();
}

async function ensureChildCollection(
	credentials: WebDavCredentials,
	parentHref: string,
	name: string
): Promise<{ href: string; name: string }> {
	const parent = folderUrl(parentHref).href;
	const existing = findNamedCollection(
		await listChildCollections(credentials, parent),
		parent,
		name
	);
	if (existing) return existing;
	const href = childCollectionHref(parent, name);
	const created = await request(credentials, href, 'MKCOL');
	if (created.status === 201) return { href, name };
	if (created.status === 405 || created.status === 409 || created.status === 301) {
		const again = findNamedCollection(
			await listChildCollections(credentials, parent),
			parent,
			name
		);
		if (again) return again;
	}
	throw new WebDavError(
		friendlyStatus(created.status, `den Ordner ${name} anlegen`),
		created.status
	);
}

export async function connectWebDav(credentials: WebDavCredentials): Promise<WebDavConnection> {
	const response = await request(credentials, WEBDAV_ROOT_HREF, 'PROPFIND', { Depth: '1' });
	if (response.status !== 207)
		throw new WebDavError(
			friendlyStatus(response.status, 'die Ordnerliste lesen'),
			response.status
		);
	const accountFolder = findPersonalCollection(await response.text(), credentials.username);
	const storage = await findPersonalStorageCollection(credentials, accountFolder);
	const personalUrl = folderUrl(storage.href);
	const project = await ensureChildCollection(credentials, personalUrl.href, CODER_FOLDER_NAME);
	return {
		personalHref: personalUrl.href,
		personalName:
			accountFolder.name ||
			decodeSegment(new URL(accountFolder.href).pathname.split('/').filter(Boolean).at(-1) ?? ''),
		projectHref: project.href
	};
}

async function putText(credentials: WebDavCredentials, url: string, text: string): Promise<void> {
	// wwschool always creates a new document on PUT (same display name, new id).
	const response = await request(credentials, url, 'PUT', {}, text);
	if (!response.ok)
		throw new WebDavError(friendlyStatus(response.status, 'die Datei speichern'), response.status);
}

export async function writeWebDavProjectFile(
	credentials: WebDavCredentials,
	connection: WebDavConnection,
	relativeDir: string,
	filename: string,
	content: string
): Promise<string> {
	if (
		!filename ||
		filename.trim() !== filename ||
		filename === '.' ||
		filename === '..' ||
		filename.includes('/') ||
		filename.includes('\\') ||
		hasControlCharacter(filename)
	) {
		throw new WebDavError('Ungültiger Dateiname.');
	}
	if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
		throw new WebDavError('Die Datei ist größer als 20 MB und wurde nicht übertragen.');
	}
	let folder = folderUrl(connection.projectHref).href;
	const parts = relativeDir
		.split('/')
		.map((part) => part.trim())
		.filter(Boolean);
	for (const part of parts) {
		folder = (await ensureChildCollection(credentials, folder, part)).href;
	}
	const href = childFileHref(folder, filename);
	await putText(credentials, href, content);
	return href;
}

export async function createWebDavFolder(
	credentials: WebDavCredentials,
	connection: WebDavConnection,
	parentHref: string,
	name: string
): Promise<string> {
	const parent = assertProjectFolder(connection, parentHref);
	return (await ensureChildCollection(credentials, parent, name.trim())).href;
}

export async function createWebDavFile(
	credentials: WebDavCredentials,
	connection: WebDavConnection,
	folderHref: string,
	filename: string
): Promise<string> {
	const parent = assertProjectFolder(connection, folderHref);
	if (
		!filename ||
		filename.trim() !== filename ||
		filename === '.' ||
		filename === '..' ||
		filename.includes('/') ||
		filename.includes('\\') ||
		hasControlCharacter(filename)
	) {
		throw new WebDavError('Ungültiger Dateiname.');
	}
	const href = childFileHref(parent, filename);
	await putText(credentials, href, '');
	return href;
}

export function webDavRelativeDir(rootHref: string, folderHref: string): string {
	const root = folderUrl(rootHref).pathname.replace(/\/+$/u, '');
	const folder = folderUrl(folderHref).pathname.replace(/\/+$/u, '');
	if (folder === root) return '';
	if (!folder.startsWith(`${root}/`)) return '';
	return folder
		.slice(root.length + 1)
		.split('/')
		.filter(Boolean)
		.map(decodeSegment)
		.join('/');
}

export function emptyWebDavTree(connection: WebDavConnection): WebDavTree {
	const href = folderUrl(connection.projectHref).href;
	return {
		folders: [{ id: href, name: CODER_FOLDER_NAME, parentId: null, href }],
		files: []
	};
}

export async function listWebDavChildren(
	credentials: WebDavCredentials,
	folderHref: string
): Promise<{ folders: { href: string; name: string }[]; files: { href: string; name: string }[] }> {
	const xml = await listChildCollections(credentials, folderHref);
	const rows = listedResources(xml, folderHref);
	return {
		folders: rows.filter((row) => row.collection).map(({ href, name }) => ({ href, name })),
		files: rows.filter((row) => !row.collection).map(({ href, name }) => ({ href, name }))
	};
}

export async function listWebDavProjectTree(
	credentials: WebDavCredentials,
	connection: WebDavConnection
): Promise<WebDavTree> {
	const rootHref = folderUrl(connection.projectHref).href;
	const folders: WebDavTreeFolder[] = [
		{ id: rootHref, name: CODER_FOLDER_NAME, parentId: null, href: rootHref }
	];
	const files: WebDavTreeFile[] = [];
	const queue = [rootHref];
	const seen = new Set<string>();
	while (queue.length) {
		const href = queue.shift();
		if (!href || seen.has(href)) continue;
		seen.add(href);
		const children = await listWebDavChildren(credentials, href);
		for (const folder of children.folders) {
			folders.push({
				id: folder.href,
				name: folder.name || pathTail(folder.href),
				parentId: href,
				href: folder.href
			});
			queue.push(folder.href);
		}
		for (const file of children.files) {
			files.push({
				id: file.href,
				name: file.name || pathTail(file.href),
				folderId: href,
				href: file.href
			});
		}
	}
	return { folders, files };
}

export async function readWebDavFile(
	credentials: WebDavCredentials,
	href: string
): Promise<string> {
	const response = await request(credentials, href, 'GET');
	if (!response.ok)
		throw new WebDavError(friendlyStatus(response.status, 'die Datei lesen'), response.status);
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength > MAX_FILE_BYTES) {
		throw new WebDavError('Die Datei auf wwschool ist größer als 20 MB.');
	}
	return new TextDecoder().decode(bytes);
}

export function isEmptyWorkspace(snapshot: WorkspaceSnapshot): boolean {
	return (
		snapshot.files.length === 1 &&
		snapshot.folders.length === 1 &&
		snapshot.files[0]?.name === 'main.py' &&
		snapshot.files[0]?.content === ''
	);
}
