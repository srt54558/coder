import { openDB, type IDBPDatabase } from 'idb';
import {
	createInitialWorkspace,
	LEGACY_STORAGE_KEY,
	sanitizeWorkspace,
	type WorkspaceSnapshot
} from './model';

const DATABASE_NAME = 'kplus-coder-session';
const STORE_NAME = 'session';
const SESSION_KEY = 'current';
const BACKUP_KEY = 'kplus-coder-session-backup';
const BACKUP_AT_KEY = 'kplus-coder-session-backup-at';
const IDB_AT_KEY = 'kplus-coder-session-idb-at';
const LEGACY_DATABASE_NAME = 'kplus-python-workspace';
const LEGACY_STORE_NAME = 'workspace';
const LEGACY_SNAPSHOT_KEY = 'current';
const LEGACY_BACKUP_KEY = 'kplus-python-workspace-backup';

export const SESSION_VERSION = 1;

export interface EditorSession {
	version: number;
	workspace: WorkspaceSnapshot;
	publishedContents: Record<string, string>;
	localUnsavedIds: string[];
	remotePaths: Record<string, string>;
}

let lastBackupAt = 0;
let databasePromise: Promise<IDBPDatabase> | undefined;

function database(): Promise<IDBPDatabase> {
	databasePromise ??= openDB(DATABASE_NAME, 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
		}
	});
	return databasePromise;
}

export function emptyPublishedContents(snapshot: WorkspaceSnapshot): Record<string, string> {
	return Object.fromEntries(snapshot.files.map((file) => [file.id, file.content]));
}

export function sanitizeSession(value: EditorSession): EditorSession {
	const workspace = sanitizeWorkspace(value.workspace);
	const fileIds = new Set(workspace.files.map((file) => file.id));
	const publishedContents = Object.fromEntries(
		Object.entries(value.publishedContents ?? {}).filter(([id]) => fileIds.has(id))
	);
	const remotePaths = Object.fromEntries(
		Object.entries(value.remotePaths ?? {}).filter(
			([id, path]) => fileIds.has(id) && typeof path === 'string'
		)
	);
	return {
		version: SESSION_VERSION,
		workspace,
		publishedContents,
		localUnsavedIds: (value.localUnsavedIds ?? []).filter((id) => fileIds.has(id)),
		remotePaths
	};
}

export function sessionFromWorkspace(
	workspace: WorkspaceSnapshot,
	options?: {
		publishedContents?: Record<string, string>;
		localUnsavedIds?: string[];
		remotePaths?: Record<string, string>;
	}
): EditorSession {
	return sanitizeSession({
		version: SESSION_VERSION,
		workspace,
		publishedContents: options?.publishedContents ?? {},
		localUnsavedIds: options?.localUnsavedIds ?? [],
		remotePaths: options?.remotePaths ?? {}
	});
}

export function writeSessionBackup(session: EditorSession): number {
	let savedAt = Date.now();
	if (savedAt <= lastBackupAt) savedAt = lastBackupAt + 1;
	lastBackupAt = savedAt;
	try {
		localStorage.setItem(BACKUP_KEY, JSON.stringify(session));
		localStorage.setItem(BACKUP_AT_KEY, String(savedAt));
	} catch {
		// IndexedDB remains the durable copy when localStorage is full.
	}
	return savedAt;
}

export function markSessionStored(savedAt: number) {
	try {
		localStorage.setItem(IDB_AT_KEY, String(savedAt));
	} catch {
		// The next reload still reads IndexedDB when no newer backup exists.
	}
}

function parseSession(raw: unknown): EditorSession | null {
	if (!raw || typeof raw !== 'object') return null;
	const value = raw as Partial<EditorSession> & { files?: unknown };
	if (value.workspace && typeof value.workspace === 'object') {
		return sanitizeSession({
			version: SESSION_VERSION,
			workspace: value.workspace as WorkspaceSnapshot,
			publishedContents: (value.publishedContents as Record<string, string> | undefined) ?? {},
			localUnsavedIds: value.localUnsavedIds ?? [],
			remotePaths: (value.remotePaths as Record<string, string> | undefined) ?? {}
		});
	}
	if (Array.isArray(value.files)) {
		const workspace = sanitizeWorkspace(value as unknown as WorkspaceSnapshot);
		return sessionFromWorkspace(workspace, {
			publishedContents: emptyPublishedContents(workspace)
		});
	}
	return null;
}

function readBackup(): { savedAt: number; session: EditorSession } | null {
	try {
		const raw = localStorage.getItem(BACKUP_KEY) ?? localStorage.getItem(LEGACY_BACKUP_KEY);
		if (!raw) return null;
		const session = parseSession(JSON.parse(raw) as unknown);
		if (!session) return null;
		const savedAt = Number(localStorage.getItem(BACKUP_AT_KEY) || 0);
		return { savedAt, session };
	} catch {
		return null;
	}
}

export function chooseSession(
	stored: EditorSession | null,
	backup: { savedAt: number; session: EditorSession } | null,
	idbSavedAt: number
): EditorSession | null {
	if (!stored) return backup?.session ?? null;
	if (!backup) return stored;
	return backup.savedAt > idbSavedAt ? backup.session : stored;
}

async function loadLegacySnapshot(): Promise<WorkspaceSnapshot | null> {
	try {
		const db = await openDB(LEGACY_DATABASE_NAME, 1);
		if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
			db.close();
			return null;
		}
		const storedRaw = (await db.get(LEGACY_STORE_NAME, LEGACY_SNAPSHOT_KEY)) as unknown;
		db.close();
		if (!storedRaw || typeof storedRaw !== 'object') return null;
		return sanitizeWorkspace(storedRaw as WorkspaceSnapshot);
	} catch {
		return null;
	}
}

export async function loadSession(): Promise<{ session: EditorSession; created: boolean }> {
	const db = await database();
	const storedRaw = (await db.get(STORE_NAME, SESSION_KEY)) as unknown;
	const stored = parseSession(storedRaw);
	const chosen = chooseSession(stored, readBackup(), Number(localStorage.getItem(IDB_AT_KEY) || 0));
	if (chosen) return { session: chosen, created: false };

	const legacy = await loadLegacySnapshot();
	if (legacy) {
		const session = sessionFromWorkspace(legacy, {
			publishedContents: emptyPublishedContents(legacy)
		});
		await db.put(STORE_NAME, session, SESSION_KEY);
		return { session, created: false };
	}

	let draft: string | null;
	try {
		draft = localStorage.getItem(LEGACY_STORAGE_KEY);
	} catch {
		draft = null;
	}
	const workspace = createInitialWorkspace(draft);
	const session = sessionFromWorkspace(workspace, {
		publishedContents: workspace.files[0]
			? { [workspace.files[0].id]: workspace.files[0].content }
			: {}
	});
	await db.put(STORE_NAME, session, SESSION_KEY);
	if (draft) {
		try {
			localStorage.removeItem(LEGACY_STORAGE_KEY);
		} catch {
			// Der Editorstand liegt jetzt in IndexedDB.
		}
	}
	return { session, created: true };
}

export async function saveSession(session: EditorSession, savedAt = Date.now()): Promise<void> {
	const db = await database();
	await db.put(STORE_NAME, sanitizeSession(session), SESSION_KEY);
	markSessionStored(savedAt);
}
