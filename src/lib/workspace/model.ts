export const WORKSPACE_VERSION = 1;
export const ROOT_FOLDER_ID = 'root';
export const LEGACY_STORAGE_KEY = 'kplus-python-code';

export interface WorkspaceFolder {
	id: string;
	name: string;
	parentId: string | null;
}

export interface WorkspaceFile {
	id: string;
	name: string;
	folderId: string;
	content: string;
	updatedAt: number;
}

export interface WorkspaceLayout {
	problemsOpen: boolean;
	problemsSize: number;
	terminalCollapsed: boolean;
}

export interface WorkspaceSnapshot {
	version: number;
	folders: WorkspaceFolder[];
	files: WorkspaceFile[];
	openFileIds: string[];
	activeFileId: string;
	selectedFolderId: string;
	layout: WorkspaceLayout;
	/** False until the first-launch choice has created the opening file. */
	welcomed: boolean;
}

export const STARTER_CODE = `from datetime import datetime

name = "Welt"
print(f"Hallo, {name}!")
print("Python-Zeit:", datetime.now().strftime("%H:%M:%S"))
`;

export function createId(prefix: 'file' | 'folder'): string {
	let uuid: string;
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		uuid = crypto.randomUUID();
	} else {
		const bytes = new Uint8Array(16);
		if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
			crypto.getRandomValues(bytes);
		} else {
			for (let index = 0; index < bytes.length; index += 1) {
				bytes[index] = Math.floor(Math.random() * 256);
			}
		}
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
		uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	return `${prefix}-${uuid}`;
}

export function createInitialWorkspace(legacyDraft?: string | null): WorkspaceSnapshot {
	const mainId = createId('file');
	const migrated = typeof legacyDraft === 'string';
	return {
		version: WORKSPACE_VERSION,
		folders: [{ id: ROOT_FOLDER_ID, name: 'Projekt', parentId: null }],
		files: [
			{
				id: mainId,
				name: 'main.py',
				folderId: ROOT_FOLDER_ID,
				content: migrated ? legacyDraft : '',
				updatedAt: Date.now()
			}
		],
		openFileIds: [mainId],
		activeFileId: mainId,
		selectedFolderId: ROOT_FOLDER_ID,
		layout: { problemsOpen: false, problemsSize: 30, terminalCollapsed: false },
		welcomed: migrated
	};
}

export function normalizeName(value: string): string {
	return value.trim().replace(/[\\/]/g, '-');
}

export function normalizeFileName(value: string): string {
	const normalized = normalizeName(value);
	return normalized || 'datei.py';
}

const PYTHON_EXTENSIONS = new Set(['py', 'pyw', 'pyi']);
const SUPPORTED_EXTENSIONS = new Set([
	'py',
	'pyw',
	'pyi',
	'html',
	'htm',
	'js',
	'css',
	'json',
	'xml',
	'txt',
	'md'
]);

export type CodeLanguage =
	'python' | 'html' | 'javascript' | 'css' | 'json' | 'xml' | 'markdown' | 'text';

export function fileExtension(name: string): string {
	const base = name.trim().split(/[\\/]/u).pop() ?? '';
	const dot = base.lastIndexOf('.');
	if (dot <= 0) return '';
	return base.slice(dot + 1).toLocaleLowerCase('de');
}

export function isPythonFile(name: string): boolean {
	return PYTHON_EXTENSIONS.has(fileExtension(name));
}

export function isHtmlFile(name: string): boolean {
	const extension = fileExtension(name);
	return extension === 'html' || extension === 'htm';
}

export function isDocumentFile(name: string): boolean {
	const extension = fileExtension(name);
	return extension === 'md' || extension === 'json' || extension === 'xml' || extension === 'txt';
}

export function newFileNameError(raw: string): string | null {
	const name = normalizeName(raw);
	if (!name) return 'Gib einen Namen ein.';
	const extension = fileExtension(name);
	if (!extension) return 'Der Name braucht eine Endung.';
	if (!SUPPORTED_EXTENSIONS.has(extension)) return 'Dieses Format wird nicht unterstützt.';
	return null;
}

export function codeLanguage(name: string): CodeLanguage {
	switch (fileExtension(name)) {
		case 'py':
		case 'pyw':
		case 'pyi':
			return 'python';
		case 'html':
		case 'htm':
			return 'html';
		case 'js':
			return 'javascript';
		case 'css':
			return 'css';
		case 'json':
			return 'json';
		case 'xml':
			return 'xml';
		case 'md':
			return 'markdown';
		default:
			return 'text';
	}
}

export function fileMime(name: string): string {
	switch (fileExtension(name)) {
		case 'html':
		case 'htm':
			return 'text/html';
		case 'css':
			return 'text/css';
		case 'js':
			return 'text/javascript';
		case 'json':
			return 'application/json';
		case 'xml':
			return 'application/xml';
		case 'md':
			return 'text/markdown';
		case 'py':
		case 'pyw':
		case 'pyi':
			return 'text/x-python';
		default:
			return 'text/plain';
	}
}

export const HTML_STARTER = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Seite</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; }
    h1 { color: #c45c26; }
  </style>
</head>
<body>
  <h1>Hallo</h1>
  <button id="knopf">Klick</button>
  <script>
    document.querySelector("#knopf").addEventListener("click", () => {
      document.querySelector("h1").textContent = "Geklickt";
      console.log("Geklickt");
    });
    console.log("Seite geladen");
  </script>
</body>
</html>
`;

export const WELCOME_LANGUAGES = [
	'python',
	'html',
	'css',
	'javascript',
	'json',
	'xml',
	'markdown',
	'text'
] as const;

export type WelcomeLanguage = (typeof WELCOME_LANGUAGES)[number];

export const WELCOME_FILES: Record<
	WelcomeLanguage,
	{ name: string; label: string; content: string }
> = {
	python: { name: 'main.py', label: 'Python', content: STARTER_CODE },
	html: { name: 'seite.html', label: 'HTML', content: HTML_STARTER },
	css: { name: 'style.css', label: 'CSS', content: 'body {\n    font-family: sans-serif;\n}\n' },
	javascript: { name: 'app.js', label: 'JavaScript', content: 'console.log("Hallo");\n' },
	json: { name: 'daten.json', label: 'JSON', content: '{\n    "name": "Welt"\n}\n' },
	xml: { name: 'daten.xml', label: 'XML', content: '<name>Welt</name>\n' },
	markdown: { name: 'notiz.md', label: 'Markdown', content: '# Hallo\n' },
	text: { name: 'notiz.txt', label: 'Text', content: 'Hallo\n' }
};

/** Replace the empty opening file with the language chosen in the welcome dialog. */
export function applyWelcomeChoice(
	snapshot: WorkspaceSnapshot,
	language: WelcomeLanguage
): WorkspaceSnapshot {
	const choice = WELCOME_FILES[language];
	const only = snapshot.files.length === 1 ? snapshot.files[0] : undefined;
	if (!only || only.content.trim()) return { ...snapshot, welcomed: true };
	const file: WorkspaceFile = {
		...only,
		name: choice.name,
		content: choice.content,
		updatedAt: Date.now()
	};
	return {
		...snapshot,
		welcomed: true,
		files: [file],
		openFileIds: [file.id],
		activeFileId: file.id,
		selectedFolderId: file.folderId
	};
}

export function uniqueName(existing: string[], requested: string): string {
	const key = (name: string) => name.toLocaleLowerCase('de');
	const taken = new Set(existing.map(key));
	if (!taken.has(key(requested))) return requested;
	const dot = requested.lastIndexOf('.');
	const stem = dot > 0 ? requested.slice(0, dot) : requested;
	const extension = dot > 0 ? requested.slice(dot) : '';
	const numbered = /^(.*) \((\d+)\)$/u.exec(stem);
	const base = numbered?.[1] ?? stem;
	let suffix = numbered ? Number(numbered[2]) + 1 : 2;
	while (taken.has(key(`${base} (${suffix})${extension}`))) suffix += 1;
	return `${base} (${suffix})${extension}`;
}

export function folderPath(folders: WorkspaceFolder[], folderId: string): string {
	const parts: string[] = [];
	const visited = new Set<string>();
	let current = folders.find((folder) => folder.id === folderId);
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		parts.unshift(current.name);
		current = current.parentId
			? folders.find((folder) => folder.id === current?.parentId)
			: undefined;
	}
	return parts.join('/');
}

export function projectDirectory(snapshot: WorkspaceSnapshot, folderId: string): string {
	const parts: string[] = [];
	const visited = new Set<string>();
	let current = snapshot.folders.find((folder) => folder.id === folderId);
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		if (current.parentId || current.id !== ROOT_FOLDER_ID) parts.unshift(current.name);
		current = current.parentId
			? snapshot.folders.find((folder) => folder.id === current?.parentId)
			: undefined;
	}
	return parts.join('/');
}

export function projectFilePath(snapshot: WorkspaceSnapshot, file: WorkspaceFile): string {
	const directory = projectDirectory(snapshot, file.folderId);
	return directory ? `${directory}/${file.name}` : file.name;
}

export function projectFiles(snapshot: WorkspaceSnapshot): { path: string; content: string }[] {
	return snapshot.files.map((file) => ({
		path: projectFilePath(snapshot, file),
		content: file.content
	}));
}

export function emptyCollaborationWorkspace(
	layout: WorkspaceSnapshot['layout']
): WorkspaceSnapshot {
	return {
		version: WORKSPACE_VERSION,
		folders: [{ id: ROOT_FOLDER_ID, name: 'Projekt', parentId: null }],
		files: [],
		openFileIds: [],
		activeFileId: '',
		selectedFolderId: ROOT_FOLDER_ID,
		layout,
		welcomed: true
	};
}

export function sanitizeWorkspace(value: WorkspaceSnapshot): WorkspaceSnapshot {
	const folders = value.folders?.length
		? value.folders
		: [{ id: ROOT_FOLDER_ID, name: 'Projekt', parentId: null }];
	const validFolderIds = new Set(folders.map((folder) => folder.id));
	const files = (value.files ?? []).filter((file) => validFolderIds.has(file.folderId));
	if (!files.length) return createInitialWorkspace();
	const validFileIds = new Set(files.map((file) => file.id));
	const openFileIds = (value.openFileIds ?? []).filter((id) => validFileIds.has(id));
	const activeFileId = openFileIds.includes(value.activeFileId)
		? value.activeFileId
		: (openFileIds[0] ?? '');
	return {
		version: WORKSPACE_VERSION,
		folders,
		files,
		openFileIds,
		activeFileId,
		selectedFolderId: validFolderIds.has(value.selectedFolderId)
			? value.selectedFolderId
			: folders[0].id,
		layout: {
			problemsOpen: Boolean(value.layout?.problemsOpen),
			problemsSize: Math.min(55, Math.max(20, value.layout?.problemsSize ?? 30)),
			terminalCollapsed: Boolean(value.layout?.terminalCollapsed)
		},
		welcomed: value.welcomed !== false
	};
}

export interface FolderRow {
	folder: WorkspaceFolder;
	depth: number;
}

export function structureSignature(snapshot: WorkspaceSnapshot): string {
	return JSON.stringify({
		folders: snapshot.folders.map(({ id, name, parentId }) => ({ id, name, parentId })),
		files: snapshot.files.map(({ id, name, folderId }) => ({ id, name, folderId }))
	});
}

export function contentSignature(snapshot: WorkspaceSnapshot): string {
	return JSON.stringify({
		folders: snapshot.folders.map(({ id, name, parentId }) => ({ id, name, parentId })),
		files: snapshot.files.map(({ id, name, folderId, content }) => ({
			id,
			name,
			folderId,
			content
		}))
	});
}

export function hasUnsavedChanges(
	snapshot: WorkspaceSnapshot,
	savedSignature: string,
	savedContents?: Record<string, string>
): boolean {
	if (!savedContents) return contentSignature(snapshot) !== savedSignature;
	if (structureSignature(snapshot) !== savedSignature) return true;
	if (snapshot.files.length !== Object.keys(savedContents).length) return true;
	return snapshot.files.some((file) => savedContents[file.id] !== file.content);
}

export function folderRows(folders: WorkspaceFolder[]): FolderRow[] {
	const rows: FolderRow[] = [];
	const seen = new Set<string>();
	const childrenOf = (parentId: string | null) =>
		folders
			.filter((folder) => folder.parentId === parentId)
			.sort((a, b) => a.name.localeCompare(b.name, 'de'));
	const walk = (folder: WorkspaceFolder, depth: number) => {
		if (seen.has(folder.id)) return;
		seen.add(folder.id);
		rows.push({ folder, depth });
		for (const child of childrenOf(folder.id)) walk(child, depth + 1);
	};
	for (const root of childrenOf(null)) walk(root, 0);
	return rows;
}

export function filesInFolder(snapshot: WorkspaceSnapshot, folderId: string): WorkspaceFile[] {
	return snapshot.files
		.filter((file) => file.folderId === folderId)
		.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function siblingFolderNames(
	snapshot: WorkspaceSnapshot,
	parentId: string | null,
	exceptId?: string
): string[] {
	return snapshot.folders
		.filter((folder) => folder.parentId === parentId && folder.id !== exceptId)
		.map((folder) => folder.name);
}

function siblingFileNames(
	snapshot: WorkspaceSnapshot,
	folderId: string,
	exceptId?: string
): string[] {
	return snapshot.files
		.filter((file) => file.folderId === folderId && file.id !== exceptId)
		.map((file) => file.name);
}

export function acceptedFileName(value: string): string | null {
	const normalized = normalizeName(value);
	if (!normalized || normalized === '.' || normalized === '..') return null;
	if (newFileNameError(normalized)) return null;
	return normalized;
}

export function updateFileContent(
	snapshot: WorkspaceSnapshot,
	fileId: string,
	content: string
): WorkspaceSnapshot {
	const current = snapshot.files.find((file) => file.id === fileId);
	if (!current || current.content === content) return snapshot;
	return {
		...snapshot,
		files: snapshot.files.map((file) =>
			file.id === fileId ? { ...file, content, updatedAt: Date.now() } : file
		)
	};
}

export function selectFolder(snapshot: WorkspaceSnapshot, folderId: string): WorkspaceSnapshot {
	if (
		snapshot.selectedFolderId === folderId ||
		!snapshot.folders.some((folder) => folder.id === folderId)
	) {
		return snapshot;
	}
	return { ...snapshot, selectedFolderId: folderId };
}

export function openFile(snapshot: WorkspaceSnapshot, fileId: string): WorkspaceSnapshot {
	const file = snapshot.files.find((item) => item.id === fileId);
	if (!file) return snapshot;
	const alreadyOpen = snapshot.openFileIds.includes(fileId);
	if (
		alreadyOpen &&
		snapshot.activeFileId === fileId &&
		snapshot.selectedFolderId === file.folderId
	) {
		return snapshot;
	}
	return {
		...snapshot,
		openFileIds: alreadyOpen ? snapshot.openFileIds : [...snapshot.openFileIds, fileId],
		activeFileId: fileId,
		selectedFolderId: file.folderId
	};
}

export function closeFile(snapshot: WorkspaceSnapshot, fileId: string): WorkspaceSnapshot {
	if (!snapshot.openFileIds.includes(fileId)) return snapshot;
	const index = snapshot.openFileIds.indexOf(fileId);
	const openFileIds = snapshot.openFileIds.filter((id) => id !== fileId);
	const activeFileId =
		snapshot.activeFileId === fileId
			? (openFileIds[Math.max(0, index - 1)] ?? '')
			: snapshot.activeFileId;
	return { ...snapshot, openFileIds, activeFileId };
}

export function createFolder(
	snapshot: WorkspaceSnapshot,
	parentId: string | null,
	rawName: string
): WorkspaceSnapshot {
	if (parentId !== null && !snapshot.folders.some((folder) => folder.id === parentId))
		return snapshot;
	const name = uniqueName(
		siblingFolderNames(snapshot, parentId),
		normalizeName(rawName) || 'Ordner'
	);
	const folder: WorkspaceFolder = { id: createId('folder'), name, parentId };
	return { ...snapshot, folders: [...snapshot.folders, folder], selectedFolderId: folder.id };
}

export function importFiles(
	snapshot: WorkspaceSnapshot,
	folderId: string,
	incoming: { name: string; content: string }[]
): WorkspaceSnapshot {
	if (!incoming.length || !snapshot.folders.some((folder) => folder.id === folderId))
		return snapshot;
	let next = snapshot;
	let lastId = '';
	for (const item of incoming) {
		const requested = acceptedFileName(item.name);
		if (!requested) continue;
		const name = uniqueName(siblingFileNames(next, folderId), requested);
		const file: WorkspaceFile = {
			id: createId('file'),
			name,
			folderId,
			content: item.content,
			updatedAt: Date.now()
		};
		next = { ...next, files: [...next.files, file], selectedFolderId: folderId };
		lastId = file.id;
	}
	return openFile(next, lastId);
}

export function createFile(
	snapshot: WorkspaceSnapshot,
	folderId: string,
	rawName: string,
	content = ''
): WorkspaceSnapshot {
	if (!snapshot.folders.some((folder) => folder.id === folderId)) return snapshot;
	const requested = acceptedFileName(rawName);
	if (!requested) return snapshot;
	const name = uniqueName(siblingFileNames(snapshot, folderId), requested);
	const file: WorkspaceFile = {
		id: createId('file'),
		name,
		folderId,
		content,
		updatedAt: Date.now()
	};
	return openFile(
		{ ...snapshot, files: [...snapshot.files, file], selectedFolderId: folderId },
		file.id
	);
}

export function renameFolder(
	snapshot: WorkspaceSnapshot,
	folderId: string,
	rawName: string
): WorkspaceSnapshot {
	const folder = snapshot.folders.find((item) => item.id === folderId);
	if (!folder) return snapshot;
	const name = uniqueName(
		siblingFolderNames(snapshot, folder.parentId, folderId),
		normalizeName(rawName) || folder.name
	);
	if (name === folder.name) return snapshot;
	return {
		...snapshot,
		folders: snapshot.folders.map((item) => (item.id === folderId ? { ...item, name } : item))
	};
}

export function moveFileToFolder(
	snapshot: WorkspaceSnapshot,
	fileId: string,
	folderId: string
): WorkspaceSnapshot {
	const file = snapshot.files.find((item) => item.id === fileId);
	if (!file || !snapshot.folders.some((folder) => folder.id === folderId)) return snapshot;
	if (file.folderId === folderId) {
		if (snapshot.selectedFolderId === folderId && snapshot.activeFileId === fileId) return snapshot;
		return { ...snapshot, selectedFolderId: folderId, activeFileId: fileId };
	}
	const taken = siblingFileNames(snapshot, folderId).some(
		(name) => name.toLocaleLowerCase('de') === file.name.toLocaleLowerCase('de')
	);
	if (taken) return snapshot;
	return {
		...snapshot,
		files: snapshot.files.map((item) =>
			item.id === fileId ? { ...item, folderId, updatedAt: Date.now() } : item
		),
		selectedFolderId: folderId,
		activeFileId: fileId
	};
}

export function renameFile(
	snapshot: WorkspaceSnapshot,
	fileId: string,
	rawName: string
): WorkspaceSnapshot {
	const file = snapshot.files.find((item) => item.id === fileId);
	if (!file) return snapshot;
	const requested = acceptedFileName(rawName);
	if (!requested) return snapshot;
	const name = uniqueName(siblingFileNames(snapshot, file.folderId, fileId), requested);
	if (name === file.name) return snapshot;
	return {
		...snapshot,
		files: snapshot.files.map((item) =>
			item.id === fileId ? { ...item, name, updatedAt: Date.now() } : item
		)
	};
}

export function deleteFile(snapshot: WorkspaceSnapshot, fileId: string): WorkspaceSnapshot {
	if (snapshot.files.length <= 1 || !snapshot.files.some((file) => file.id === fileId))
		return snapshot;
	const files = snapshot.files.filter((file) => file.id !== fileId);
	const index = snapshot.openFileIds.indexOf(fileId);
	const openFileIds = snapshot.openFileIds.filter((id) => id !== fileId);
	let activeFileId = snapshot.activeFileId;
	if (activeFileId === fileId || !files.some((file) => file.id === activeFileId)) {
		activeFileId = openFileIds[Math.max(0, index - 1)] ?? '';
	}
	return { ...snapshot, files, openFileIds, activeFileId };
}

export function deleteFolder(snapshot: WorkspaceSnapshot, folderId: string): WorkspaceSnapshot {
	if (folderId === ROOT_FOLDER_ID) return snapshot;
	const folder = snapshot.folders.find((item) => item.id === folderId);
	if (!folder) return snapshot;
	const removeIds = new Set<string>();
	const collect = (id: string) => {
		if (removeIds.has(id)) return;
		removeIds.add(id);
		for (const item of snapshot.folders) {
			if (item.parentId === id) collect(item.id);
		}
	};
	collect(folderId);
	const files = snapshot.files.filter((file) => !removeIds.has(file.folderId));
	if (!files.length) return snapshot;
	const folders = snapshot.folders.filter((item) => !removeIds.has(item.id));
	const removedFileIds = new Set(
		snapshot.files.filter((file) => removeIds.has(file.folderId)).map((file) => file.id)
	);
	const openFileIds = snapshot.openFileIds.filter((id) => !removedFileIds.has(id));
	let activeFileId = removedFileIds.has(snapshot.activeFileId) ? '' : snapshot.activeFileId;
	if (!openFileIds.includes(activeFileId)) activeFileId = openFileIds[0] ?? '';
	const selectedFolderId = removeIds.has(snapshot.selectedFolderId)
		? (folder.parentId ?? ROOT_FOLDER_ID)
		: snapshot.selectedFolderId;
	return { ...snapshot, folders, files, openFileIds, activeFileId, selectedFolderId };
}
