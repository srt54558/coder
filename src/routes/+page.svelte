<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Download from '@lucide/svelte/icons/download';
	import Files from '@lucide/svelte/icons/files';
	import Blocks from '@lucide/svelte/icons/blocks';
	import Flower2 from '@lucide/svelte/icons/flower-2';
	import Info from '@lucide/svelte/icons/info';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Moon from '@lucide/svelte/icons/moon';
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Save from '@lucide/svelte/icons/save';
	import Book from '@lucide/svelte/icons/book';
	import Settings from '@lucide/svelte/icons/settings';
	import Share2 from '@lucide/svelte/icons/share-2';
	import Square from '@lucide/svelte/icons/square';
	import Sun from '@lucide/svelte/icons/sun';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import X from '@lucide/svelte/icons/x';
	import FilesExplorer from '#lib/components/files-explorer.svelte';
	import SaveAsDialog from '#lib/components/save-as-dialog.svelte';
	import NewFileDialog from '#lib/components/new-file-dialog.svelte';
	import WelcomeDialog from '#lib/components/welcome-dialog.svelte';
	import CodeEditor from '#lib/components/code-editor.svelte';
	import ProgramVisualizer from '#lib/components/program-visualizer.svelte';
	import { takeDocsPopup } from '#lib/docs/popup.js';
	import { languageForLessonId } from '#lib/docs/lookup.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
	import * as Resizable from '#lib/components/ui/resizable/index.js';
	import type { RuffDiagnostic, RuffWorkerMessage, RunnerStatus } from '#lib/runner/protocol.js';
	import { lineExcerpt } from '#lib/editor/explain.js';
	import {
		editorLineForPreview,
		previewDocument,
		previewFileFromUrl,
		readPreviewDone,
		readPreviewMessage,
		readPreviewRequest,
		scriptDocument,
		scriptLineOffset
	} from '#lib/editor/preview.js';
	import { resolveProjectPath } from '#lib/editor/links.js';
	import { consoleSegments, matchProblem } from '#lib/runner/console-links.js';
	import { clipBlocks, clipText } from '#lib/runner/limits.js';
	import {
		disposePython,
		holdPython,
		runPython,
		submitPythonInput,
		stopPython,
		watchPythonHost
	} from '#lib/runner/python-host.js';
	import { canShareCode, createShareUrl, decodeCode, IMPORT_PARAM } from '#lib/runner/share.js';
	import * as Y from 'yjs';
	import {
		COLLABORATION_RELAY_URL,
		MAX_COLLABORATION_BYTES,
		applyRemoteUpdate,
		collaborationRoomIdFromCode,
		createGroupKey,
		createOpaqueHost,
		createOpaqueServerLogin,
		decodeBase64,
		decryptPayload,
		derivePairwiseKey,
		destroySharedWorkspace,
		encryptPayload,
		encodeBase64,
		finishOpaqueClientLogin,
		finishOpaqueServerLogin,
		fullWorkspaceUpdate,
		generateGermanPassphrase,
		importGroupKey,
		isRemoteUpdateOrigin,
		mergeUpdates,
		normalizeCollaborationCode,
		seedSharedWorkspace,
		snapshotFromSharedWorkspace,
		startOpaqueClientLogin,
		syncSharedWorkspace,
		type EncryptedPayload,
		type OpaqueClientState,
		type OpaqueHostState
	} from '#lib/workspace/collaboration.js';
	import {
		clearWebDavCredentials,
		CODER_FOLDER_NAME,
		createWebDavFile,
		createWebDavFolder,
		coderProjectPath,
		connectWebDav,
		emptyWebDavTree,
		hasSessionWebDavCredentials,
		listWebDavProjectTree,
		loadWebDavCredentials,
		readWebDavFile,
		rememberWebDavCredentials,
		saveWebDavSyncState,
		webDavRelativeDir,
		WebDavError,
		writeWebDavProjectFile,
		type WebDavConnection,
		type WebDavCredentials,
		type WebDavTree
	} from '#lib/workspace/webdav.js';
	import {
		acceptedFileName,
		closeFile,
		applyWelcomeChoice,
		createFile,
		createInitialWorkspace,
		codeLanguage,
		emptyCollaborationWorkspace,
		fileMime,
		importFiles,
		isHtmlFile,
		isPythonFile,
		newFileNameError,
		openFile,
		projectDirectory,
		projectFilePath,
		projectFiles,
		renameFile,
		ROOT_FOLDER_ID,
		selectFolder,
		updateFileContent,
		type WelcomeLanguage,
		type WorkspaceFile,
		type WorkspaceSnapshot
	} from '#lib/workspace/model.js';
	import {
		loadSession,
		saveSession,
		sessionFromWorkspace,
		writeSessionBackup,
		type EditorSession
	} from '#lib/workspace/session.js';
	import { applyDocumentTheme, isDarkTheme, parseTheme, type AppTheme } from '#lib/theme.js';

	const RUN_TIMEOUT_MS = 15_000;
	const SAVE_DELAY_MS = 250;
	const LOCAL_ONLY_KEY = 'kplus-coder-local-only';
	const SHARED_PREVIEW_ID = 'shared-preview';

	let workspace = $state(createInitialWorkspace());
	let hydrated = $state(false);
	type ConsoleBlock = {
		id: number;
		fileId: string;
		runId: number | null;
		kind: 'note' | 'run' | 'preview';
		title: string;
		filename: string;
		stdout: string;
		stderr: string;
		status: string;
		finishedAt: string;
		failed: boolean;
		line: number | null;
		column: number | null;
	};

	function clockTime(date = new Date()) {
		const pad = (value: number) => String(value).padStart(2, '0');
		return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	}

	let consoleSeq = 1;
	let consoleBlocks = $state<ConsoleBlock[]>([]);
	let visualizerEnabled = $state(false);
	let visualizerOutputs = $state<Record<number, string>>({});
	let pendingPythonInput = $state<number | null>(null);
	let pythonInputValue = $state('');
	let pythonInputElement = $state<HTMLInputElement | null>(null);
	let runningPythonRunId = $state<number | null>(null);
	let runningPythonFileId = $state('');
	let runnerStatus = $state<RunnerStatus>('ready');
	let pythonVersion = $state<string>();
	let versionsOpen = $state(false);
	let settingsOpen = $state(false);
	let docsOpen = $state(false);
	let docsFocusId = $state('');
	let diagnostics = $state<RuffDiagnostic[]>([]);
	let lintError = $state<string>();
	let notice = $state('');
	let theme = $state<AppTheme>('light');
	let clearOpen = $state(false);
	let filesOpen = $state(false);
	type SyncStatus = 'local' | 'connecting' | 'syncing' | 'synced' | 'error';
	let syncStatus = $state<SyncStatus>('local');
	let syncError = $state('');
	let webdavCredentials = $state<WebDavCredentials | null>(null);
	let webdavConnection = $state<WebDavConnection | null>(null);
	let filesAfterLogin = $state(false);
	let saveAfterLogin = $state(false);
	let loginOpen = $state(false);
	let loginUsername = $state('');
	let loginPassword = $state('');
	let loginStay = $state(true);
	let persistentCredentialStorage = $state(false);
	let loginBusy = $state(false);
	let loginError = $state('');
	let webdavRemembered = $state(false);
	let explorerToken = $state(0);
	let sharedCode = $state<string | null>(null);
	let viewingShare = $state(false);
	let saveAsOpen = $state(false);
	let saveAsToken = $state(0);
	let wwschoolSaveBusy = $state(false);
	let remoteTree = $state<WebDavTree | null>(null);
	let remoteSelectedId = $state('');
	let publishedContents = $state<Record<string, string>>({});
	let remotePaths = $state<Record<string, string>>({});
	let publishedShare = $state<string | null>(null);
	let pane = $state<'code' | 'problems'>('code');
	let terminalCollapsed = $state(false);
	let previewConsoleOpen = $state(false);
	let previewDoc = $state('');
	let previewNonce = $state(0);
	let previewToken = 0;
	let scriptDoc = $state('');
	let scriptRunning = $state(false);
	let scriptToken = 0;
	let scriptFileId = '';
	let scriptName = '';
	let scriptLineOffsetLines = 0;
	let scriptLogged = false;
	let scriptTimer: ReturnType<typeof setTimeout> | undefined;
	let narrow = $state(false);
	let consoleViewport = $state<HTMLElement | null>(null);
	let canUndo = $state(false);
	let canRedo = $state(false);
	let collaborationFileIds = $state<string[]>([]);
	let collaborationConnected = $state(false);
	let collaborationOpen = $state(false);
	let collaborationRole = $state<'host' | 'guest' | null>(null);
	let collaborationRoomId = $state('');
	let collaborationPassphrase = $state('');
	let collaborationJoinCode = $state('');
	let collaborationBusy = $state(false);
	let collaborationError = $state('');
	let localUnsavedIds = $state(new Set<string>());
	let pendingCloseTabId = $state<string | null>(null);
	let pendingCloseShare = $state(false);
	let saveTicket = 0;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveQueue = Promise.resolve();
	let saveErrorAnnounced = false;
	let parkedLocal: EditorSession | null = null;
	let collaborationDoc = $state<Y.Doc | null>(null);
	let collaborationRevision = $state(0);
	let collaborationSocket: WebSocket | undefined;
	let collaborationSendTimer: ReturnType<typeof setTimeout> | undefined;
	let collaborationPendingUpdates: Uint8Array[] = [];
	let collaborationDocListener: ((update: Uint8Array, origin: unknown) => void) | undefined;
	let collaborationHostState: OpaqueHostState | null = null;
	let collaborationClientState: OpaqueClientState | null = null;
	let collaborationPairwiseKey: CryptoKey | null = null;
	let collaborationGroupBytes: Uint8Array | null = null;
	let collaborationGroupKey: CryptoKey | null = null;
	let collaborationPeerId = '';
	let collaborationHostPeerId = '';
	let collaborationPendingHostSnapshot: WorkspaceSnapshot | null = null;
	let collaborationPendingRoomId = '';
	let collaborationStateTimer: ReturnType<typeof setTimeout> | undefined;
	let codeEditor = $state<{
		undoEdit: () => void;
		redoEdit: () => void;
		focusEditor: () => void;
		showDiagnostic: (row: number, column: number, endRow: number, endColumn: number) => void;
	} | null>(null);

	let ruffWorker: Worker | undefined;
	let runId = 0;
	let lintId = 0;
	let lintTimer: ReturnType<typeof setTimeout> | undefined;
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let runFileId = '';
	let lintedFileId = '';
	let createOpen = $state(false);

	const activeFile = $derived.by(() => {
		if (!workspace.openFileIds.includes(workspace.activeFileId)) return undefined;
		return workspace.files.find((file) => file.id === workspace.activeFileId);
	});
	const fileCode = $derived(activeFile?.content ?? '');
	const editorCode = $derived(viewingShare && sharedCode !== null ? sharedCode : fileCode);
	const editorFileId = $derived(viewingShare ? SHARED_PREVIEW_ID : (activeFile?.id ?? ''));
	const editorSharedText = $derived(
		collaborationDoc && activeFile ? collaborationDoc.getText(`content:${activeFile.id}`) : null
	);
	const editorEmpty = $derived(!activeFile && !(viewingShare && sharedCode !== null));
	const editorName = $derived(viewingShare ? 'geteilt.py' : (activeFile?.name ?? ''));
	const isHtml = $derived(isHtmlFile(editorName));
	const isMarkdown = $derived(codeLanguage(editorName) === 'markdown');
	const isJavaScript = $derived(codeLanguage(editorName) === 'javascript');
	const isPython = $derived(isPythonFile(editorName));
	const docsLanguage = $derived(
		(docsFocusId ? languageForLessonId(docsFocusId) : null) ?? codeLanguage(editorName)
	);
	const showsPreview = $derived(isHtml || isMarkdown);
	const showsOutput = $derived(isPython || isJavaScript);
	const showsPane = $derived(showsPreview || showsOutput);
	const previewTarget = $derived.by(() => {
		if (!showsPreview) return null;
		return workspace.files.find((item) => item.id === editorFileId) ?? null;
	});
	const previewing = $derived(previewTarget !== null);
	const openFiles = $derived(
		workspace.openFileIds
			.map((id) => workspace.files.find((file) => file.id === id))
			.filter((file): file is WorkspaceFile => Boolean(file))
	);
	const consoleFileId = $derived(runningPythonFileId || previewTarget?.id || editorFileId);
	const fileConsole = $derived(consoleBlocks.filter((block) => block.fileId === consoleFileId));
	const isRunning = $derived(runnerStatus === 'running');
	const pythonLoading = $derived(isPython && runnerStatus === 'loading');
	const stopping = $derived((isJavaScript && scriptRunning) || (!showsPreview && isRunning));
	const shareDirty = $derived(sharedCode !== null && sharedCode !== publishedShare);
	const dirtyFileIds = $derived(
		new Set(
			workspace.files
				.filter(
					(file) =>
						localUnsavedIds.has(file.id) ||
						(publishedContents[file.id] === undefined
							? Boolean(file.content)
							: publishedContents[file.id] !== file.content)
				)
				.map((file) => file.id)
		)
	);
	const dirty = $derived(hydrated && (shareDirty || dirtyFileIds.size > 0));
	const saveTree = $derived(
		remoteTree ??
			(webdavConnection ? emptyWebDavTree(webdavConnection) : { folders: [], files: [] })
	);
	const pythonStatus = $derived.by(() => {
		if (runnerStatus === 'loading') return 'wird geladen';
		if (runnerStatus === 'error') return 'nicht verfügbar';
		return pythonVersion ?? 'bereit';
	});

	function commitConsole(blocks: ConsoleBlock[]) {
		consoleBlocks = clipBlocks(blocks);
	}

	function clearSharedImportUrl() {
		const url = new SvelteURL(window.location.href);
		if (!url.searchParams.has(IMPORT_PARAM) && !url.hash) return;
		url.searchParams.delete(IMPORT_PARAM);
		url.hash = '';
		history.replaceState(null, '', `${url.pathname}${url.search}`);
	}

	function announce(message: string) {
		notice = message;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), 3_000);
	}

	function pushNote(block: string, failed = false, fileId = runFileId || editorFileId) {
		const text = block.replace(/\s+$/u, '');
		if (!text || !fileId) return;
		commitConsole([
			...consoleBlocks,
			{
				id: ++consoleSeq,
				fileId,
				runId: null,
				kind: 'note',
				title: text,
				filename: '',
				stdout: '',
				stderr: '',
				status: '',
				finishedAt: '',
				failed,
				line: null,
				column: null
			}
		]);
		scrollConsoleToEnd();
	}

	function beginRun(id: number, filename: string, fileId: string) {
		commitConsole([
			...consoleBlocks,
			{
				id: ++consoleSeq,
				fileId,
				runId: id,
				kind: 'run',
				title: `$ python3 ${filename}`,
				filename,
				stdout: '',
				stderr: '',
				status: '',
				finishedAt: '',
				failed: false,
				line: null,
				column: null
			}
		]);
		scrollConsoleToEnd();
	}

	function finishRun(
		id: number,
		patch: Pick<ConsoleBlock, 'stdout' | 'stderr' | 'status' | 'failed'>
	) {
		let updated = false;
		const finishedAt = clockTime();
		commitConsole(
			consoleBlocks.map((block) => {
				if (block.runId !== id || block.status) return block;
				updated = true;
				return {
					...block,
					...patch,
					stdout: clipText(patch.stdout),
					stderr: clipText(patch.stderr),
					finishedAt
				};
			})
		);
		if (updated) scrollConsoleToEnd();
		return updated;
	}

	function requestPythonInput(id: number) {
		pendingPythonInput = id;
		pythonInputValue = '';
		scrollConsoleToEnd();
		void tick().then(() => pythonInputElement?.focus());
	}

	function submitConsoleInput(event: SubmitEvent) {
		event.preventDefault();
		if (pendingPythonInput === null) return;
		if (!submitPythonInput(pythonInputValue)) {
			announce('Eingabe zu lang. Bitte auf maximal 64 KB kürzen.');
			return;
		}
		pendingPythonInput = null;
		pythonInputValue = '';
	}

	function scrollConsoleToEnd() {
		const pin = () => {
			if (!consoleViewport) return;
			consoleViewport.scrollTop = consoleViewport.scrollHeight;
		};
		void tick().then(() => {
			pin();
			requestAnimationFrame(() => {
				pin();
				requestAnimationFrame(pin);
			});
		});
	}

	function clearConsole() {
		if (pendingPythonInput !== null) {
			announce('Bitte erst die Eingabe senden oder die Ausführung stoppen.');
			return;
		}
		const fileId = consoleFileId;
		commitConsole(consoleBlocks.filter((block) => block.fileId !== fileId));
	}

	function dismissConsole(id: number) {
		commitConsole(consoleBlocks.filter((block) => block.id !== id));
	}

	function markFilePublished(fileId: string, content: string, path?: string) {
		const next = { ...publishedContents, [fileId]: content };
		publishedContents = next;
		localUnsavedIds = new Set([...localUnsavedIds].filter((id) => id !== fileId));
		if (path) remotePaths = { ...remotePaths, [fileId]: path };
	}

	async function startWebDavSession(
		credentials: WebDavCredentials,
		options: { store: 'persistent' | 'session' | 'keep' }
	) {
		syncStatus = 'connecting';
		syncError = '';
		loginUsername = credentials.username;
		const connection = await connectWebDav(credentials);
		if (options.store === 'persistent' || options.store === 'session') {
			await rememberWebDavCredentials(credentials, options.store === 'persistent');
			webdavRemembered = options.store === 'persistent';
		}
		webdavCredentials = credentials;
		webdavConnection = connection;
		await saveWebDavSyncState(connection);
		syncStatus = 'synced';
		writeLocalOnly(false);
		try {
			await refreshRemoteTree();
		} catch (error) {
			announce(
				error instanceof Error ? error.message : 'Die Dateiablage konnte nicht gelesen werden.'
			);
		}
		const shouldSave = saveAfterLogin;
		const shouldFiles = filesAfterLogin;
		saveAfterLogin = false;
		filesAfterLogin = false;
		loginOpen = false;
		loginPassword = '';
		if (shouldSave) {
			await tick();
			openSaveDialog();
		} else if (shouldFiles) {
			showFilesManager();
		}
	}

	function readLocalOnly(): boolean {
		try {
			return sessionStorage.getItem(LOCAL_ONLY_KEY) === 'true';
		} catch {
			return false;
		}
	}

	function writeLocalOnly(value: boolean) {
		try {
			if (value) sessionStorage.setItem(LOCAL_ONLY_KEY, 'true');
			else sessionStorage.removeItem(LOCAL_ONLY_KEY);
		} catch {
			// Ohne Sitzungsspeicher bleibt die lokale Entscheidung nur im Speicher.
		}
	}

	function continueLocally() {
		if (saveAfterLogin) return;
		writeLocalOnly(true);
		loginPassword = '';
		loginError = '';
		if (filesAfterLogin) showFilesManager();
		filesAfterLogin = false;
		loginOpen = false;
	}

	async function submitWebDavLogin(event: SubmitEvent) {
		event.preventDefault();
		if (loginBusy) return;
		const credentials = { username: loginUsername.trim(), password: loginPassword };
		if (!credentials.username || !credentials.password) {
			loginError = 'Gib deine wwschool-E-Mail-Adresse und dein Passwort ein.';
			return;
		}
		loginBusy = true;
		loginError = '';
		try {
			await startWebDavSession(credentials, {
				store: loginStay ? 'persistent' : 'session'
			});
			announce(
				loginStay
					? `Mit wwschool verbunden. Ordner ${CODER_FOLDER_NAME} ist bereit.`
					: `Mit wwschool verbunden. Die Anmeldung gilt nur für diese Sitzung.`
			);
		} catch (error) {
			loginError = error instanceof Error ? error.message : 'Die Anmeldung ist fehlgeschlagen.';
			syncStatus = 'error';
		} finally {
			loginPassword = '';
			loginBusy = false;
		}
	}

	function openLogin() {
		settingsOpen = false;
		filesAfterLogin = false;
		saveAfterLogin = false;
		loginError = syncError;
		loginOpen = true;
	}

	async function logoutWebDav() {
		settingsOpen = false;
		await clearWebDavCredentials();
		webdavCredentials = null;
		webdavConnection = null;
		webdavRemembered = false;
		remoteTree = null;
		saveAsOpen = false;
		syncStatus = 'local';
		syncError = '';
		loginOpen = false;
		loginPassword = '';
		announce('Von wwschool abgemeldet');
	}

	async function reconnectWebDav() {
		if (loginBusy || !webdavCredentials) return;
		loginBusy = true;
		loginError = '';
		try {
			await startWebDavSession(webdavCredentials, { store: 'keep' });
		} catch (error) {
			loginError = error instanceof Error ? error.message : 'Die Anmeldung ist fehlgeschlagen.';
			syncError = loginError;
			syncStatus = 'error';
			announce(syncError);
		} finally {
			loginBusy = false;
		}
	}

	function captureSession(): EditorSession {
		return sessionFromWorkspace($state.snapshot(workspace) as WorkspaceSnapshot, {
			publishedContents: { ...publishedContents },
			localUnsavedIds: [...localUnsavedIds],
			remotePaths: { ...remotePaths }
		});
	}

	function applySession(session: EditorSession) {
		workspace = session.workspace;
		publishedContents = { ...session.publishedContents };
		localUnsavedIds = new Set(session.localUnsavedIds);
		remotePaths = { ...session.remotePaths };
	}

	function enqueueSessionSave(session: EditorSession, ticket: number, savedAt: number) {
		const job = saveQueue.then(async () => {
			if (ticket !== saveTicket || collaborationRole === 'guest') return;
			try {
				await saveSession(session, savedAt);
				saveErrorAnnounced = false;
			} catch {
				if (ticket === saveTicket && !saveErrorAnnounced) {
					saveErrorAnnounced = true;
					announce('Der Editorstand konnte nicht gespeichert werden.');
				}
			}
		});
		saveQueue = job.then(
			() => undefined,
			() => undefined
		);
	}

	function flushEditorSession() {
		if (!hydrated || collaborationRole === 'guest') return;
		if (saveTimer) clearTimeout(saveTimer);
		const session = captureSession();
		const ticket = ++saveTicket;
		const savedAt = writeSessionBackup(session);
		enqueueSessionSave(session, ticket, savedAt);
	}

	function parkLocalWorkspace() {
		flushEditorSession();
		parkedLocal = captureSession();
	}

	function restoreParkedWorkspace() {
		if (!parkedLocal) return;
		applySession(parkedLocal);
		parkedLocal = null;
	}

	function openCollaborationFile(snapshot: WorkspaceSnapshot) {
		if (snapshot.openFileIds.length) {
			const active = snapshot.openFileIds.includes(snapshot.activeFileId)
				? snapshot.activeFileId
				: snapshot.openFileIds[0];
			return active ? openFile(snapshot, active) : snapshot;
		}
		const first = snapshot.files[0];
		return first ? openFile(snapshot, first.id) : snapshot;
	}

	function editActiveFile(value: string) {
		if (viewingShare && sharedCode !== null) {
			if (value === sharedCode) return;
			sharedCode = value;
			return;
		}
		if (editorEmpty) return;
		const next = updateFileContent(workspace, workspace.activeFileId, value);
		if (next === workspace) return;
		workspace = next;
	}

	function applyWorkspace(next: WorkspaceSnapshot) {
		const activeChanged = next.activeFileId !== workspace.activeFileId;
		workspace = next;
		if (activeChanged) pane = 'code';
	}

	function applyExplorer(next: WorkspaceSnapshot) {
		if (webdavConnection) {
			remoteSelectedId = next.selectedFolderId;
			return;
		}
		const previousIds = new Set(workspace.files.map((file) => file.id));
		const createdIds = next.files
			.filter((file) => !previousIds.has(file.id))
			.map((file) => file.id);
		if (createdIds.length) localUnsavedIds = new Set([...localUnsavedIds, ...createdIds]);
		applyWorkspace(next);
	}

	function showShare() {
		if (sharedCode === null) return;
		viewingShare = true;
		pane = 'code';
		void tick().then(() => codeEditor?.focusEditor());
	}

	function discardShare() {
		sharedCode = null;
		viewingShare = false;
		publishedShare = null;
		pendingCloseShare = false;
		clearSharedImportUrl();
	}

	function requestCloseShare() {
		if (shareDirty) {
			pendingCloseShare = true;
			pendingCloseTabId = null;
			return;
		}
		discardShare();
	}

	function showFile(fileId: string) {
		viewingShare = false;
		applyWorkspace(openFile(workspace, fileId));
		pane = 'code';
		void tick().then(() => codeEditor?.focusEditor());
	}

	function closeTab(fileId: string) {
		applyWorkspace(closeFile(workspace, fileId));
		pendingCloseTabId = null;
	}

	function requestCloseTab(fileId: string) {
		if (dirtyFileIds.has(fileId)) {
			pendingCloseTabId = fileId;
			pendingCloseShare = false;
			return;
		}
		closeTab(fileId);
	}

	function confirmClosePendingTab() {
		if (pendingCloseShare) {
			discardShare();
			return;
		}
		if (pendingCloseTabId) closeTab(pendingCloseTabId);
	}

	function createNamedFile(name: string) {
		const folderId = activeFile?.folderId ?? workspace.selectedFolderId ?? ROOT_FOLDER_ID;
		const next = createFile(workspace, folderId, name);
		const created = next.files.find((file) => !workspace.files.some((item) => item.id === file.id));
		if (created) localUnsavedIds = new Set([...localUnsavedIds, created.id]);
		applyWorkspace(next);
		pane = 'code';
		if (isHtmlFile(name) || codeLanguage(name) === 'markdown') previewConsoleOpen = false;
		void tick().then(() => codeEditor?.focusEditor());
	}

	function linkedProjectFiles() {
		const files = projectFiles(workspace);
		if (!activeFile || viewingShare) return files;
		const activePath = projectFilePath(workspace, activeFile);
		return files.map((file) =>
			file.path === activePath ? { path: file.path, content: editorCode } : file
		);
	}

	function runPayload() {
		if (viewingShare || !activeFile) {
			return {
				filename: editorName,
				files: [{ path: editorName, content: editorCode }]
			};
		}
		const filename = projectFilePath(workspace, activeFile);
		const files = linkedProjectFiles();
		if (!files.some((file) => file.path === filename))
			files.push({ path: filename, content: editorCode });
		return { filename, files };
	}

	function openDocs(lessonId = '') {
		docsFocusId = lessonId;
		docsOpen = true;
	}

	function openVersions() {
		settingsOpen = false;
		versionsOpen = true;
	}

	function toggleProblems() {
		pane = pane === 'problems' ? 'code' : 'problems';
	}

	function revealConsoleLine(block: ConsoleBlock) {
		const where = consoleWhere(block);
		if (block.line != null && block.filename) {
			const column = block.column ?? 1;
			const key = block.filename.toLocaleLowerCase('de');
			const match = workspace.files.find((file) => {
				const path = projectFilePath(workspace, file).toLocaleLowerCase('de');
				return path === key || file.name.toLocaleLowerCase('de') === key;
			});
			if (match && match.id !== workspace.activeFileId) {
				const row = block.line;
				showFile(match.id);
				void tick().then(() => codeEditor?.showDiagnostic(row, column, row, column + 1));
				return;
			}
			if (!where) {
				codeEditor?.showDiagnostic(block.line, column, block.line, column + 1);
				return;
			}
		}
		if (where) showLinkedProblem(where);
	}

	function showLinkedProblem(diagnostic: RuffDiagnostic) {
		pane = 'code';
		const start = diagnostic.start_location;
		const end = diagnostic.end_location;
		void tick().then(() =>
			codeEditor?.showDiagnostic(start.row, start.column, end.row, end.column)
		);
	}

	function consoleWhere(block: ConsoleBlock): RuffDiagnostic | null {
		if (!block.stderr || !block.filename || block.filename !== editorName) return null;
		const matches = consoleSegments(block.stderr, block.filename).flatMap((segment) => {
			if (segment.line === null) return [];
			const diagnostic = matchProblem(diagnostics, segment.line, segment.column, segment.endColumn);
			return diagnostic ? [diagnostic] : [];
		});
		if (matches.length > 0) return matches.at(-1) ?? null;
		if (block.line == null) return null;
		const column = block.column ?? 1;
		return (
			matchProblem(
				diagnostics,
				block.line,
				block.column,
				block.column == null ? null : column + 1
			) ?? {
				code: null,
				message: block.stderr,
				start_location: { row: block.line, column },
				end_location: { row: block.line, column: column + 1 }
			}
		);
	}

	function restoredWorkspace() {
		sharedCode = null;
		viewingShare = false;
		publishedShare = null;
		pane = 'code';
		clearSharedImportUrl();
		void tick().then(() => codeEditor?.focusEditor());
	}

	function remoteExplorerSnapshot(): WorkspaceSnapshot {
		const tree = remoteTree ?? (webdavConnection ? emptyWebDavTree(webdavConnection) : null);
		if (!tree) return workspace;
		const selected =
			tree.folders.some((folder) => folder.id === remoteSelectedId) && remoteSelectedId
				? remoteSelectedId
				: (tree.folders[0]?.id ?? '');
		return {
			version: workspace.version,
			folders: tree.folders.map(({ id, name, parentId }) => ({ id, name, parentId })),
			files: tree.files.map((file) => ({
				id: file.id,
				name: file.name,
				folderId: file.folderId,
				content: '',
				updatedAt: 0
			})),
			openFileIds: [],
			activeFileId: '',
			selectedFolderId: selected,
			layout: workspace.layout,
			welcomed: true
		};
	}

	async function refreshRemoteTree() {
		const credentials = webdavCredentials;
		const connection = webdavConnection;
		if (!credentials || !connection) return;
		remoteTree = await listWebDavProjectTree(credentials, connection);
		if (!remoteSelectedId || !remoteTree.folders.some((folder) => folder.id === remoteSelectedId)) {
			remoteSelectedId = remoteTree.folders[0]?.id ?? '';
		}
	}

	function showFilesManager() {
		if (!webdavConnection) {
			const folderId = activeFile?.folderId;
			if (folderId && workspace.selectedFolderId !== folderId) {
				workspace = selectFolder(workspace, folderId);
			}
		}
		explorerToken += 1;
		filesOpen = true;
	}

	function openFilesManager() {
		if (webdavCredentials && webdavConnection && syncStatus !== 'error') {
			void refreshRemoteTree()
				.then(() => showFilesManager())
				.catch((error) => {
					syncError =
						error instanceof Error ? error.message : 'Die Dateiablage konnte nicht gelesen werden.';
					announce(syncError);
					showFilesManager();
				});
			return;
		}
		if (readLocalOnly()) {
			showFilesManager();
			return;
		}
		filesAfterLogin = true;
		saveAfterLogin = false;
		loginError = syncError;
		loginOpen = true;
	}

	function openExplorer() {
		openFilesManager();
	}

	function openSaveDialog() {
		saveAsToken += 1;
		saveAsOpen = true;
	}

	function openSave() {
		if (editorEmpty) return;
		if (webdavCredentials && webdavConnection && syncStatus !== 'connecting') {
			void refreshRemoteTree()
				.then(() => openSaveDialog())
				.catch((error) => {
					announce(
						error instanceof Error ? error.message : 'Die Dateiablage konnte nicht gelesen werden.'
					);
					openSaveDialog();
				});
			return;
		}
		saveAfterLogin = true;
		filesAfterLogin = false;
		loginError = syncError;
		loginOpen = true;
	}

	async function openRemoteFile(href: string) {
		const credentials = webdavCredentials;
		const connection = webdavConnection;
		const remote = remoteTree?.files.find((file) => file.id === href);
		if (!credentials || !connection || !remote) return;
		try {
			const content = await readWebDavFile(credentials, href);
			const path = coderProjectPath(
				webDavRelativeDir(connection.projectHref, remote.folderId),
				remote.name
			);
			const existing = workspace.files.find((file) => remotePaths[file.id] === path);
			if (existing) {
				if (publishedContents[existing.id] === existing.content) {
					const next = openFile(updateFileContent(workspace, existing.id, content), existing.id);
					applyWorkspace(next);
					markFilePublished(existing.id, content, path);
				} else {
					applyWorkspace(openFile(workspace, existing.id));
				}
				return;
			}
			const next = createFile(workspace, ROOT_FOLDER_ID, remote.name, content);
			const created = next.files.find(
				(file) => !workspace.files.some((item) => item.id === file.id)
			);
			applyWorkspace(next);
			if (created) markFilePublished(created.id, content, path);
		} catch (error) {
			announce(error instanceof Error ? error.message : 'Die Datei konnte nicht geöffnet werden.');
		}
	}

	async function createRemoteFolder(parentHref: string, name: string) {
		if (!webdavCredentials || !webdavConnection) return;
		try {
			await createWebDavFolder(webdavCredentials, webdavConnection, parentHref, name);
			await refreshRemoteTree();
			announce(`Ordner „${name}“ in wwschool angelegt.`);
		} catch (error) {
			announce(error instanceof Error ? error.message : 'Der Ordner konnte nicht angelegt werden.');
		}
	}

	async function createRemoteFile(folderHref: string, name: string) {
		if (!webdavCredentials || !webdavConnection) return;
		try {
			await refreshRemoteTree();
			const priorIds = new Set(remoteTree?.files.map((file) => file.id) ?? []);
			await createWebDavFile(webdavCredentials, webdavConnection, folderHref, name);
			await refreshRemoteTree();
			const newFiles =
				remoteTree?.files.filter(
					(file) => !priorIds.has(file.id) && file.folderId === folderHref
				) ?? [];
			const created =
				newFiles.find(
					(file) => file.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')
				) ?? (newFiles.length === 1 ? newFiles[0] : undefined);
			if (!created) throw new Error('Die neue Datei wurde in wwschool nicht gefunden.');
			await openRemoteFile(created.href);
			filesOpen = false;
			announce(`Datei „${name}“ in wwschool angelegt und geöffnet.`);
		} catch (error) {
			announce(error instanceof Error ? error.message : 'Die Datei konnte nicht angelegt werden.');
		}
	}

	function importWorkspaceFiles(files: { name: string; content: string }[]) {
		const next = importFiles(workspace, workspace.selectedFolderId, files);
		const previousIds = new Set(workspace.files.map((file) => file.id));
		const createdIds = next.files
			.filter((file) => !previousIds.has(file.id))
			.map((file) => file.id);
		if (createdIds.length) localUnsavedIds = new Set([...localUnsavedIds, ...createdIds]);
		applyWorkspace(next);
		if (createdIds.length) pane = 'code';
	}

	async function commitSaveAs(folderId: string, rawName: string) {
		const credentials = webdavCredentials;
		const connection = webdavConnection;
		if (!credentials || !connection || wwschoolSaveBusy) return;
		const filename = acceptedFileName(rawName);
		if (!filename) {
			announce(newFileNameError(rawName) ?? 'Ungültiger Dateiname.');
			return;
		}
		wwschoolSaveBusy = true;
		syncStatus = 'syncing';
		try {
			const relativeDir = webDavRelativeDir(connection.projectHref, folderId);
			await writeWebDavProjectFile(credentials, connection, relativeDir, filename, editorCode);
			const path = coderProjectPath(relativeDir, filename);
			if (viewingShare && sharedCode !== null) {
				const next = importFiles(workspace, ROOT_FOLDER_ID, [
					{ name: filename, content: editorCode }
				]);
				const created = next.files.find(
					(file) => !workspace.files.some((item) => item.id === file.id)
				);
				applyWorkspace(next);
				if (created) markFilePublished(created.id, editorCode, path);
				sharedCode = null;
				viewingShare = false;
				publishedShare = null;
				clearSharedImportUrl();
			} else if (activeFile) {
				let next = updateFileContent(workspace, activeFile.id, editorCode);
				if (filename !== activeFile.name) next = renameFile(next, activeFile.id, filename);
				applyWorkspace(next);
				markFilePublished(activeFile.id, editorCode, path);
			}
			await refreshRemoteTree();
			saveAsOpen = false;
			syncError = '';
			syncStatus = 'synced';
			announce(`Nach wwschool gelegt: ${path}`);
		} catch (error) {
			syncError =
				error instanceof Error
					? error.message
					: 'Die Datei konnte nicht auf wwschool gelegt werden.';
			syncStatus = 'error';
			announce(syncError);
		} finally {
			wwschoolSaveBusy = false;
		}
	}

	function undo() {
		if (editorEmpty) return;
		codeEditor?.undoEdit();
	}

	function redo() {
		if (editorEmpty) return;
		codeEditor?.redoEdit();
	}

	function startRuffWorker() {
		if (ruffWorker) return;
		const worker = new Worker(new URL('../lib/runner/ruff.worker.ts', import.meta.url), {
			type: 'module'
		});
		ruffWorker = worker;
		worker.onmessage = (event: MessageEvent<RuffWorkerMessage>) => {
			if (ruffWorker !== worker) return;
			const message = event.data;
			if (message.type === 'ready') {
				scheduleLint();
				return;
			}
			if (!isPython || message.id !== lintId) return;
			if (message.type === 'diagnostics') {
				diagnostics = message.diagnostics;
				lintError = undefined;
			} else {
				lintError = message.error;
			}
		};
		worker.onerror = (event) => {
			event.preventDefault();
			if (ruffWorker !== worker) return;
			if (isPython) lintError = 'Der Ruff-Worker konnte nicht geladen werden.';
			worker.terminate();
			ruffWorker = undefined;
		};
	}

	function scheduleLint(source = editorCode) {
		if (!isPython) return;
		startRuffWorker();
		if (lintTimer) clearTimeout(lintTimer);
		lintTimer = setTimeout(() => {
			lintId += 1;
			ruffWorker?.postMessage({ type: 'lint', id: lintId, code: source });
		}, 180);
	}

	function appendRunOutput(id: number, stream: 'stdout' | 'stderr', text: string) {
		commitConsole(
			consoleBlocks.map((block) => {
				if (block.runId !== id || block.status) return block;
				if (stream === 'stdout') return { ...block, stdout: clipText(block.stdout + text) };
				return { ...block, stderr: clipText(block.stderr + text) };
			})
		);
	}

	function stopScript(message: string) {
		if (scriptTimer) clearTimeout(scriptTimer);
		scriptDoc = '';
		scriptToken = 0;
		const fileId = scriptFileId;
		const wasRunning = scriptRunning;
		scriptRunning = false;
		if (wasRunning && message) pushNote(message, true, fileId);
	}

	function finishScript() {
		if (!scriptRunning) return;
		if (scriptTimer) clearTimeout(scriptTimer);
		scriptRunning = false;
		if (!scriptLogged) pushNote('Fertig.', false, scriptFileId);
	}

	function startScript() {
		terminalCollapsed = false;
		scriptFileId = editorFileId;
		scriptName = editorName;
		scriptLogged = false;
		scriptToken = ++previewToken;
		const links = {
			baseDir: activeFile ? projectDirectory(workspace, activeFile.folderId) : '',
			files: linkedProjectFiles()
		};
		const doc = scriptDocument(editorCode, scriptToken, links);
		scriptLineOffsetLines = scriptLineOffset(doc);
		scriptDoc = doc;
		scriptRunning = true;
		if (scriptTimer) clearTimeout(scriptTimer);
		scriptTimer = setTimeout(
			() => stopScript(`Ausführung nach ${RUN_TIMEOUT_MS / 1_000} Sekunden gestoppt.`),
			RUN_TIMEOUT_MS
		);
	}

	function runCode() {
		if (editorEmpty) return;
		if (previewing) {
			terminalCollapsed = false;
			previewNonce += 1;
			return;
		}
		if (isJavaScript) {
			if (scriptRunning) {
				stopScript('Ausführung gestoppt.');
				return;
			}
			startScript();
			return;
		}
		if (!isPython) return;
		if (isRunning) {
			stopRun('Ausführung gestoppt.');
			return;
		}
		if (runnerStatus === 'loading') return;
		terminalCollapsed = false;
		pendingPythonInput = null;
		const traceVisualizerOutput = visualizerEnabled;
		if (traceVisualizerOutput) visualizerOutputs = {};
		runId += 1;
		const payload = runPayload();
		const fileId = editorFileId;
		const thisId = runId;
		runFileId = fileId;
		runningPythonRunId = thisId;
		runningPythonFileId = fileId;
		beginRun(thisId, payload.filename, fileId);
		void runPython({
			code: editorCode,
			filename: payload.filename,
			files: payload.files,
			onOutput: (stream, text) => appendRunOutput(thisId, stream, text),
			onOutputLine: traceVisualizerOutput
				? (line, text) => {
						visualizerOutputs = {
							...visualizerOutputs,
							[line]: `${visualizerOutputs[line] ?? ''}${text}`
						};
					}
				: undefined,
			onInput: () => requestPythonInput(thisId)
		}).then((result) => {
			if (runningPythonRunId === thisId) {
				runningPythonRunId = null;
				runningPythonFileId = '';
			}
			if (pendingPythonInput === thisId) pendingPythonInput = null;
			if (result.failed) {
				const note = result.error || result.stderr;
				if (
					!finishRun(thisId, {
						stdout: result.stdout,
						stderr: result.stopped ? result.stderr : note,
						status: result.stopped ? note : `Nach ${Math.round(result.durationMs)} ms beendet`,
						failed: true
					})
				) {
					pushNote(note, true, fileId);
				}
				return;
			}
			finishRun(thisId, {
				stdout: result.stdout || (result.stderr ? '' : '(ohne Ausgabe beendet)'),
				stderr: result.stderr,
				status: `Beendet in ${Math.round(result.durationMs)} ms`,
				failed: false
			});
		});
	}

	function stopRun(message: string) {
		pendingPythonInput = null;
		pythonInputValue = '';
		stopPython(message);
	}

	function clearCode() {
		if (viewingShare && sharedCode !== null) {
			sharedCode = '';
			announce('Code gelöscht');
			return;
		}
		if (editorEmpty) return;
		workspace = updateFileContent(workspace, workspace.activeFileId, '');
		announce('Code gelöscht');
	}

	function downloadCode() {
		if (editorEmpty) return;
		const filename = editorName;
		const blobUrl = URL.createObjectURL(
			new Blob([editorCode], {
				type: `${fileMime(filename)};charset=utf-8`
			})
		);
		const link = document.createElement('a');
		link.href = blobUrl;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(blobUrl);
		if (viewingShare && sharedCode !== null) publishedShare = editorCode;
		else if (activeFile) markFilePublished(activeFile.id, editorCode);
		announce(`${filename} heruntergeladen`);
	}

	type RelayFrame = {
		type?: string;
		roomId?: string;
		peerId?: string;
		hostPeerId?: string;
		from?: string;
		to?: string;
		payload?: Record<string, unknown>;
	};

	function relaySend(socket: WebSocket, message: unknown) {
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
	}

	async function connectCollaborationRelay(): Promise<WebSocket> {
		const socket = new WebSocket(COLLABORATION_RELAY_URL);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => resolve(), { once: true });
			socket.addEventListener(
				'error',
				() => reject(new Error('Der Zusammenarbeitsserver ist nicht erreichbar.')),
				{ once: true }
			);
		});
		return socket;
	}

	function installCollaborationSocket(socket: WebSocket) {
		socket.onmessage = (event: MessageEvent<string>) => {
			if (typeof event.data !== 'string') return;
			void Promise.resolve()
				.then(() => handleCollaborationFrame(socket, JSON.parse(event.data) as RelayFrame))
				.catch((error) => {
					collaborationError =
						error instanceof Error
							? error.message
							: 'Die verschlüsselte Sitzung ist fehlgeschlagen.';
					socket.close(4002, 'Zusammenarbeit fehlgeschlagen');
				});
		};
		socket.onclose = () => {
			if (collaborationSocket !== socket) return;
			const wasConnected = collaborationConnected;
			if (!wasConnected && !collaborationError) {
				collaborationError = 'Sitzung nicht gefunden. Prüfe den Verbindungscode.';
			}
			endCollaborationSession(false);
			if (wasConnected) announce('Die gemeinsame Sitzung wurde beendet.');
		};
		socket.onerror = () => {
			if (!collaborationConnected) {
				collaborationError = 'Verbindung zum Zusammenarbeitsserver fehlgeschlagen.';
			}
		};
	}

	function attachCollaborationDocument(
		doc: Y.Doc,
		socket: WebSocket,
		roomId: string,
		peerId: string
	) {
		const listener = (update: Uint8Array, origin: unknown) => {
			collaborationRevision += 1;
			if (!collaborationStateTimer) {
				collaborationStateTimer = setTimeout(() => {
					collaborationStateTimer = undefined;
					if (collaborationDoc !== doc) return;
					workspace = snapshotFromSharedWorkspace(doc, workspace);
					collaborationFileIds = [...workspace.openFileIds];
				}, 25);
			}
			if (isRemoteUpdateOrigin(origin)) return;
			collaborationPendingUpdates.push(update.slice());
			if (collaborationSendTimer) clearTimeout(collaborationSendTimer);
			collaborationSendTimer = setTimeout(() => {
				const updates = collaborationPendingUpdates.splice(0);
				if (!updates.length || collaborationSocket !== socket || !collaborationGroupKey) return;
				const key = collaborationGroupKey;
				const payload = mergeUpdates(updates);
				if (payload.byteLength > MAX_COLLABORATION_BYTES) {
					collaborationError = 'Die Sitzung ist zu groß für die verschlüsselte Verbindung.';
					socket.close(4009, 'Sitzungsgröße überschritten');
					return;
				}
				void encryptPayload(
					key,
					{ kind: 'yjs-update', update: encodeBase64(payload) },
					`K+ collaboration v1|${roomId}|${peerId}`
				).then((encrypted) => {
					relaySend(socket, { type: 'broadcast', payload: encrypted });
				});
			}, 30);
		};
		collaborationDoc = doc;
		collaborationDocListener = listener;
		doc.on('update', listener);
		collaborationFileIds = [...workspace.openFileIds];
	}

	async function handleCollaborationFrame(socket: WebSocket, frame: RelayFrame) {
		if (socket !== collaborationSocket) return;
		if (frame.type === 'created' && collaborationRole === 'host') {
			collaborationPeerId = frame.peerId ?? 'host';
			collaborationBusy = false;
			collaborationConnected = true;
			collaborationFileIds = [...workspace.openFileIds];
			collaborationPendingHostSnapshot = null;
			collaborationError = '';
			announce('Verschlüsselte Sitzung gestartet. Teile den Sechs-Wörter-Code.');
			return;
		}
		if (frame.type === 'joined' && collaborationRole === 'guest') {
			collaborationPeerId = frame.peerId ?? '';
			collaborationHostPeerId = frame.hostPeerId ?? 'host';
			const login = await startOpaqueClientLogin(collaborationJoinCode);
			collaborationClientState = login.state;
			relaySend(socket, {
				type: 'signal',
				to: collaborationHostPeerId,
				payload: { type: 'auth-start', request: login.request }
			});
			return;
		}
		if (frame.type === 'peer-left' && collaborationRole === 'host') {
			if (frame.peerId) collaborationHostState?.loginStates.delete(frame.peerId);
			return;
		}
		if (frame.type === 'peer-joined' && collaborationRole === 'host') return;

		if (frame.type === 'signal' && frame.from && frame.payload) {
			const signal = frame.payload;
			if (collaborationRole === 'host' && collaborationHostState) {
				if (signal.type === 'auth-start' && typeof signal.request === 'string') {
					const loginResponse = await createOpaqueServerLogin(
						collaborationHostState,
						frame.from,
						signal.request
					);
					relaySend(socket, {
						type: 'signal',
						to: frame.from,
						payload: { type: 'auth-response', loginResponse }
					});
					return;
				}
				if (
					signal.type === 'auth-finish' &&
					typeof signal.request === 'string' &&
					collaborationGroupBytes &&
					collaborationGroupKey &&
					collaborationDoc
				) {
					const sessionKey = await finishOpaqueServerLogin(
						collaborationHostState,
						frame.from,
						signal.request
					);
					const pairwiseKey = await derivePairwiseKey(sessionKey, collaborationRoomId);
					const state = fullWorkspaceUpdate(collaborationDoc);
					if (state.byteLength > MAX_COLLABORATION_BYTES) {
						throw new Error('Der gemeinsame Workspace überschreitet 20 MB.');
					}
					const welcome = await encryptPayload(
						pairwiseKey,
						{
							version: 1,
							groupKey: encodeBase64(collaborationGroupBytes),
							state: encodeBase64(state)
						},
						`K+ collaboration welcome v1|${collaborationRoomId}|host|${frame.from}`
					);
					relaySend(socket, {
						type: 'signal',
						to: frame.from,
						payload: { type: 'welcome', encrypted: welcome }
					});
					return;
				}
				return;
			}

			if (collaborationRole === 'guest') {
				if (
					signal.type === 'auth-response' &&
					typeof signal.loginResponse === 'string' &&
					collaborationClientState
				) {
					const login = await finishOpaqueClientLogin(
						collaborationClientState,
						signal.loginResponse
					);
					collaborationPairwiseKey = await derivePairwiseKey(
						login.sessionKey,
						collaborationPendingRoomId
					);
					collaborationClientState = null;
					relaySend(socket, {
						type: 'signal',
						to: collaborationHostPeerId,
						payload: { type: 'auth-finish', request: login.finishLoginRequest }
					});
					return;
				}
				if (
					signal.type === 'welcome' &&
					collaborationPairwiseKey &&
					signal.encrypted &&
					typeof signal.encrypted === 'object'
				) {
					const welcome = await decryptPayload<{
						version: number;
						groupKey: string;
						state: string;
					}>(
						collaborationPairwiseKey,
						signal.encrypted as unknown as EncryptedPayload,
						`K+ collaboration welcome v1|${collaborationPendingRoomId}|host|${collaborationPeerId}`
					);
					if (welcome.version !== 1) throw new Error('Unbekannte Sitzungs-Version.');
					const state = decodeBase64(welcome.state);
					if (state.byteLength > MAX_COLLABORATION_BYTES) {
						throw new Error('Der gemeinsame Workspace überschreitet 20 MB.');
					}
					const doc = new Y.Doc();
					applyRemoteUpdate(doc, state);
					workspace = openCollaborationFile(
						snapshotFromSharedWorkspace(doc, emptyCollaborationWorkspace(workspace.layout))
					);
					collaborationRoomId = collaborationPendingRoomId;
					collaborationGroupKey = await importGroupKey(welcome.groupKey);
					collaborationGroupBytes = decodeBase64(welcome.groupKey);
					attachCollaborationDocument(doc, socket, collaborationRoomId, collaborationPeerId);
					collaborationConnected = true;
					collaborationFileIds = [...workspace.openFileIds];
					collaborationBusy = false;
					collaborationPassphrase = '';
					relaySend(socket, {
						type: 'signal',
						to: collaborationHostPeerId,
						payload: { type: 'ready' }
					});
					collaborationError = '';
					collaborationOpen = true;
					announce('Mit der Ende-zu-Ende-verschlüsselten Sitzung verbunden.');
					return;
				}
			}
			return;
		}

		if (
			frame.type === 'broadcast' &&
			frame.from &&
			frame.payload &&
			collaborationGroupKey &&
			collaborationDoc
		) {
			const update = await decryptPayload<{ kind: string; update: string }>(
				collaborationGroupKey,
				frame.payload as unknown as EncryptedPayload,
				`K+ collaboration v1|${collaborationRoomId}|${frame.from}`
			);
			if (update.kind !== 'yjs-update' || typeof update.update !== 'string') return;
			applyRemoteUpdate(collaborationDoc, decodeBase64(update.update));
		}
	}

	function endCollaborationSession(closeSocket = true) {
		const socket = collaborationSocket;
		const role = collaborationRole;
		const wasConnected = collaborationConnected;
		if (role === 'host' && collaborationDoc) {
			workspace = snapshotFromSharedWorkspace(collaborationDoc, workspace);
		}
		if (role === 'host' && !wasConnected && collaborationPendingHostSnapshot) {
			workspace = collaborationPendingHostSnapshot;
		}
		if (collaborationSendTimer) clearTimeout(collaborationSendTimer);
		if (collaborationStateTimer) clearTimeout(collaborationStateTimer);
		collaborationSendTimer = undefined;
		collaborationStateTimer = undefined;
		if (collaborationDoc && collaborationDocListener) {
			collaborationDoc.off('update', collaborationDocListener);
		}
		if (collaborationDoc) destroySharedWorkspace(collaborationDoc);
		if (role === 'guest') restoreParkedWorkspace();
		collaborationSocket = undefined;
		if (closeSocket && socket && socket.readyState < WebSocket.CLOSING)
			socket.close(1000, 'Sitzung beendet');
		collaborationDoc = null;
		collaborationDocListener = undefined;
		collaborationHostState = null;
		collaborationClientState = null;
		collaborationPairwiseKey = null;
		collaborationGroupKey = null;
		collaborationGroupBytes?.fill(0);
		collaborationGroupBytes = null;
		collaborationPendingUpdates = [];
		collaborationPeerId = '';
		collaborationHostPeerId = '';
		collaborationPendingHostSnapshot = null;
		collaborationPendingRoomId = '';
		collaborationRole = null;
		collaborationConnected = false;
		collaborationFileIds = [];
		collaborationBusy = false;
		collaborationRoomId = '';
		collaborationPassphrase = '';
		collaborationJoinCode = '';
	}

	async function startHostCollaboration(snapshot: WorkspaceSnapshot) {
		const code = generateGermanPassphrase();
		const roomId = await collaborationRoomIdFromCode(code);
		const hostState = await createOpaqueHost(roomId, code);
		const doc = new Y.Doc();
		seedSharedWorkspace(doc, snapshot);
		const group = await createGroupKey();
		const socket = await connectCollaborationRelay();
		collaborationPendingHostSnapshot = snapshot;
		collaborationSocket = socket;
		collaborationRole = 'host';
		collaborationRoomId = roomId;
		collaborationPassphrase = code;
		collaborationHostState = hostState;
		collaborationGroupBytes = group.bytes;
		collaborationGroupKey = group.key;
		collaborationBusy = true;
		collaborationOpen = true;
		workspace = openCollaborationFile(snapshot);
		collaborationFileIds = [...workspace.openFileIds];
		attachCollaborationDocument(doc, socket, roomId, 'host');
		installCollaborationSocket(socket);
		relaySend(socket, { type: 'create', roomId });
	}

	async function startGuestCollaboration(code: string) {
		const normalizedCode = normalizeCollaborationCode(code);
		const roomId = await collaborationRoomIdFromCode(normalizedCode);
		parkLocalWorkspace();
		const socket = await connectCollaborationRelay();
		collaborationSocket = socket;
		collaborationRole = 'guest';
		collaborationPendingRoomId = roomId;
		collaborationBusy = true;
		collaborationOpen = true;
		collaborationJoinCode = normalizedCode;
		workspace = emptyCollaborationWorkspace(parkedLocal?.workspace.layout ?? workspace.layout);
		collaborationFileIds = [];
		installCollaborationSocket(socket);
		relaySend(socket, { type: 'join', roomId });
	}

	async function startCollaboration(action: 'host' | 'guest') {
		collaborationBusy = true;
		collaborationError = '';
		collaborationOpen = action === 'host';
		const snapshot = $state.snapshot(workspace) as WorkspaceSnapshot;
		try {
			if (action === 'host') await startHostCollaboration(snapshot);
			else await startGuestCollaboration(collaborationJoinCode);
		} catch (error) {
			collaborationError =
				error instanceof Error ? error.message : 'Die Sitzung konnte nicht gestartet werden.';
			if (collaborationRole) endCollaborationSession();
			else if (action === 'guest') restoreParkedWorkspace();
			collaborationPendingHostSnapshot = null;
			collaborationBusy = false;
			collaborationOpen = true;
			if (action === 'host') workspace = snapshot;
			announce(collaborationError);
		}
	}

	function beginCollaboration(action: 'host' | 'guest') {
		if (collaborationConnected || collaborationBusy || collaborationRole) {
			collaborationOpen = true;
			return;
		}
		if (action === 'guest') {
			try {
				normalizeCollaborationCode(collaborationJoinCode);
			} catch {
				collaborationError = 'Der Verbindungscode besteht aus genau sechs Wörtern.';
				return;
			}
		}
		void startCollaboration(action);
	}

	async function copyCollaborationCode() {
		try {
			await navigator.clipboard.writeText(collaborationPassphrase);
			announce('Sechs-Wörter-Code kopiert.');
		} catch {
			announce('Der Code konnte nicht kopiert werden.');
		}
	}

	function leaveCollaboration() {
		const role = collaborationRole;
		endCollaborationSession(true);
		collaborationOpen = false;
		announce(
			role === 'guest'
				? 'Sitzung beendet. Deine lokalen Dateien sind wieder geöffnet.'
				: 'Sitzung beendet.'
		);
	}

	async function shareCode() {
		if (editorEmpty) return;
		const shareUrl = createShareUrl(editorCode, window.location);
		if (!canShareCode(editorCode, window.location)) {
			downloadCode();
			announce('Der Code ist zu lang für eine zuverlässige URL und wurde heruntergeladen.');
			return;
		}
		try {
			if (navigator.share) {
				await navigator.share({ title: activeFile?.name ?? 'K+ Coder', url: shareUrl });
				announce('Teilen geöffnet');
			} else {
				await navigator.clipboard.writeText(shareUrl);
				announce('Link kopiert');
			}
		} catch (error: unknown) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			announce('Der Link konnte nicht geteilt werden.');
		}
	}

	function finishWelcome(language: WelcomeLanguage) {
		workspace = applyWelcomeChoice(workspace, language);
		pane = 'code';
		void tick().then(() => codeEditor?.focusEditor());
	}

	function applyTheme(nextTheme: AppTheme) {
		theme = nextTheme;
		applyDocumentTheme(nextTheme);
		localStorage.setItem('theme', nextTheme);
	}

	function handleShortcut(event: KeyboardEvent) {
		if (event.target instanceof HTMLInputElement) return;
		if (!(event.metaKey || event.ctrlKey)) return;
		if (event.key.toLowerCase() === 's') {
			event.preventDefault();
			if (!editorEmpty) openSave();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			runCode();
		}
	}

	$effect(() => {
		if (!hydrated || !workspace.welcomed) return;
		if (takeDocsPopup()) docsOpen = true;
	});

	$effect(() => {
		if (!hydrated || !workspace.welcomed) return;
		const pythonOpen =
			isPythonFile(editorName) || openFiles.some((file) => isPythonFile(file.name));
		holdPython(pythonOpen);
		return () => holdPython(false);
	});

	$effect(() => {
		if (!hydrated) return;
		const source = editorCode;
		const fileId = editorFileId;
		if (fileId !== lintedFileId) {
			lintedFileId = fileId;
			diagnostics = [];
			lintError = undefined;
		}
		if (isPythonFile(editorName)) {
			scheduleLint(source);
			return () => {
				if (lintTimer) clearTimeout(lintTimer);
			};
		}
		lintId += 1;
		const ticket = lintId;
		const name = editorName;
		lintTimer = setTimeout(() => {
			if (ticket !== lintId) return;
			void import('#lib/editor/web-lint.js').then(({ lintWeb }) => {
				if (ticket !== lintId) return;
				try {
					diagnostics = lintWeb(name, source);
					lintError = undefined;
				} catch (error) {
					diagnostics = [];
					lintError = error instanceof Error ? error.message : String(error);
				}
			});
		}, 180);
		return () => {
			if (lintTimer) clearTimeout(lintTimer);
		};
	});

	$effect(() => {
		const doc = collaborationDoc;
		if (!hydrated || !doc || !collaborationConnected) return;
		void collaborationRevision;
		syncSharedWorkspace(doc, workspace);
	});

	$effect(() => {
		if (!hydrated) return;
		void workspace.files.map((file) => file.content + file.name + file.folderId);
		void workspace.folders.map((folder) => folder.name + (folder.parentId ?? ''));
		void workspace.openFileIds;
		void workspace.activeFileId;
		void workspace.selectedFolderId;
		void workspace.welcomed;
		void workspace.layout;
		void publishedContents;
		void [...localUnsavedIds];
		void remotePaths;
		if (collaborationRole === 'guest') return;
		const ticket = ++saveTicket;
		saveTimer = setTimeout(() => {
			if (collaborationRole === 'guest') return;
			const session = captureSession();
			const savedAt = writeSessionBackup(session);
			enqueueSessionSave(session, ticket, savedAt);
		}, SAVE_DELAY_MS);
		return () => {
			if (saveTimer) clearTimeout(saveTimer);
		};
	});

	let openedPreviewId = '';

	$effect(() => {
		if (!hydrated) return;
		if (!isJavaScript && scriptDoc) {
			if (scriptTimer) clearTimeout(scriptTimer);
			scriptDoc = '';
			scriptToken = 0;
			scriptRunning = false;
		}
		if (!showsPreview) {
			openedPreviewId = '';
			return;
		}
		if (editorFileId === openedPreviewId) return;
		openedPreviewId = editorFileId;
		terminalCollapsed = false;
	});

	$effect(() => {
		if (!hydrated) return;
		const showing = showsPreview;
		const fileId = editorFileId;
		const nonce = previewNonce;
		const dark = isDarkTheme(theme);
		if (!showing || !fileId) return;
		const rendered = untrack(() => {
			const target = workspace.files.find((item) => item.id === fileId);
			if (!target) return null;
			return {
				name: target.name,
				source: target.content,
				files: linkedProjectFiles(),
				baseDir: projectDirectory(workspace, target.folderId),
				ownerId: target.id
			};
		});
		if (!rendered) return;
		const timer = setTimeout(() => {
			previewToken += 1;
			const token = previewToken;
			commitConsole(
				consoleBlocks.filter(
					(block) => block.fileId !== rendered.ownerId || block.kind !== 'preview'
				)
			);
			const publish = (html: string) => {
				previewDoc = previewDocument(html, token, {
					baseDir: rendered.baseDir,
					files: rendered.files
				});
			};
			if (isHtmlFile(rendered.name)) {
				publish(rendered.source);
				return;
			}
			void import('#lib/editor/document-preview.js').then(({ renderDocumentPreview }) => {
				if (token !== previewToken) return;
				publish(renderDocumentPreview(rendered.name, rendered.source, dark));
			});
			void nonce;
		}, 160);
		return () => clearTimeout(timer);
	});

	function openLinkedFile(url: string) {
		const target = previewTarget;
		if (!target) return;
		const path = resolveProjectPath(projectDirectory(workspace, target.folderId), url);
		if (!path) return;
		const key = path.toLocaleLowerCase('de');
		const match = workspace.files.find(
			(file) => projectFilePath(workspace, file).toLocaleLowerCase('de') === key
		);
		if (!match || match.id === workspace.activeFileId) return;
		showFile(match.id);
		if (isHtmlFile(match.name) || codeLanguage(match.name) === 'markdown') {
			terminalCollapsed = false;
			previewConsoleOpen = false;
		}
	}

	function readLinkedFile(url: string): { text: string; mime: string } | null {
		const target = previewTarget;
		if (!target) return null;
		const path = resolveProjectPath(projectDirectory(workspace, target.folderId), url);
		if (!path) return null;
		const key = path.toLocaleLowerCase('de');
		const match = linkedProjectFiles().find((file) => file.path.toLocaleLowerCase('de') === key);
		if (!match) return null;
		return { text: match.content, mime: fileMime(match.path) };
	}

	function openPreviewConsole() {
		previewConsoleOpen = true;
		scrollConsoleToEnd();
	}

	function onPreviewMessage(event: MessageEvent) {
		const request = readPreviewRequest(event.data, previewToken);
		if (request?.kind === 'open') {
			openLinkedFile(request.url);
			return;
		}
		if (request?.kind === 'read') {
			const file = readLinkedFile(request.url);
			if (event.source && 'postMessage' in event.source) {
				(event.source as Window).postMessage(
					{
						source: 'kplus-preview-host',
						token: previewToken,
						kind: 'file',
						id: request.id,
						missing: !file,
						text: file?.text ?? '',
						mime: file?.mime ?? 'text/plain'
					},
					'*'
				);
			}
			return;
		}
		if (readPreviewDone(event.data, scriptToken)) {
			finishScript();
			return;
		}
		const scriptMessage = scriptToken ? readPreviewMessage(event.data, scriptToken) : null;
		if (scriptMessage) {
			scriptLogged = true;
			const failed = scriptMessage.level === 'error' || scriptMessage.level === 'warn';
			const line = scriptMessage.line
				? Math.max(1, scriptMessage.line - scriptLineOffsetLines)
				: null;
			commitConsole([
				...consoleBlocks,
				{
					id: ++consoleSeq,
					fileId: scriptFileId,
					runId: null,
					kind: 'run',
					title: scriptName,
					filename: scriptName,
					stdout: failed ? '' : scriptMessage.text,
					stderr: failed ? scriptMessage.text : '',
					status: '',
					finishedAt: clockTime(),
					failed,
					line,
					column: scriptMessage.column ?? null
				}
			]);
			scrollConsoleToEnd();
			return;
		}
		const message = readPreviewMessage(event.data, previewToken);
		if (!message) return;
		const failed = message.level === 'error' || message.level === 'warn';
		const target = previewTarget;
		const source =
			target && editorFileId === target.id ? editorCode : (target?.content ?? editorCode);
		const linkedFile = previewFileFromUrl(message.url ?? '');
		const line = linkedFile
			? (message.line ?? null)
			: message.line && target
				? editorLineForPreview(source, previewToken, message.line, {
						baseDir: projectDirectory(workspace, target.folderId),
						files: linkedProjectFiles()
					})
				: null;
		const origin = linkedFile || target?.name || editorName;
		const ownerId = target?.id ?? editorFileId;
		commitConsole([
			...consoleBlocks,
			{
				id: ++consoleSeq,
				fileId: ownerId,
				runId: null,
				kind: 'preview',
				title: line ? `${origin}:${line}` : origin,
				filename: origin,
				stdout: failed ? '' : message.text,
				stderr: failed ? message.text : '',
				status: '',
				finishedAt: clockTime(),
				failed,
				line,
				column: message.column ?? null
			}
		]);
		if (previewConsoleOpen) scrollConsoleToEnd();
	}

	onMount(() => {
		const savedTheme = localStorage.getItem('theme');
		applyTheme(parseTheme(savedTheme, window.matchMedia('(prefers-color-scheme: dark)').matches));
		const narrowQuery = window.matchMedia('(max-width: 899px)');
		const syncNarrow = () => {
			narrow = narrowQuery.matches;
		};
		syncNarrow();
		narrowQuery.addEventListener('change', syncNarrow);
		window.addEventListener('message', onPreviewMessage);
		const stopWatch = watchPythonHost((state) => {
			runnerStatus = state.status === 'idle' ? 'ready' : state.status;
			if (state.version) pythonVersion = state.version;
		});
		let cancelled = false;
		void boot();
		return () => {
			cancelled = true;
			flushEditorSession();
			collaborationSocket?.close();
			if (collaborationDoc && collaborationDocListener) {
				collaborationDoc.off('update', collaborationDocListener);
			}
			if (collaborationDoc) destroySharedWorkspace(collaborationDoc);
			stopWatch();
			narrowQuery.removeEventListener('change', syncNarrow);
			window.removeEventListener('message', onPreviewMessage);
			disposePython();
			ruffWorker?.terminate();
			if (lintTimer) clearTimeout(lintTimer);
			if (noticeTimer) clearTimeout(noticeTimer);
		};

		async function boot() {
			persistentCredentialStorage = window.isSecureContext && Boolean(globalThis.crypto?.subtle);
			if (!persistentCredentialStorage) loginStay = false;
			let loaded: { session: EditorSession; created: boolean };
			try {
				loaded = await loadSession();
			} catch {
				loaded = {
					session: sessionFromWorkspace(createInitialWorkspace()),
					created: true
				};
				announce('Der gespeicherte Editorstand konnte nicht gelesen werden.');
			}
			if (cancelled) return;
			const url = new URL(window.location.href);
			const hasImport = url.searchParams.has(IMPORT_PARAM);
			const imported = hasImport ? decodeCode(url.hash.slice(1)) : null;
			if (imported !== null) {
				sharedCode = imported;
				viewingShare = true;
				announce('Geteilter Code geöffnet. Die Datei ist nicht gespeichert.');
			} else if (hasImport) {
				announce('Der geteilte Code ist ungültig oder zu groß.');
			}
			applySession(loaded.session);
			hydrated = true;
			if (readLocalOnly()) return;
			void loadWebDavCredentials()
				.then((credentials) => {
					if (!cancelled && credentials) {
						webdavRemembered = !hasSessionWebDavCredentials();
						return startWebDavSession(credentials, { store: 'keep' });
					}
				})
				.catch(async (error) => {
					if (cancelled) return;
					if (error instanceof WebDavError && (error.status === 401 || error.status === 403)) {
						await clearWebDavCredentials().catch(() => undefined);
					}
					webdavCredentials = null;
					webdavConnection = null;
					syncStatus = 'error';
					syncError =
						error instanceof Error
							? error.message
							: 'Die Anmeldung konnte nicht wiederhergestellt werden.';
					announce(syncError);
				});
		}
	});
</script>

<svelte:head>
	<title>K+ Coder</title>
	<meta
		name="description"
		content="Python, HTML, CSS und JavaScript im Browser bearbeiten – allein, in wwschool speichern oder verschlüsselt gemeinsam arbeiten."
	/>
</svelte:head>

<svelte:window onkeydown={handleShortcut} onpagehide={() => flushEditorSession()} />

{#if !hydrated}
	<div class="boot">Wird geladen …</div>
{:else}
	<div class="app-shell">
		<header class="topbar">
			<Button
				variant="outline"
				size={narrow ? 'icon-sm' : 'sm'}
				class="files-button"
				onclick={openExplorer}
				aria-label="Dateien"
				title={dirty ? 'Ungespeicherte Änderungen' : 'Dateien'}
			>
				<Files />
				<span class="action-label">Dateien</span>
				{#if dirty}<i class="dirty-mark" aria-hidden="true"></i>{/if}
			</Button>
			<div class="toolbar">
				<ButtonGroup.Root aria-label="Ausführen und Datei">
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						class={pythonLoading ? 'run-busy' : undefined}
						onclick={runCode}
						disabled={editorEmpty ||
							(!showsPreview && !isJavaScript && (!isPython || pythonLoading))}
						aria-busy={pythonLoading}
						aria-label={showsPreview
							? 'Vorschau neu laden'
							: pythonLoading
								? 'Python wird geladen'
								: stopping
									? 'Stopp'
									: 'Ausführen'}
						title={showsPreview
							? 'Vorschau neu laden'
							: !isJavaScript && !isPython
								? 'Diese Datei wird nicht ausgeführt'
								: pythonLoading
									? 'Python wird geladen'
									: stopping
										? 'Stopp'
										: 'Ausführen'}
						>{#if pythonLoading}<LoaderCircle class="animate-spin" />{:else if stopping}<Square
							/>{:else}<Play />{/if}<span class="action-label"
							>{showsPreview ? 'Aktualisieren' : stopping ? 'Stopp' : 'Ausführen'}</span
						></Button
					>
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						onclick={shareCode}
						disabled={editorEmpty}
						aria-label="Teilen"
						title="Teilen"><Share2 /><span class="action-label">Teilen</span></Button
					>
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						onclick={() => (collaborationOpen = true)}
						aria-label="Live-Zusammenarbeit öffnen"
						title="Live-Zusammenarbeit starten"
						><UsersRound /><span class="action-label">Zusammenarbeit</span></Button
					>
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						onclick={() => openDocs()}
						aria-label="Doku"
						title="Doku"><Book /><span class="action-label">Doku</span></Button
					>
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						onclick={openSave}
						disabled={editorEmpty || syncStatus === 'connecting' || wwschoolSaveBusy}
						aria-label="Speichern"
						title={webdavCredentials && webdavConnection
							? 'Geöffnete Datei nach wwschool legen (Cmd/Strg+S)'
							: 'Bei wwschool anmelden und speichern (Cmd/Strg+S)'}
						><Save /><span class="action-label">Speichern</span></Button
					>
					<Button
						variant="outline"
						size="icon-sm"
						onclick={downloadCode}
						disabled={editorEmpty}
						aria-label="{editorName} herunterladen"
						title="Herunterladen"><Download /></Button
					>
				</ButtonGroup.Root>
				<Popover.Root bind:open={settingsOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="Einstellungen"
								title="Einstellungen"
								{...props}><Settings /></Button
							>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-72">
						<div class="settings">
							<p class="settings-label">wwschool</p>
							{#if webdavCredentials}
								<p class="settings-email" title={webdavCredentials.username}>
									{webdavCredentials.username}
								</p>
								<p class="settings-note">
									Speichern legt die geöffnete Datei in {CODER_FOLDER_NAME} in deiner Dateiablage ab.
									wwschool erzeugt dabei immer eine neue Datei; gleicher Name wird eine weitere Kopie.
									Löschen geht nur in der wwschool-App oder im Web.
								</p>
								{#if !webdavRemembered}
									<p class="settings-note">Nur diese Sitzung</p>
								{/if}
								{#if syncStatus === 'error'}
									<p class="settings-error" role="alert">{syncError || 'Verbindung gestört'}</p>
									<Button
										variant="outline"
										size="sm"
										class="w-full justify-start"
										onclick={() => void reconnectWebDav()}
										disabled={loginBusy}
									>
										{#if loginBusy}<LoaderCircle class="animate-spin" />{/if}
										<span>Erneut verbinden</span>
									</Button>
								{/if}
								<Button
									variant="outline"
									size="sm"
									class="w-full justify-start"
									onclick={() => void logoutWebDav()}
									aria-label="Von wwschool abmelden"
								>
									<LogOut />
									<span>Abmelden</span>
								</Button>
							{:else}
								<Button
									variant="outline"
									size="sm"
									class="w-full justify-start"
									onclick={openLogin}
									aria-label="Bei wwschool anmelden"
								>
									<LogIn />
									<span>Anmelden</span>
								</Button>
							{/if}
							<Button
								variant="outline"
								size="sm"
								class="w-full justify-start"
								onclick={openVersions}
								aria-label="Versionen"
							>
								<Info />
								<span>Versionen</span>
							</Button>
							<p class="settings-label">Design</p>
							<ButtonGroup.Root aria-label="Darstellung">
								<Button
									variant={theme === 'light' ? 'secondary' : 'ghost'}
									size="icon-sm"
									onclick={() => applyTheme('light')}
									aria-label="Helles Design"
									aria-pressed={theme === 'light'}><Sun /></Button
								>
								<Button
									variant={theme === 'dark' ? 'secondary' : 'ghost'}
									size="icon-sm"
									onclick={() => applyTheme('dark')}
									aria-label="Dunkles Design"
									aria-pressed={theme === 'dark'}><Moon /></Button
								>
								<Button
									variant={theme === 'coffee' ? 'secondary' : 'ghost'}
									size="icon-sm"
									onclick={() => applyTheme('coffee')}
									aria-label="Kaffee"
									title="Kaffee"
									aria-pressed={theme === 'coffee'}><Coffee /></Button
								>
								<Button
									variant={theme === 'pink' ? 'secondary' : 'ghost'}
									size="icon-sm"
									onclick={() => applyTheme('pink')}
									aria-label="Rosa"
									title="Rosa"
									aria-pressed={theme === 'pink'}><Flower2 /></Button
								>
							</ButtonGroup.Root>
						</div>
					</Popover.Content>
				</Popover.Root>
			</div>
		</header>

		<main class="workspace">
			{#if scriptDoc}
				<iframe
					class="script-runner"
					title="JavaScript"
					sandbox="allow-scripts"
					referrerpolicy="no-referrer"
					srcdoc={scriptDoc}
				></iframe>
			{/if}
			{#if !showsPane || terminalCollapsed}
				<section class="editor-pane">{@render editor()}</section>
				{#if showsPane}
					<aside class="terminal-rail">
						<button
							type="button"
							class="rail-toggle"
							onclick={() => (terminalCollapsed = false)}
							aria-label={previewing ? 'Vorschau einblenden' : 'Ausgabe einblenden'}
							title={previewing ? 'Vorschau einblenden' : 'Ausgabe einblenden'}
						>
							<ChevronLeft /><span class="rail-label">{previewing ? 'Vorschau' : 'Ausgabe'}</span>
						</button>
					</aside>
				{/if}
			{:else}
				<Resizable.PaneGroup
					direction={narrow ? 'vertical' : 'horizontal'}
					autoSaveId={narrow ? 'python-runner-layout-mobile' : 'python-runner-layout'}
				>
					<Resizable.Pane defaultSize={52} minSize={34}
						><section class="editor-pane">{@render editor()}</section></Resizable.Pane
					>
					<Resizable.Handle withHandle />
					<Resizable.Pane defaultSize={48} minSize={24}
						><section
							class="terminal-pane"
							class:previewing
							class:with-console={isHtml}
							class:console-open={isHtml && previewConsoleOpen}
						>
							{#if previewing}
								{@render preview()}
							{:else}
								{@render terminal()}
							{/if}
						</section></Resizable.Pane
					>
				</Resizable.PaneGroup>
			{/if}
		</main>
	</div>

	<FilesExplorer
		bind:open={filesOpen}
		openedToken={explorerToken}
		snapshot={webdavConnection ? remoteExplorerSnapshot() : workspace}
		onchange={applyExplorer}
		onnotice={announce}
		onrestore={restoredWorkspace}
		syncStatus={syncStatus === 'connecting' ? 'syncing' : syncStatus}
		syncLocation={webdavConnection?.personalName ?? ''}
		remote={Boolean(webdavConnection)}
		onopenfile={(href) => void openRemoteFile(href)}
		onremotefolder={(parent, name) => createRemoteFolder(parent, name)}
		onremotefile={(folder, name) => createRemoteFile(folder, name)}
		onimportfiles={importWorkspaceFiles}
	/>
	{#if webdavConnection}
		<SaveAsDialog
			bind:open={saveAsOpen}
			openedToken={saveAsToken}
			initialName={editorName}
			folders={saveTree.folders}
			files={saveTree.files}
			rootId={saveTree.folders[0]?.id ?? webdavConnection.projectHref}
			busy={wwschoolSaveBusy}
			onsave={(folderId, filename) => void commitSaveAs(folderId, filename)}
		/>
	{/if}
	<Dialog.Root bind:open={collaborationOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Zusammenarbeit</Dialog.Title>
				<Dialog.Description>
					Dateinamen, Ordner, Tabs und Code werden Ende-zu-Ende-verschlüsselt geteilt. Beim
					Verbinden öffnet sich ein eigener Tab nur für die Sitzung; dein lokaler Editorstand bleibt
					getrennt. Der VPS sieht Verbindungsmetadaten wie Teilnehmende und Datenmenge; aktiver Tab,
					Cursor und Scrollposition bleiben lokal.
				</Dialog.Description>
			</Dialog.Header>
			{#if collaborationConnected}
				{#if collaborationRole === 'host'}
					<div class="grid gap-3 rounded-lg border p-3">
						<div class="grid gap-1">
							<Label for="collaboration-passphrase">Sechs-Wörter-Code</Label>
							<input
								id="collaboration-passphrase"
								readonly
								value={collaborationPassphrase}
								class="h-9 rounded-md border bg-muted px-2.5 font-mono text-sm"
							/>
						</div>
						<Button type="button" variant="outline" onclick={() => void copyCollaborationCode()}
							>Code kopieren</Button
						>
					</div>
				{:else}
					<p class="rounded-lg border p-3 text-sm">Mit der Sitzung verbunden.</p>
				{/if}
				<p class="text-xs text-muted-foreground">
					Teile den Code nur mit Teilnehmenden. Der Relay sieht die Sitzungskennung und
					Verbindungsmetadaten, aber keinen Workspace-Klartext.
				</p>
				<Button type="button" variant="destructive" onclick={leaveCollaboration}
					>Zusammenarbeit beenden</Button
				>
			{:else if collaborationBusy}
				<p class="text-sm" aria-live="polite">Verbindung wird aufgebaut …</p>
				{#if collaborationError}<p class="text-sm text-destructive" role="alert">
						{collaborationError}
					</p>{/if}
			{:else}
				{#if collaborationError}<p class="text-sm text-destructive" role="alert">
						{collaborationError}
					</p>{/if}
				<Button type="button" onclick={() => beginCollaboration('host')}>Sitzung starten</Button>
				<div class="grid gap-2 border-t pt-3">
					<Label for="collaboration-code-input">Sechs-Wörter-Code</Label>
					<input
						id="collaboration-code-input"
						bind:value={collaborationJoinCode}
						class="h-9 rounded-md border bg-transparent px-2.5 font-mono text-sm"
						autocomplete="off"
						placeholder="Wort1 Wort2 Wort3 Wort4 Wort5 Wort6"
					/>
					<Button type="button" variant="outline" onclick={() => beginCollaboration('guest')}
						>Verbinden</Button
					>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
	<AlertDialog.Root
		open={pendingCloseTabId !== null || pendingCloseShare}
		onOpenChange={(open) => {
			if (!open) {
				pendingCloseTabId = null;
				pendingCloseShare = false;
			}
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Ungespeicherte Datei schließen?</AlertDialog.Title>
				<AlertDialog.Description>
					{pendingCloseShare
						? 'geteilt.py ist noch nicht gespeichert. Beim Schließen wird dieser Tab entfernt.'
						: `„${workspace.files.find((file) => file.id === pendingCloseTabId)?.name ?? 'Diese Datei'}“ ist noch nicht nach wwschool gelegt oder heruntergeladen. Der Tab wird geschlossen; die Datei bleibt im Projekt.`}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Abbrechen</AlertDialog.Cancel>
				<AlertDialog.Action variant="destructive" onclick={confirmClosePendingTab}
					>Schließen</AlertDialog.Action
				>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
	<Dialog.Root
		bind:open={loginOpen}
		onOpenChange={(open) => {
			if (!open) {
				loginPassword = '';
				loginError = '';
				filesAfterLogin = false;
				saveAfterLogin = false;
			}
		}}
	>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>Bei wwschool anmelden</Dialog.Title>
				<Dialog.Description>
					Deine Dateien bleiben in diesem Browser. Speichern legt sie im Ordner {CODER_FOLDER_NAME}
					in deiner Dateiablage ab.
				</Dialog.Description>
			</Dialog.Header>
			<form class="grid gap-4" onsubmit={submitWebDavLogin}>
				<div class="grid gap-2">
					<Label for="wwschool-username">E-Mail-Adresse</Label>
					<input
						class="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
						id="wwschool-username"
						bind:value={loginUsername}
						autocomplete="username"
						required
						disabled={loginBusy}
					/>
				</div>
				<div class="grid gap-2">
					<Label for="wwschool-password">Passwort</Label>
					<input
						class="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
						id="wwschool-password"
						type="password"
						bind:value={loginPassword}
						autocomplete="current-password"
						required
						disabled={loginBusy}
					/>
				</div>
				<label class="stay-logged" for="wwschool-stay">
					<input
						id="wwschool-stay"
						type="checkbox"
						bind:checked={loginStay}
						disabled={loginBusy || !persistentCredentialStorage}
					/>
					<span>Angemeldet bleiben</span>
				</label>
				<p class="text-xs text-muted-foreground">
					{persistentCredentialStorage
						? 'Ohne Haken gilt die Anmeldung nur für diese Sitzung.'
						: 'Über die IP-Adresse gilt die Anmeldung nur für diesen Tab.'}
				</p>
				{#if loginError}
					<p class="text-sm text-destructive" role="alert">{loginError}</p>
				{/if}
				<div class="grid gap-1">
					<Button type="submit" disabled={loginBusy}>
						{#if loginBusy}<LoaderCircle class="animate-spin" />{/if}
						{loginBusy ? 'Anmelden …' : 'Anmelden'}
					</Button>
					{#if !saveAfterLogin}
						<Button
							type="button"
							variant="ghost"
							size="xs"
							disabled={loginBusy}
							onclick={continueLocally}
						>
							Lokal weiterarbeiten
						</Button>
					{/if}
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Root>
	<NewFileDialog bind:open={createOpen} oncreate={createNamedFile} />
	<WelcomeDialog
		open={!viewingShare && !workspace.welcomed}
		{theme}
		ontheme={applyTheme}
		onstart={finishWelcome}
	/>
	<Dialog.Root
		bind:open={docsOpen}
		onOpenChange={(open) => {
			if (!open) docsFocusId = '';
		}}
	>
		<Dialog.Content
			class="docs-popup top-[max(1rem,8vh)] right-[max(1rem,8vw)] bottom-[max(1rem,8vh)] left-[max(1rem,8vw)] h-auto max-h-none w-auto max-w-none translate-x-0 translate-y-0"
			showCloseButton={false}
		>
			<Dialog.Title class="sr-only">Doku</Dialog.Title>
			<Dialog.Description class="sr-only">Erklärungen zu den Dateitypen.</Dialog.Description>
			<button
				type="button"
				class="docs-close"
				aria-label="Schließen"
				onclick={() => (docsOpen = false)}
			>
				<X />
			</button>
			{#if docsOpen}
				{#await import('#lib/docs/docs-browser.svelte') then { default: DocsBrowser }}
					<DocsBrowser fill language={docsLanguage} focusId={docsFocusId} />
				{/await}
			{/if}
		</Dialog.Content>
	</Dialog.Root>
	<Dialog.Root bind:open={versionsOpen}>
		<Dialog.Content
			class="flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-md"
		>
			<Dialog.Header>
				<Dialog.Title>Versionen</Dialog.Title>
				<Dialog.Description>Die Laufzeiten, die deinen Code ausführen.</Dialog.Description>
			</Dialog.Header>
			<div class="versions">
				<p>
					<span>Python</span>
					<span>{pythonStatus}</span>
				</p>
			</div>
		</Dialog.Content>
	</Dialog.Root>

	<AlertDialog.Root bind:open={clearOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Code löschen?</AlertDialog.Title>
				<AlertDialog.Description>
					Der Inhalt von {activeFile?.name ?? 'dieser Datei'} wird gelöscht. Die Datei bleibt im Workspace.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Abbrechen</AlertDialog.Cancel>
				<AlertDialog.Action variant="destructive" onclick={clearCode}
					>Code löschen</AlertDialog.Action
				>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}

{#snippet editor()}
	<div class="editor-tabs">
		<div class="pane-header">
			<div class="file-tabs" role="tablist" aria-label="Geöffnete Dateien">
				{#if sharedCode !== null}
					<div class="file-tab" class:active={pane === 'code' && viewingShare}>
						<button
							type="button"
							role="tab"
							class="tab-name"
							aria-selected={pane === 'code' && viewingShare}
							title={shareDirty ? 'Geteilte Datei ist nicht gespeichert' : 'Geteilte Datei'}
							onclick={showShare}
						>
							geteilt.py
							{#if shareDirty}
								<i class="dirty-mark" aria-hidden="true"></i>
								<em>Nicht gespeichert</em>
							{/if}
						</button>
						<button
							type="button"
							class="tab-close"
							aria-label="Geteilte Datei schließen"
							onclick={requestCloseShare}
						>
							<X />
						</button>
					</div>
				{/if}
				{#each openFiles as file (file.id)}
					<div
						class="file-tab"
						class:active={pane === 'code' && !viewingShare && file.id === activeFile?.id}
					>
						<button
							type="button"
							role="tab"
							class="tab-name"
							aria-selected={pane === 'code' && !viewingShare && file.id === activeFile?.id}
							onclick={() => showFile(file.id)}
						>
							{file.name}
							{#if dirtyFileIds.has(file.id) || collaborationFileIds.includes(file.id)}
								<i
									class="dirty-mark"
									class:collaboration-mark={collaborationFileIds.includes(file.id)}
									aria-hidden="true"
								></i>
								{#if dirtyFileIds.has(file.id)}
									<span class="sr-only">Ungespeichert</span>
								{/if}
							{/if}
						</button>
						<button
							type="button"
							class="tab-close"
							aria-label="{file.name} schließen"
							onclick={() => requestCloseTab(file.id)}
						>
							<X />
						</button>
					</div>
				{/each}
				<button
					type="button"
					class="tab-plus"
					aria-label="Neue Datei"
					title="Neue Datei"
					onclick={() => (createOpen = true)}
				>
					<Plus />
				</button>
			</div>
			<ButtonGroup.Root aria-label="Code bearbeiten">
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={undo}
					disabled={!canUndo || editorEmpty}
					aria-label="Rückgängig"
					title="Rückgängig"><Undo2 /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={redo}
					disabled={!canRedo || editorEmpty}
					aria-label="Wiederholen"
					title="Wiederholen"><Redo2 /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => (clearOpen = true)}
					disabled={editorEmpty}
					aria-label="Code löschen"
					title="Code löschen"><Trash2 /></Button
				>
			</ButtonGroup.Root>
		</div>
		<div class="tab-content" hidden={pane !== 'code'}>
			{#if editorEmpty}
				<div class="problems-empty" role="status">
					{#if collaborationRole === 'guest' && !collaborationConnected}
						<p>Keine Datei geöffnet</p>
						<p class="muted">Die gemeinsame Sitzung wird verbunden …</p>
					{:else}
						<p>Keine Datei geöffnet</p>
						<p class="muted">
							{collaborationRole
								? 'Erstelle eine Datei, um in der Sitzung weiterzuarbeiten.'
								: 'Erstelle eine Datei, um im Editor weiterzuschreiben.'}
						</p>
						<Button type="button" onclick={() => (createOpen = true)}>Datei erstellen</Button>
					{/if}
				</div>
			{:else}
				<CodeEditor
					bind:this={codeEditor}
					fileId={editorFileId}
					value={editorCode}
					language={codeLanguage(editorName)}
					{diagnostics}
					{theme}
					wrapLines={narrow}
					visible={pane === 'code'}
					sharedText={editorSharedText}
					onchange={editActiveFile}
					onopendocs={openDocs}
					onhistory={(state) => {
						canUndo = state.canUndo;
						canRedo = state.canRedo;
					}}
				/>
			{/if}
		</div>
		{#if pane === 'problems'}
			<div class="problems-content">
				{#if lintError}
					<div class="problems-empty">
						<p>Prüfung nicht verfügbar</p>
					</div>
				{:else if diagnostics.length === 0}
					<div class="problems-empty">
						<p>Keine Probleme</p>
						<p class="muted">Sie erscheinen hier, sobald der Code etwas zu beanstanden hat.</p>
					</div>
				{:else}
					<div class="problems-list">
						<ul>
							{#each diagnostics as diagnostic (`${diagnostic.start_location.row}:${diagnostic.start_location.column}:${diagnostic.code}:${diagnostic.message}`)}
								{@const excerpt = lineExcerpt(editorCode, diagnostic)}
								<li>
									<button
										type="button"
										class="problem-row"
										onclick={() => showLinkedProblem(diagnostic)}
									>
										<span class="problem-meta">
											Zeile {diagnostic.start_location.row}:{diagnostic.start_location.column}
										</span>
										<span class="problem-detail">{diagnostic.message}</span>
										<pre class="problem-source"><code>{excerpt.line || ' '}</code
											>{#if excerpt.mark}<code class="problem-mark">{excerpt.mark}</code>{/if}</pre>
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
		<div class="editor-bar">
			<button
				type="button"
				class="problems-toggle"
				aria-pressed={pane === 'problems'}
				onclick={toggleProblems}
			>
				Probleme
				{#if diagnostics.length}<Badge variant="secondary">{diagnostics.length}</Badge>{/if}
			</button>
		</div>
	</div>
{/snippet}

{#snippet consoleBody()}
	<div class="console-scroll" bind:this={consoleViewport}>
		{#if fileConsole.length === 0}
			<div class="console-empty">
				<p>Keine Ausgabe</p>
				<p class="muted">
					{previewing
						? 'Meldungen der Vorschau erscheinen hier.'
						: 'Sie erscheint hier, sobald du den Code ausführst.'}
				</p>
			</div>
		{:else}
			<ol class="console-log" aria-live="polite">
				{#each fileConsole as block (block.id)}
					<li class="console-block" class:run={block.kind === 'run'} class:failed={block.failed}>
						<div class="console-title">
							<span>{block.title}</span>
							<button
								type="button"
								class="console-dismiss"
								aria-label="Ausgabe entfernen"
								title="Ausgabe entfernen"
								disabled={pendingPythonInput !== null && pendingPythonInput === block.runId}
								onclick={() => dismissConsole(block.id)}><X /></button
							>
						</div>
						{#if block.stdout}
							<div class="console-line">
								<pre class="console-out">{block.stdout}</pre>
								{#if block.line}
									<Button
										variant="outline"
										size="xs"
										onclick={() => revealConsoleLine(block)}
										title="Im Editor zeigen">Wo?</Button
									>
								{/if}
							</div>
						{/if}
						{#if block.stderr}
							<div class="console-err">
								<pre class="console-err-text">{block.stderr}</pre>
								{#if block.line || consoleWhere(block)}
									<Button
										variant="outline"
										size="xs"
										onclick={() => revealConsoleLine(block)}
										title="Im Editor zeigen">Wo?</Button
									>
								{/if}
							</div>
						{/if}
						{#if block.status || block.finishedAt}
							<p class="console-status">
								<span>{block.status}</span>
								{#if block.finishedAt}<time>{block.finishedAt}</time>{/if}
							</p>
						{/if}
						{#if pendingPythonInput !== null && pendingPythonInput === block.runId}
							<form class="console-input" onsubmit={submitConsoleInput}>
								<label for="python-console-input">Eingabe für Python</label>
								<input
									id="python-console-input"
									bind:this={pythonInputElement}
									bind:value={pythonInputValue}
									autocomplete="off"
									spellcheck="false"
								/>
								<button type="submit">Senden</button>
							</form>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/snippet}

{#snippet preview()}
	<div class="preview-stage">
		<button
			type="button"
			class="preview-collapse"
			onclick={() => (terminalCollapsed = true)}
			aria-label="Vorschau einklappen"
			title="Vorschau einklappen"><ChevronRight /></button
		>
		{#if previewDoc}
			<iframe
				title="Vorschau"
				sandbox="allow-scripts allow-forms allow-popups allow-modals"
				referrerpolicy="no-referrer"
				srcdoc={previewDoc}
			></iframe>
		{/if}
	</div>
	{#if isHtml && previewConsoleOpen}
		<div class="preview-console">
			<div class="pane-header console-split-header">
				<h2>Konsole</h2>
				<ButtonGroup.Root aria-label="Konsole steuern">
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={clearConsole}
						aria-label="Konsole löschen"
						title="Konsole löschen"><Trash2 /></Button
					>
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => (previewConsoleOpen = false)}
						aria-label="Konsole einklappen"
						title="Konsole einklappen"><ChevronDown /></Button
					>
				</ButtonGroup.Root>
			</div>
			{@render consoleBody()}
		</div>
	{:else if isHtml}
		<button
			type="button"
			class="console-row"
			onclick={openPreviewConsole}
			aria-expanded="false"
			aria-label="Konsole einblenden"
			title="Konsole einblenden"
		>
			<ChevronUp />
			<span>Konsole</span>
		</button>
	{/if}
{/snippet}

{#snippet terminal()}
	<div class="pane-header">
		<h2>{visualizerEnabled && isPython ? 'Programmablauf' : 'Ausgabe'}</h2>
		<ButtonGroup.Root aria-label="Ausgabe steuern">
			{#if isPython}
				<Button
					variant={visualizerEnabled ? 'secondary' : 'ghost'}
					size="sm"
					aria-pressed={visualizerEnabled}
					aria-label={visualizerEnabled ? 'Programmausgabe anzeigen' : 'Programm visualisieren'}
					title={visualizerEnabled ? 'Programmausgabe anzeigen' : 'Programm visualisieren'}
					onclick={() => (visualizerEnabled = !visualizerEnabled)}
					><Blocks /><span>Visualisieren</span></Button
				>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				onclick={clearConsole}
				aria-label="Ausgabe löschen"
				title="Ausgabe löschen. Verlauf bis zum Neuladen"><Trash2 /></Button
			>
			<Button
				variant="ghost"
				size="icon-sm"
				onclick={() => (terminalCollapsed = true)}
				aria-label="Ausgabe einklappen"
				title="Ausgabe einklappen"><ChevronRight /></Button
			>
		</ButtonGroup.Root>
	</div>
	{#if visualizerEnabled && isPython}
		<ProgramVisualizer code={editorCode} outputs={visualizerOutputs} />
	{:else}
		{@render consoleBody()}
	{/if}
	<footer>{visualizerEnabled && isPython ? 'Live aktualisiert' : 'Cmd/Strg + Enter'}</footer>
{/snippet}

{#if notice}<div class="notice" role="status">{notice}</div>{/if}

<style>
	:global(html),
	:global(body) {
		height: 100%;
		overflow: hidden;
	}
	:global(body) {
		margin: 0;
		min-width: 320px;
	}
	.boot {
		display: grid;
		min-height: 100dvh;
		place-items: center;
		color: var(--muted-foreground);
		font-size: 0.82rem;
	}
	.app-shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr);
		width: 100%;
		min-width: 0;
		height: 100dvh;
		max-height: 100dvh;
		overflow: hidden;
		background: var(--background);
		color: var(--foreground);
	}
	.topbar,
	.toolbar,
	.pane-header,
	footer,
	.muted,
	.file-tabs,
	.file-tab,
	.tab-name {
		display: flex;
		align-items: center;
	}
	.topbar {
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
		min-height: 3.25rem;
		padding: 0.55rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	h2,
	p {
		margin: 0;
	}
	footer,
	.muted {
		color: var(--muted-foreground);
		font-size: 0.71rem;
	}
	.toolbar {
		justify-content: flex-end;
		gap: 0.4rem;
	}
	.settings {
		display: grid;
		gap: 0.7rem;
	}
	.settings-label {
		margin: 0;
		color: var(--muted-foreground);
		font: 650 0.68rem/1.3 var(--font-sans);
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.settings-email {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 500 0.78rem/1.3 var(--font-sans);
	}
	.settings-note,
	.settings-error {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.3;
	}
	.settings-note {
		color: var(--muted-foreground);
	}
	.stay-logged {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.stay-logged input {
		width: 0.95rem;
		height: 0.95rem;
		accent-color: var(--foreground);
	}
	:global(.run-busy) {
		background: color-mix(in oklch, var(--background) 72%, black) !important;
		color: var(--muted-foreground) !important;
		opacity: 1 !important;
	}
	.dirty-mark {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: oklch(0.72 0.16 70);
	}
	.collaboration-mark {
		background: oklch(0.62 0.19 250);
	}
	.workspace {
		display: flex;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.workspace > .editor-pane {
		flex: 1 1 auto;
	}
	.editor-pane,
	.terminal-pane {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.editor-tabs {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.pane-header {
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 3.25rem;
		padding: 0.45rem 0.8rem;
		border-bottom: 1px solid var(--border);
	}
	.pane-header h2 {
		font: 600 0.8rem/1 var(--font-code);
	}
	.file-tabs {
		gap: 0.15rem;
		min-width: 0;
		overflow-x: auto;
	}
	.file-tab {
		gap: 0.05rem;
		flex: 0 0 auto;
		border-bottom: 2px solid transparent;
		color: var(--muted-foreground);
	}
	.file-tab.active {
		border-bottom-color: var(--foreground);
		color: var(--foreground);
	}
	.tab-name {
		gap: 0.35rem;
		min-height: 2rem;
		padding: 0 0.35rem;
		border: 0;
		background: transparent;
		color: inherit;
		font: 500 0.8rem/1 var(--font-sans);
		cursor: pointer;
	}
	.tab-name em {
		color: var(--muted-foreground);
		font-style: normal;
		font-size: 0.65rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.tab-close {
		display: grid;
		width: 1.15rem;
		height: 1.15rem;
		place-items: center;
		border: 0;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.tab-close:hover,
	.tab-plus:hover {
		background: var(--muted);
	}
	.tab-plus {
		display: grid;
		width: 1.7rem;
		height: 1.7rem;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	:global(.tab-close svg),
	:global(.tab-plus svg) {
		width: 0.85rem;
		height: 0.85rem;
	}
	.tab-content {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.tab-content[hidden] {
		display: none;
	}
	.tab-content :global(.code-host) {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.problems-content {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.problems-empty {
		display: grid;
		flex: 1;
		place-items: center;
		align-content: center;
		gap: 0.3rem;
		padding: 1.25rem;
		text-align: center;
	}
	.problems-empty p {
		margin: 0;
		font: 600 0.84rem/1.3 var(--font-sans);
		color: var(--foreground);
	}
	.problems-empty .muted {
		font-weight: 400;
		color: var(--muted-foreground);
	}
	.problems-empty :global(button) {
		margin-top: 0.55rem;
	}
	.problems-list {
		min-height: 0;
		overflow: auto;
		padding: 0.5rem;
	}
	.problems-content ul {
		display: grid;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.problem-row {
		display: grid;
		gap: 0.28rem;
		width: 100%;
		padding: 0.65rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		background: color-mix(in oklch, var(--muted) 28%, var(--background));
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.problem-row:hover {
		border-color: color-mix(in oklch, var(--foreground) 25%, var(--border));
	}
	.problem-meta,
	.problem-detail {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.problem-meta {
		color: var(--muted-foreground);
		font-size: 0.7rem;
	}
	.problem-detail {
		font-size: 0.8rem;
	}
	.problem-source {
		display: grid;
		margin: 0.15rem 0;
		padding: 0.4rem 0.55rem;
		overflow-x: auto;
		border-radius: 0.35rem;
		background: var(--background);
		font: 400 0.76rem/1.45 var(--font-code);
		font-variant-ligatures: contextual;
		font-feature-settings:
			'calt' 1,
			'liga' 1;
	}
	.problem-source code {
		white-space: pre;
	}
	.problem-mark {
		color: var(--destructive);
	}
	.editor-bar {
		display: flex;
		align-items: center;
		min-height: 2.15rem;
		padding: 0 0.35rem;
		border-top: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 35%, var(--background));
	}
	.problems-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 1.7rem;
		padding: 0 0.55rem;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--muted-foreground);
		font: 600 0.75rem/1 var(--font-sans);
		cursor: pointer;
	}
	.problems-toggle[aria-pressed='true'] {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.terminal-pane {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		overflow: hidden;
		background: color-mix(in oklch, var(--muted) 22%, var(--background));
	}
	.terminal-pane.previewing {
		grid-template-rows: minmax(0, 1fr);
		background: var(--background);
	}
	.terminal-pane.previewing.with-console {
		grid-template-rows: minmax(0, 1fr) auto;
	}
	.terminal-pane.previewing.console-open {
		grid-template-rows: minmax(0, 1fr) minmax(9rem, 42%);
	}
	.script-runner {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		border: 0;
		opacity: 0;
		pointer-events: none;
	}
	.preview-stage {
		position: relative;
		min-width: 0;
		min-height: 0;
		background: #fff;
	}
	.preview-collapse {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		z-index: 2;
		display: grid;
		width: 1.7rem;
		height: 1.7rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		background: color-mix(in oklch, #fff 88%, transparent);
		color: #1a1a1a;
		cursor: pointer;
	}
	.preview-collapse :global(svg) {
		width: 1rem;
		height: 1rem;
	}
	.preview-stage iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: #fff;
	}
	.preview-console {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
		border-top: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 22%, var(--background));
	}
	.console-split-header {
		min-height: 2.3rem;
	}
	.console-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		min-height: 2.35rem;
		padding: 0 0.8rem;
		border: 0;
		border-top: 1px solid var(--border);
		background: var(--secondary);
		color: var(--foreground);
		font: 600 0.78rem/1 var(--font-sans);
		cursor: pointer;
	}
	.console-row:hover {
		background: color-mix(in oklch, var(--foreground) 7%, var(--secondary));
	}
	.console-row :global(svg) {
		width: 1rem;
		height: 1rem;
	}
	.console-scroll {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: auto;
	}
	.console-empty {
		display: grid;
		flex: 1;
		place-items: center;
		align-content: center;
		gap: 0.3rem;
		padding: 1.25rem;
		text-align: center;
	}
	.console-empty p {
		margin: 0;
		font: 600 0.84rem/1.3 var(--font-sans);
		color: var(--foreground);
	}
	.console-empty .muted {
		font-weight: 400;
		color: var(--muted-foreground);
	}
	.console-log {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.console-block {
		border: 1px solid var(--border);
		border-left: 3px solid var(--muted-foreground);
		border-radius: 0;
		background: var(--background);
	}
	.console-block.run {
		border-left-color: var(--foreground);
	}
	.console-block.failed {
		border-left-color: var(--destructive);
	}
	.console-title,
	.console-status {
		margin: 0;
	}
	.console-input {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.45rem;
		padding: 0.65rem 0.75rem;
		border-top: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 35%, var(--background));
	}
	.console-input label {
		grid-column: 1 / -1;
		color: var(--muted-foreground);
		font: 550 0.72rem/1.3 var(--font-sans);
	}
	.console-input input {
		min-width: 0;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 0;
		background: var(--background);
		color: var(--foreground);
		font: 400 0.82rem/1.4 var(--font-code);
	}
	.console-input button {
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--foreground);
		border-radius: 0;
		background: var(--foreground);
		color: var(--background);
		font: 550 0.74rem/1.4 var(--font-sans);
		cursor: pointer;
	}
	.console-title {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0.35rem 0.35rem 0.7rem;
		color: var(--muted-foreground);
		font: 600 0.74rem/1.35 var(--font-code);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.console-dismiss {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 1.45rem;
		height: 1.45rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.console-dismiss:hover {
		color: var(--foreground);
	}
	.console-dismiss :global(svg) {
		width: 0.85rem;
		height: 0.85rem;
	}
	.console-block.run .console-title,
	.console-block.failed .console-title {
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 65%, var(--background));
		color: var(--foreground);
	}
	.console-out,
	.console-err {
		margin: 0;
		padding: 0.65rem 0.75rem 0.7rem;
		font: 400 0.82rem/1.55rem var(--font-code);
		font-variant-ligatures: contextual;
		font-feature-settings:
			'calt' 1,
			'liga' 1;
		word-break: break-word;
	}
	.console-out {
		color: color-mix(in oklch, var(--foreground) 92%, var(--muted-foreground));
		white-space: pre-wrap;
	}
	.console-err {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.55rem;
		color: var(--destructive);
		background: color-mix(in oklch, var(--destructive) 8%, var(--background));
	}
	.console-err-text {
		margin: 0;
		font: inherit;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.console-line {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.65rem 0.75rem 0.7rem;
	}
	.console-line .console-out {
		padding: 0;
	}
	.console-line + .console-err {
		border-top: 1px dashed color-mix(in oklch, var(--destructive) 45%, var(--border));
	}
	.console-status {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.35rem 0.75rem 0.45rem;
		border-top: 1px solid var(--border);
		color: var(--muted-foreground);
		font: 550 0.7rem/1.3 var(--font-sans);
	}
	.console-status time {
		flex: 0 0 auto;
		font-variant-numeric: tabular-nums;
		font-family: var(--font-code);
		font-weight: 500;
	}
	footer {
		justify-content: flex-end;
		min-height: 2.3rem;
		padding: 0.45rem 0.8rem;
		border-top: 1px solid var(--border);
	}
	.terminal-rail {
		display: flex;
		width: 2.75rem;
		flex: 0 0 2.75rem;
		border-left: 1px solid var(--border);
		background: var(--secondary);
	}
	.rail-toggle {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--foreground);
		cursor: pointer;
	}
	.rail-toggle:hover {
		background: color-mix(in oklch, var(--foreground) 7%, transparent);
	}
	.rail-toggle :global(svg) {
		width: 1rem;
		height: 1rem;
	}
	.rail-label {
		display: none;
	}
	.notice {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 50;
		max-width: 24rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: 0 10px 26px oklch(0 0 0 / 14%);
		font-size: 0.78rem;
	}
	:global(.docs-popup) {
		top: max(1rem, 8vh, env(safe-area-inset-top, 0px) + 0.75rem) !important;
		right: max(1rem, 8vw, env(safe-area-inset-right, 0px) + 0.75rem) !important;
		bottom: max(1rem, 8vh, env(safe-area-inset-bottom, 0px) + 0.75rem) !important;
		left: max(1rem, 8vw, env(safe-area-inset-left, 0px) + 0.75rem) !important;
		display: flex !important;
		flex-direction: column;
		width: auto !important;
		height: auto !important;
		max-width: none !important;
		max-height: none !important;
		transform: none !important;
		translate: none !important;
		gap: 0;
		padding: 0 !important;
		overflow: hidden;
		animation: none !important;
	}
	:global(.docs-popup .docs-close) {
		position: absolute;
		top: 0.7rem;
		right: 0.7rem;
		z-index: 40;
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--background);
		color: var(--foreground);
		cursor: pointer;
	}
	:global(.docs-popup .docs-close:hover) {
		background: color-mix(in oklch, var(--foreground) 6%, var(--background));
	}
	:global(.docs-popup .docs-close:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	:global(.docs-popup .docs-close svg) {
		width: 1rem;
		height: 1rem;
	}
	:global(.docs-popup .browser) {
		flex: 1 1 auto;
		min-height: 0;
	}
	.versions {
		display: grid;
		gap: 0.9rem;
		min-height: 0;
		overflow: auto;
		padding-right: 0.15rem;
	}
	.versions p {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin: 0;
		font: 500 0.75rem/1.45 var(--font-code);
	}
	.versions p span:first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.versions p span:last-child {
		flex: 0 0 auto;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	@media (max-width: 899px) {
		.topbar {
			gap: 0.45rem;
			min-height: 0;
			padding: calc(0.4rem + env(safe-area-inset-top)) 0.6rem 0.4rem;
		}
		.topbar > :global(:first-child) {
			flex: 0 0 auto;
		}
		.action-label {
			display: none;
		}
		:global(.files-button) {
			position: relative;
		}
		:global(.files-button .dirty-mark) {
			position: absolute;
			top: 0.28rem;
			right: 0.28rem;
		}
		.toolbar {
			min-width: 0;
			flex: 1 1 auto;
			justify-content: flex-start;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
		}
		.toolbar::-webkit-scrollbar {
			display: none;
		}
		.workspace {
			flex-direction: column;
		}
		.workspace > .editor-pane {
			flex: 1 1 auto;
			height: auto;
			min-height: 0;
		}
		.workspace :global([data-slot='resizable-pane-group']) {
			min-height: 0;
			flex: 1 1 auto;
			flex-direction: column !important;
		}
		.workspace :global([data-slot='resizable-handle']) {
			width: 100% !important;
			height: 0.75rem !important;
			flex: 0 0 0.75rem !important;
		}
		.workspace :global([data-slot='resizable-handle'] > div) {
			transform: rotate(90deg);
		}
		.terminal-pane {
			border-top: 1px solid var(--border);
		}
		.terminal-pane footer {
			display: none;
		}
		.terminal-pane :global([aria-label='Ausgabe einklappen'] svg),
		.terminal-pane :global([aria-label='Vorschau einklappen'] svg) {
			transform: rotate(90deg);
		}
		.terminal-rail {
			width: 100%;
			height: calc(2.75rem + env(safe-area-inset-bottom));
			flex: 0 0 auto;
			border-top: 1px solid var(--border);
			border-left: 0;
			padding-bottom: env(safe-area-inset-bottom);
		}
		.terminal-rail :global(svg) {
			transform: rotate(90deg);
		}
		.rail-label {
			display: inline;
			font: 600 0.78rem/1 var(--font-sans);
		}
		.notice {
			right: 0.6rem;
			bottom: calc(0.6rem + env(safe-area-inset-bottom));
			left: 0.6rem;
			max-width: none;
		}
	}
</style>
