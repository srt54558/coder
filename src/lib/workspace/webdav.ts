import { openDB, type IDBPDatabase } from 'idb';
import {
	looksLikeWorkspaceArchive,
	parseWorkspaceArchive,
	WORKSPACE_ARCHIVE_NAME,
	workspaceExport
} from './archive';
import { sanitizeWorkspace, type WorkspaceSnapshot } from './model';

const WEBDAV_ROOT = 'https://www.wwschool.de/webdav.php';
const WORKSPACE_FILENAME = WORKSPACE_ARCHIVE_NAME;
const LEGACY_WORKSPACE_FILENAME = 'kplus-coder-workspace.json';
const STAGE_PREFIX = 'kplus-coder-pending-';
const MAX_WORKSPACE_BYTES = 20_000_000;
const DATABASE_NAME = 'kplus-python-webdav';
const STORE_NAME = 'private-data';
const SESSION_CREDENTIALS_KEY = 'kplus-coder-webdav-session';
const PROPFIND_ETAG = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>`;

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
	workspaceHref: string;
}

export interface WebDavSyncState extends WebDavConnection {
	lastSyncedHash: string;
	lastSyncedEtag?: string;
}

export interface RemoteWorkspace {
	snapshot: WorkspaceSnapshot;
	hash: string;
	etag: string | null;
	kind: 'archive' | 'json';
	href: string;
}

export interface RemoteProbe {
	exists: boolean;
	etag: string | null;
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

export class WebDavConflictError extends Error {
	constructor(
		readonly remote: RemoteWorkspace | null,
		message = 'Der Stand auf dem Server hat sich inzwischen geändert.'
	) {
		super(message);
		this.name = 'WebDavConflictError';
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
	return readPrivateRecord<WebDavSyncState>('sync-state');
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

function legacyWorkspaceHref(connection: WebDavConnection): string {
	return new URL(LEGACY_WORKSPACE_FILENAME, checkedUrl(connection.personalHref)).href;
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
			'wwschool ist momentan nicht erreichbar. Die lokalen Dateien bleiben erhalten.'
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

function xmlValue(element: Element, name: string): string {
	return element.getElementsByTagNameNS('DAV:', name).item(0)?.textContent?.trim() ?? '';
}

function xmlResponses(xml: Document): Element[] {
	return Array.from(xml.getElementsByTagNameNS('DAV:', 'response'));
}

function decodeSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function listedCollections(xml: Document, scopeHref: string): { href: string; name: string }[] {
	const scope = checkedUrl(scopeHref);
	const scopePath = scope.pathname.replace(/\/+$/u, '');
	const rows = xmlResponses(xml).flatMap((response) => {
		const href = xmlValue(response, 'href');
		const listedUrl = new URL(href, scope);
		if (
			listedUrl.origin === scope.origin &&
			listedUrl.pathname.replace(/\/+$/u, '') === scopePath
		) {
			return [];
		}
		const url = checkedUrl(listedUrl.href, scope.href);
		const isCollection = response
			.getElementsByTagNameNS('DAV:', 'resourcetype')
			.item(0)
			?.getElementsByTagNameNS('DAV:', 'collection').length;
		if (!isCollection) return [];
		return [
			{
				href: url.href.endsWith('/') ? url.href : `${url.href}/`,
				name: xmlValue(response, 'displayname')
			}
		];
	});
	return rows;
}

function findPersonalCollection(xml: Document, username: string): { href: string; name: string } {
	const rows = listedCollections(xml, WEBDAV_ROOT);
	const usernameKey = username.trim().toLocaleLowerCase('de');
	const exact = rows.filter((row) => {
		const segments = new URL(row.href).pathname.split('/').filter(Boolean).map(decodeSegment);
		return segments.at(-1)?.toLocaleLowerCase('de') === usernameKey;
	});
	if (exact.length === 1) return exact[0];
	if (exact.length > 1) throw new WebDavError('Der persönliche Ordner ist nicht eindeutig.');

	const personal = rows.filter((row) =>
		/\b(pers[oö]nlich|personal|privat|private|home)\b/iu.test(
			`${row.name} ${new URL(row.href).pathname}`
		)
	);
	if (personal.length === 1) return personal[0];

	const tokens = usernameKey
		.split('@')[0]
		.split(/[._-]+/u)
		.filter((token) => token.length > 3);
	const named = rows.filter((row) => {
		const key = `${row.name} ${new URL(row.href).pathname}`.toLocaleLowerCase('de');
		return tokens.some((token) => key.includes(token));
	});
	if (named.length === 1) return named[0];
	throw new WebDavError(
		'Der persönliche Ordner wurde in der WebDAV-Liste nicht eindeutig erkannt.'
	);
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
	let xml: Document;
	try {
		xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
		if (xml.getElementsByTagName('parsererror').length) throw new Error('XML');
	} catch {
		throw new WebDavError('wwschool hat eine ungültige Liste persönlicher Ordner zurückgegeben.');
	}
	const folders = listedCollections(xml, accountFolder.href);
	if (folders.length === 0) return accountFolder;
	const personal = folders.filter((folder) =>
		/\b(pers[oö]nlich|personal|privat|private|home|arbeitsplatz|dateien|files|documents)\b/iu.test(
			`${folder.name} ${new URL(folder.href).pathname}`
		)
	);
	if (personal.length === 1) return personal[0];
	if (personal.length > 1 || folders.length > 1) {
		throw new WebDavError('Der persönliche Ablageordner wurde nicht eindeutig erkannt.');
	}
	return folders[0];
}

export async function connectWebDav(credentials: WebDavCredentials): Promise<WebDavConnection> {
	const response = await request(credentials, WEBDAV_ROOT, 'PROPFIND', { Depth: '1' });
	if (response.status !== 207)
		throw new WebDavError(
			friendlyStatus(response.status, 'die Ordnerliste lesen'),
			response.status
		);
	const text = await response.text();
	let xml: Document;
	try {
		xml = new DOMParser().parseFromString(text, 'application/xml');
		if (xml.getElementsByTagName('parsererror').length) throw new Error('XML');
	} catch {
		throw new WebDavError('wwschool hat eine ungültige WebDAV-Ordnerliste zurückgegeben.');
	}
	const accountFolder = findPersonalCollection(xml, credentials.username);
	const personal = await findPersonalStorageCollection(credentials, accountFolder);
	const personalUrl = checkedUrl(personal.href);
	const workspaceUrl = new URL(WORKSPACE_FILENAME, personalUrl);
	return {
		personalHref: personalUrl.href,
		personalName:
			personal.name || decodeSegment(personalUrl.pathname.split('/').filter(Boolean).at(-1) ?? ''),
		workspaceHref: workspaceUrl.href
	};
}

function responseEtag(response: Response): string | null {
	return response.headers.get('etag') || response.headers.get('ETag');
}

async function parseRemoteBody(
	text: string,
	href: string,
	etag: string | null
): Promise<RemoteWorkspace> {
	if (looksLikeWorkspaceArchive(text)) {
		const snapshot = await parseWorkspaceArchive(text);
		if (!snapshot) {
			throw new WebDavError('Die Workspace-Datei auf wwschool enthält ungültige Daten.');
		}
		return {
			snapshot,
			hash: await hashWorkspace(snapshot),
			etag,
			kind: 'archive',
			href
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new WebDavError('Die Workspace-Datei auf wwschool enthält ungültige Daten.');
	}
	if (!value || typeof value !== 'object') {
		throw new WebDavError('Die Workspace-Datei auf wwschool hat ein unbekanntes Format.');
	}
	const payload = value as { application?: unknown; version?: unknown; snapshot?: unknown };
	if (
		payload.application !== 'kplus-coder' ||
		payload.version !== 1 ||
		!payload.snapshot ||
		typeof payload.snapshot !== 'object' ||
		!Array.isArray((payload.snapshot as WorkspaceSnapshot).files)
	) {
		throw new WebDavError(
			'Die Datei gehört nicht zu diesem Editor oder hat ein unbekanntes Format.'
		);
	}
	const snapshot = sanitizeWorkspace(payload.snapshot as WorkspaceSnapshot);
	return {
		snapshot,
		hash: await hashWorkspace(snapshot),
		etag,
		kind: 'json',
		href
	};
}

async function readRemoteAt(
	credentials: WebDavCredentials,
	url: string
): Promise<RemoteWorkspace | null> {
	const response = await request(credentials, url, 'GET');
	if (response.status === 404) return null;
	if (!response.ok)
		throw new WebDavError(
			friendlyStatus(response.status, 'die Workspace-Datei lesen'),
			response.status
		);
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength > MAX_WORKSPACE_BYTES) {
		throw new WebDavError('Die Workspace-Datei auf wwschool ist größer als 20 MB.');
	}
	return parseRemoteBody(new TextDecoder().decode(bytes), url, responseEtag(response));
}

export async function readWebDavWorkspace(
	credentials: WebDavCredentials,
	connection: WebDavConnection
): Promise<RemoteWorkspace | null> {
	return (
		(await readRemoteAt(credentials, connection.workspaceHref)) ??
		(await readRemoteAt(credentials, legacyWorkspaceHref(connection)))
	);
}

async function probeHref(credentials: WebDavCredentials, url: string): Promise<RemoteProbe | null> {
	const head = await request(credentials, url, 'HEAD');
	if (head.status === 404) return { exists: false, etag: null };
	if (head.ok) return { exists: true, etag: responseEtag(head) };
	if (head.status === 401 || head.status === 403) {
		throw new WebDavError(friendlyStatus(head.status, 'die Workspace-Datei prüfen'), head.status);
	}

	const listed = await request(credentials, url, 'PROPFIND', { Depth: '0' }, PROPFIND_ETAG);
	if (listed.status === 404) return { exists: false, etag: null };
	if (listed.status !== 207) return null;
	let xml: Document;
	try {
		xml = new DOMParser().parseFromString(await listed.text(), 'application/xml');
		if (xml.getElementsByTagName('parsererror').length) throw new Error('XML');
	} catch {
		return null;
	}
	const etag = xmlValue(xml.documentElement, 'getetag') || null;
	return { exists: true, etag };
}

export async function probeWebDavWorkspace(
	credentials: WebDavCredentials,
	connection: WebDavConnection
): Promise<RemoteProbe | null> {
	const primary = await probeHref(credentials, connection.workspaceHref);
	if (!primary) return null;
	if (primary.exists) return primary;
	return probeHref(credentials, legacyWorkspaceHref(connection));
}

async function moveFile(
	credentials: WebDavCredentials,
	source: string,
	destination: string,
	overwrite: 'T' | 'F' = 'F'
): Promise<Response> {
	return request(credentials, source, 'MOVE', {
		Destination: destination,
		Overwrite: overwrite
	});
}

async function putText(credentials: WebDavCredentials, url: string, text: string): Promise<void> {
	const response = await request(credentials, url, 'PUT', {}, text);
	if (!response.ok)
		throw new WebDavError(friendlyStatus(response.status, 'die Datei speichern'), response.status);
}

async function deleteQuietly(credentials: WebDavCredentials, url: string): Promise<void> {
	try {
		await request(credentials, url, 'DELETE');
	} catch {
		// Eine hängengebliebene Zwischendatei stört den nächsten Abgleich nicht.
	}
}

export async function writeWebDavWorkspace(
	credentials: WebDavCredentials,
	connection: WebDavConnection,
	snapshot: WorkspaceSnapshot,
	expectedHash: string | null
): Promise<RemoteWorkspace> {
	const current = await readWebDavWorkspace(credentials, connection);
	if ((current?.hash ?? null) !== expectedHash) throw new WebDavConflictError(current);
	const text = await workspaceExport(snapshot);
	if (new TextEncoder().encode(text).byteLength > MAX_WORKSPACE_BYTES) {
		throw new WebDavError('Die Workspace-Datei ist größer als 20 MB und wurde nicht übertragen.');
	}
	const nextHash = await hashWorkspace(snapshot);
	if (current?.hash === nextHash && current.kind === 'archive') return current;
	const personalUrl = checkedUrl(connection.personalHref);
	const stageUrl = new URL(`${STAGE_PREFIX}${crypto.randomUUID()}.py`, personalUrl).href;
	let staged = false;
	try {
		await putText(credentials, stageUrl, text);
		staged = true;
		const overwrite = current ? 'T' : 'F';
		const committed = await moveFile(credentials, stageUrl, connection.workspaceHref, overwrite);
		if (!committed.ok) {
			throw new WebDavConflictError(await readWebDavWorkspace(credentials, connection));
		}
		staged = false;
	} finally {
		if (staged) await deleteQuietly(credentials, stageUrl);
	}

	if (current?.kind === 'json') {
		await deleteQuietly(credentials, legacyWorkspaceHref(connection));
	}

	const verified = await readRemoteAt(credentials, connection.workspaceHref);
	if (!verified || verified.hash !== nextHash) {
		throw new WebDavConflictError(
			verified,
			'wwschool hat während des Speicherns einen anderen Stand erhalten.'
		);
	}
	return verified;
}

export async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function snapshotHashInput(snapshot: WorkspaceSnapshot): string {
	return JSON.stringify({ application: 'kplus-coder', version: 1, snapshot });
}

export async function hashWorkspace(snapshot: WorkspaceSnapshot): Promise<string> {
	return sha256(snapshotHashInput(snapshot));
}

export function isEmptyWorkspace(snapshot: WorkspaceSnapshot): boolean {
	return (
		snapshot.files.length === 1 &&
		snapshot.folders.length === 1 &&
		snapshot.files[0]?.name === 'main.py' &&
		snapshot.files[0]?.content === ''
	);
}
