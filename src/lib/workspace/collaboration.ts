import * as Y from 'yjs';
import dicewareText from './diceware-de.txt?raw';
import {
	ROOT_FOLDER_ID,
	type WorkspaceFile,
	type WorkspaceFolder,
	type WorkspaceSnapshot
} from './model';

export const COLLABORATION_RELAY_URL = 'wss://ac.k-plus.one/__collab';
export const MAX_COLLABORATION_BYTES = 20_000_000;
const WORKSPACE_ORIGIN = 'workspace-ui';
const REMOTE_ORIGIN = 'collaboration-relay';
const COLLABORATION_CODE_WORDS = 4;

const DICEWARE_WORDS = dicewareText
	.split(/\r?\n/u)
	.map((line) => line.slice(line.indexOf('\t') + 1).trim())
	.filter(Boolean);

export interface OpaqueHostState {
	serverSetup: string;
	registrationRecord: string;
	userIdentifier: string;
	loginStates: Map<string, string>;
}

export interface OpaqueClientState {
	clientLoginState: string;
	password: string;
}

export interface EncryptedPayload {
	iv: string;
	ciphertext: string;
}

export function generateGermanPassphrase(): string {
	if (DICEWARE_WORDS.length !== 7776) {
		throw new Error('Die deutsche Wortliste ist unvollständig.');
	}
	const limit = Math.floor(0x1_0000_0000 / DICEWARE_WORDS.length) * DICEWARE_WORDS.length;
	const words: string[] = [];
	while (words.length < COLLABORATION_CODE_WORDS) {
		const random = crypto.getRandomValues(new Uint32Array(1))[0];
		if (random === undefined || random >= limit) continue;
		const word = DICEWARE_WORDS[random % DICEWARE_WORDS.length];
		if (word) words.push(word);
	}
	return words.join(' ');
}

export function normalizePassphrase(value: string): string {
	return value.normalize('NFC').trim().toLocaleLowerCase('de-DE').split(/\s+/u).join(' ');
}

export function normalizeCollaborationCode(code: string): string {
	const normalized = normalizePassphrase(code);
	if (normalized.split(' ').length !== COLLABORATION_CODE_WORDS) {
		throw new Error('Der Verbindungscode besteht aus genau vier Wörtern.');
	}
	return normalized;
}

export async function collaborationRoomIdFromCode(code: string): Promise<string> {
	const normalized = normalizeCollaborationCode(code);
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`K+ Coder collaboration room v1|${normalized}`)
	);
	return encodeBase64(new Uint8Array(digest).subarray(0, 16))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

export async function createOpaqueHost(
	roomId: string,
	passphrase: string
): Promise<OpaqueHostState> {
	const opaque = await import('@serenity-kit/opaque');
	await opaque.ready;
	const serverSetup = opaque.server.createSetup();
	const userIdentifier = `kplus-collab:${roomId}`;
	const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
		password: normalizeCollaborationCode(passphrase)
	});
	const { registrationResponse } = opaque.server.createRegistrationResponse({
		serverSetup,
		userIdentifier,
		registrationRequest
	});
	const { registrationRecord } = opaque.client.finishRegistration({
		clientRegistrationState,
		registrationResponse,
		password: normalizeCollaborationCode(passphrase)
	});
	return { serverSetup, registrationRecord, userIdentifier, loginStates: new Map() };
}

export async function startOpaqueClientLogin(
	passphrase: string
): Promise<{ state: OpaqueClientState; request: string }> {
	const opaque = await import('@serenity-kit/opaque');
	await opaque.ready;
	const password = normalizeCollaborationCode(passphrase);
	const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password });
	return { state: { clientLoginState, password }, request: startLoginRequest };
}

export async function createOpaqueServerLogin(
	host: OpaqueHostState,
	peerId: string,
	request: string
): Promise<string> {
	const opaque = await import('@serenity-kit/opaque');
	await opaque.ready;
	const { loginResponse, serverLoginState } = opaque.server.startLogin({
		userIdentifier: host.userIdentifier,
		registrationRecord: host.registrationRecord,
		serverSetup: host.serverSetup,
		startLoginRequest: request
	});
	host.loginStates.set(peerId, serverLoginState);
	return loginResponse;
}

export async function finishOpaqueClientLogin(
	state: OpaqueClientState,
	loginResponse: string
): Promise<{ finishLoginRequest: string; sessionKey: string }> {
	const opaque = await import('@serenity-kit/opaque');
	await opaque.ready;
	const result = opaque.client.finishLogin({
		clientLoginState: state.clientLoginState,
		loginResponse,
		password: state.password
	});
	if (!result) throw new Error('Der Vier-Wörter-Code stimmt nicht.');
	return { finishLoginRequest: result.finishLoginRequest, sessionKey: result.sessionKey };
}

export async function finishOpaqueServerLogin(
	host: OpaqueHostState,
	peerId: string,
	finishLoginRequest: string
): Promise<string> {
	const opaque = await import('@serenity-kit/opaque');
	await opaque.ready;
	const serverLoginState = host.loginStates.get(peerId);
	if (!serverLoginState) throw new Error('Der Anmeldungsschritt ist abgelaufen.');
	host.loginStates.delete(peerId);
	return opaque.server.finishLogin({ finishLoginRequest, serverLoginState }).sessionKey;
}

export function encodeBase64(value: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < value.length; index += 0x8000) {
		binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bufferSource(value: Uint8Array): ArrayBuffer {
	return new Uint8Array(value).buffer as ArrayBuffer;
}

export async function derivePairwiseKey(sessionKey: string, roomId: string): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(sessionKey),
		'HKDF',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new TextEncoder().encode(roomId),
			info: new TextEncoder().encode('K+ Coder collaboration welcome v1')
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function createGroupKey(): Promise<{ bytes: Uint8Array; key: CryptoKey }> {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
	return { bytes, key };
}

export async function importGroupKey(encoded: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', bufferSource(decodeBase64(encoded)), 'AES-GCM', false, [
		'encrypt',
		'decrypt'
	]);
}

export async function encryptPayload(
	key: CryptoKey,
	value: unknown,
	additionalData: string
): Promise<EncryptedPayload> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv,
			additionalData: new TextEncoder().encode(additionalData),
			tagLength: 128
		},
		key,
		new TextEncoder().encode(JSON.stringify(value))
	);
	return { iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) };
}

export async function decryptPayload<T>(
	key: CryptoKey,
	payload: EncryptedPayload,
	additionalData: string
): Promise<T> {
	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: bufferSource(decodeBase64(payload.iv)),
			additionalData: bufferSource(new TextEncoder().encode(additionalData)),
			tagLength: 128
		},
		key,
		bufferSource(decodeBase64(payload.ciphertext))
	);
	return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function seedSharedWorkspace(
	doc: Y.Doc,
	snapshot: WorkspaceSnapshot,
	openFileIds = snapshot.openFileIds
): void {
	const folders = doc.getMap<WorkspaceFolder>('folders');
	const files = doc.getMap<Omit<WorkspaceFile, 'content'>>('files');
	const tabs = doc.getMap<boolean>('open-tabs');
	doc.transact(() => {
		for (const folder of snapshot.folders) folders.set(folder.id, { ...folder });
		for (const file of snapshot.files) {
			const { content, ...metadata } = file;
			files.set(file.id, metadata);
			const text = doc.getText(`content:${file.id}`);
			if (!text.length && content) text.insert(0, content);
		}
		for (const id of openFileIds) if (files.has(id)) tabs.set(id, true);
	}, WORKSPACE_ORIGIN);
}

export function syncSharedWorkspace(doc: Y.Doc, snapshot: WorkspaceSnapshot): void {
	const folders = doc.getMap<WorkspaceFolder>('folders');
	const files = doc.getMap<Omit<WorkspaceFile, 'content'>>('files');
	const tabs = doc.getMap<boolean>('open-tabs');
	doc.transact(() => {
		const folderIds = new Set(snapshot.folders.map((folder) => folder.id));
		for (const id of [...folders.keys()]) if (!folderIds.has(id)) folders.delete(id);
		for (const folder of snapshot.folders) {
			if (JSON.stringify(folders.get(folder.id)) !== JSON.stringify(folder)) {
				folders.set(folder.id, { ...folder });
			}
		}

		const fileIds = new Set(snapshot.files.map((file) => file.id));
		for (const id of [...files.keys()]) if (!fileIds.has(id)) files.delete(id);
		for (const file of snapshot.files) {
			const { content, ...metadata } = file;
			if (JSON.stringify(files.get(file.id)) !== JSON.stringify(metadata)) {
				files.set(file.id, metadata);
			}
			const text = doc.getText(`content:${file.id}`);
			if (text.toString() !== content) {
				if (text.length) text.delete(0, text.length);
				if (content) text.insert(0, content);
			}
		}

		const openIds = new Set(snapshot.openFileIds);
		for (const id of [...tabs.keys()]) if (!openIds.has(id)) tabs.delete(id);
		for (const id of openIds) {
			if (files.has(id) && tabs.get(id) !== true) tabs.set(id, true);
		}
	}, WORKSPACE_ORIGIN);
}

export function snapshotFromSharedWorkspace(
	doc: Y.Doc,
	local: WorkspaceSnapshot
): WorkspaceSnapshot {
	const folders = [...doc.getMap<WorkspaceFolder>('folders').values()].map((folder) => ({
		...folder
	}));
	if (!folders.some((folder) => folder.id === ROOT_FOLDER_ID)) {
		folders.unshift({ id: ROOT_FOLDER_ID, name: 'Projekt', parentId: null });
	}
	const files = [...doc.getMap<Omit<WorkspaceFile, 'content'>>('files').values()].map((file) => ({
		...file,
		content: doc.getText(`content:${file.id}`).toString()
	}));
	if (!files.length) return local;
	const folderIds = new Set(folders.map((folder) => folder.id));
	const validFiles = files.filter((file) => folderIds.has(file.folderId));
	if (!validFiles.length) return local;
	const fileIds = new Set(validFiles.map((file) => file.id));
	const openFileIds = [...doc.getMap<boolean>('open-tabs')]
		.filter(([id, open]) => open && fileIds.has(id))
		.map(([id]) => id);
	const activeFileId = openFileIds.includes(local.activeFileId)
		? local.activeFileId
		: (openFileIds[0] ?? '');
	return {
		...local,
		folders,
		files: validFiles,
		openFileIds,
		activeFileId,
		selectedFolderId: folderIds.has(local.selectedFolderId)
			? local.selectedFolderId
			: (folders[0]?.id ?? ROOT_FOLDER_ID)
	};
}

export function applyRemoteUpdate(doc: Y.Doc, update: Uint8Array): void {
	Y.applyUpdate(doc, update, REMOTE_ORIGIN);
}

export function isRemoteUpdateOrigin(origin: unknown): boolean {
	return origin === REMOTE_ORIGIN;
}

export function mergeUpdates(updates: Uint8Array[]): Uint8Array {
	return Y.mergeUpdates(updates);
}

export function fullWorkspaceUpdate(doc: Y.Doc): Uint8Array {
	return Y.encodeStateAsUpdate(doc);
}

export function destroySharedWorkspace(doc: Y.Doc): void {
	doc.destroy();
}

export function isSharedWorkspaceOrigin(origin: unknown): boolean {
	return origin === WORKSPACE_ORIGIN;
}
