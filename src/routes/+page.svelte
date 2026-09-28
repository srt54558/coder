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
	import X from '@lucide/svelte/icons/x';
	import FilesExplorer from '$lib/components/files-explorer.svelte';
	import NewFileDialog from '$lib/components/new-file-dialog.svelte';
	import WelcomeDialog from '$lib/components/welcome-dialog.svelte';
	import CodeEditor from '$lib/components/code-editor.svelte';
	import { takeDocsPopup } from '$lib/docs/popup';
	import { languageForLessonId } from '$lib/docs/lookup';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import type { RuffDiagnostic, RuffWorkerMessage, RunnerStatus } from '$lib/runner/protocol';
	import { lineExcerpt } from '$lib/editor/explain';
	import {
		editorLineForPreview,
		previewDocument,
		previewFileFromUrl,
		readPreviewDone,
		readPreviewMessage,
		readPreviewRequest,
		scriptDocument,
		scriptLineOffset
	} from '$lib/editor/preview';
	import { resolveProjectPath } from '$lib/editor/links';
	import { consoleSegments, matchProblem } from '$lib/runner/console-links';
	import { clipBlocks, clipText } from '$lib/runner/limits';
	import {
		disposePython,
		holdPython,
		runPython,
		stopPython,
		watchPythonHost
	} from '$lib/runner/python-host';
	import { canShareCode, createShareUrl, decodeCode, IMPORT_PARAM } from '$lib/runner/share';
	import { WORKSPACE_ARCHIVE_NAME, workspaceExport } from '$lib/workspace/archive';
	import { loadWorkspace, saveWorkspace, writeWorkspaceBackup } from '$lib/workspace/database';
	import {
		clearWebDavCredentials,
		connectWebDav,
		hashWorkspace,
		hasSessionWebDavCredentials,
		isEmptyWorkspace,
		loadWebDavCredentials,
		loadWebDavSyncState,
		probeWebDavWorkspace,
		readWebDavWorkspace,
		rememberWebDavCredentials,
		saveWebDavSyncState,
		WebDavConflictError,
		WebDavError,
		writeWebDavWorkspace,
		type RemoteWorkspace,
		type WebDavConnection,
		type WebDavCredentials,
		type WebDavSyncState
	} from '$lib/workspace/webdav';
	import {
		closeFile,
		structureSignature,
		applyWelcomeChoice,
		createFile,
		createInitialWorkspace,
		codeLanguage,
		fileMime,
		hasUnsavedChanges,
		importFiles,
		isHtmlFile,
		isPythonFile,
		LEGACY_STORAGE_KEY,
		openFile,
		projectDirectory,
		projectFilePath,
		projectFiles,
		selectFolder,
		updateFileContent,
		type WelcomeLanguage,
		type WorkspaceFile,
		type WorkspaceSnapshot
	} from '$lib/workspace/model';
	import { applyDocumentTheme, isDarkTheme, parseTheme, type AppTheme } from '$lib/theme';

	const RUN_TIMEOUT_MS = 15_000;
	const SAVE_DELAY_MS = 250;
	const REMOTE_SYNC_DELAY_MS = 400;
	const REMOTE_POLL_MS = 2_500;
	const LOCAL_ONLY_KEY = 'kplus-coder-local-only';
	const SHARED_PREVIEW_ID = 'shared-preview';

	let workspace = $state(createInitialWorkspace());
	let hydrated = $state(false);
	let savedSignature = $state('');
	let savedContents = $state<Record<string, string>>({});
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
	type SyncStatus = 'local' | 'connecting' | 'syncing' | 'synced' | 'conflict' | 'error';
	type SyncConflict = {
		local: WorkspaceSnapshot;
		remote: RemoteWorkspace | null;
		connection: WebDavConnection;
		message: string;
	};
	let syncStatus = $state<SyncStatus>('local');
	let syncError = $state('');
	let webdavCredentials = $state<WebDavCredentials | null>(null);
	let webdavConnection = $state<WebDavConnection | null>(null);
	let webdavSyncState = $state<WebDavSyncState | null>(null);
	let syncConflict = $state<SyncConflict | null>(null);
	let conflictOpen = $state(false);
	let filesAfterConflict = false;
	let filesAfterLogin = false;
	let loginOpen = $state(false);
	let loginUsername = $state('');
	let loginPassword = $state('');
	let loginStay = $state(true);
	let loginBusy = $state(false);
	let loginError = $state('');
	let webdavRemembered = $state(false);
	let remoteSyncTimer: ReturnType<typeof setTimeout> | undefined;
	let remotePollTimer: ReturnType<typeof setInterval> | undefined;
	let remoteSyncQueue: Promise<void> = Promise.resolve();
	let announceRemoteSave = false;
	let explorerToken = $state(0);
	let sharedCode = $state<string | null>(null);
	let viewingShare = $state(false);
	let saveChooser = $state(false);
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
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveTicket = 0;
	let saveQueue: Promise<unknown> = Promise.resolve();
	let saveErrorAnnounced = false;
	let runFileId = '';
	let lintedFileId = '';
	let createOpen = $state(false);

	const activeFile = $derived(
		workspace.files.find((file) => file.id === workspace.activeFileId) ?? workspace.files[0]
	);
	const fileCode = $derived(activeFile?.content ?? '');
	const editorCode = $derived(viewingShare && sharedCode !== null ? sharedCode : fileCode);
	const editorFileId = $derived(viewingShare ? SHARED_PREVIEW_ID : (activeFile?.id ?? ''));
	const editorName = $derived(viewingShare ? 'geteilt.py' : (activeFile?.name ?? 'main.py'));
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
	const consoleFileId = $derived(previewTarget?.id ?? editorFileId);
	const fileConsole = $derived(consoleBlocks.filter((block) => block.fileId === consoleFileId));
	const isRunning = $derived(runnerStatus === 'running');
	const pythonLoading = $derived(isPython && runnerStatus === 'loading');
	const stopping = $derived((isJavaScript && scriptRunning) || (!showsPreview && isRunning));
	const dirty = $derived(hydrated && hasUnsavedChanges(workspace, savedSignature, savedContents));
	const dirtyFileIds = $derived(
		new Set(
			workspace.files
				.filter((file) => savedContents[file.id] !== file.content)
				.map((file) => file.id)
		)
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
		const fileId = consoleFileId;
		commitConsole(consoleBlocks.filter((block) => block.fileId !== fileId));
	}

	function dismissConsole(id: number) {
		commitConsole(consoleBlocks.filter((block) => block.id !== id));
	}

	function markSaved(snapshot: WorkspaceSnapshot) {
		savedSignature = structureSignature(snapshot);
		savedContents = Object.fromEntries(snapshot.files.map((file) => [file.id, file.content]));
	}

	function enqueueSave(
		snapshot: WorkspaceSnapshot,
		ticket: number,
		savedAt: number
	): Promise<boolean> {
		const job = saveQueue.then(async () => {
			if (ticket !== saveTicket) return true;
			try {
				await saveWorkspace(snapshot, savedAt);
				if (ticket !== saveTicket) return true;
				markSaved(snapshot);
				saveErrorAnnounced = false;
				return true;
			} catch {
				if (ticket === saveTicket && !saveErrorAnnounced) {
					saveErrorAnnounced = true;
					announce('Speichern im Browser ist fehlgeschlagen.');
				}
				return false;
			}
		});
		saveQueue = job.then(
			() => undefined,
			() => undefined
		);
		return job;
	}

	function flushWorkspace() {
		if (!hydrated) return;
		if (saveTimer) clearTimeout(saveTimer);
		const snapshot = $state.snapshot(workspace) as WorkspaceSnapshot;
		const ticket = ++saveTicket;
		const savedAt = writeWorkspaceBackup(snapshot);
		void enqueueSave(snapshot, ticket, savedAt);
	}

	function enqueueRemote(task: () => Promise<void>) {
		remoteSyncQueue = remoteSyncQueue.then(task, task);
	}

	function queueRemoteSync(snapshot: WorkspaceSnapshot) {
		if (
			!webdavCredentials ||
			!webdavConnection ||
			!webdavSyncState ||
			(syncStatus !== 'synced' && syncStatus !== 'syncing')
		) {
			return;
		}
		if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
		const copy = structuredClone(snapshot);
		remoteSyncTimer = setTimeout(() => {
			enqueueRemote(() => syncRemoteSnapshot(copy));
		}, REMOTE_SYNC_DELAY_MS);
	}

	function pushRemoteWorkspace(options?: { announce?: boolean }) {
		if (!webdavCredentials || !webdavConnection || !webdavSyncState) return;
		if (syncStatus === 'conflict') return;
		announceRemoteSave = Boolean(options?.announce);
		flushWorkspace();
		queueRemoteSync($state.snapshot(workspace) as WorkspaceSnapshot);
	}

	function queueRemotePull() {
		if (!webdavCredentials || !webdavConnection || syncStatus !== 'synced') return;
		enqueueRemote(() => pullRemoteWorkspace());
	}

	function stopRemoteWatch() {
		if (remotePollTimer) {
			clearInterval(remotePollTimer);
			remotePollTimer = undefined;
		}
	}

	function startRemoteWatch() {
		stopRemoteWatch();
		remotePollTimer = setInterval(() => {
			if (document.visibilityState !== 'visible') return;
			queueRemotePull();
		}, REMOTE_POLL_MS);
	}

	function nextSyncState(
		connection: WebDavConnection,
		hash: string,
		etag?: string | null
	): WebDavSyncState {
		return {
			...connection,
			lastSyncedHash: hash,
			lastSyncedEtag: etag || undefined
		};
	}

	async function syncRemoteSnapshot(snapshot: WorkspaceSnapshot) {
		const credentials = webdavCredentials;
		const connection = webdavConnection;
		const previous = webdavSyncState;
		if (!credentials || !connection || !previous || syncStatus === 'conflict') return;
		syncStatus = 'syncing';
		try {
			const remote = await writeWebDavWorkspace(
				credentials,
				connection,
				snapshot,
				previous.lastSyncedHash
			);
			const nextState = nextSyncState(connection, remote.hash, remote.etag);
			await saveWebDavSyncState(nextState);
			webdavSyncState = nextState;
			syncError = '';
			syncStatus = 'synced';
			if (announceRemoteSave) {
				announceRemoteSave = false;
				announce('Mit wwschool gespeichert');
			}
		} catch (error) {
			announceRemoteSave = false;
			if (error instanceof WebDavConflictError) {
				const local = $state.snapshot(workspace) as WorkspaceSnapshot;
				syncConflict = {
					local,
					remote: error.remote,
					connection,
					message: error.message
				};
				syncStatus = 'conflict';
				conflictOpen = true;
				return;
			}
			syncError =
				error instanceof Error ? error.message : 'Die Synchronisierung ist fehlgeschlagen.';
			syncStatus = 'error';
			announce(syncError);
		}
	}

	async function pullRemoteWorkspace() {
		const credentials = webdavCredentials;
		const connection = webdavConnection;
		const previous = webdavSyncState;
		if (!credentials || !connection || !previous || syncStatus !== 'synced') return;
		try {
			if (previous.lastSyncedEtag) {
				try {
					const probe = await probeWebDavWorkspace(credentials, connection);
					if (probe?.exists && probe.etag === previous.lastSyncedEtag) return;
				} catch {
					// Ohne ETag wird der volle Stand gelesen.
				}
			}
			const remote = await readWebDavWorkspace(credentials, connection);
			if (syncStatus !== 'synced') return;
			const local = $state.snapshot(workspace) as WorkspaceSnapshot;
			const localHash = await hashWorkspace(local);
			if (!remote) {
				showSyncConflict(
					local,
					null,
					connection,
					'Die zuvor synchronisierte Workspace-Datei fehlt auf wwschool. Der lokale Stand bleibt erhalten.',
					false
				);
				return;
			}
			if (remote.hash === previous.lastSyncedHash) {
				if (remote.etag && remote.etag !== previous.lastSyncedEtag) {
					const nextState = nextSyncState(connection, remote.hash, remote.etag);
					await saveWebDavSyncState(nextState);
					webdavSyncState = nextState;
				}
				return;
			}
			if (localHash === previous.lastSyncedHash) {
				await adoptRemoteWorkspace(remote, connection);
				return;
			}
			if (localHash === remote.hash) {
				const nextState = nextSyncState(connection, remote.hash, remote.etag);
				await saveWebDavSyncState(nextState);
				webdavSyncState = nextState;
				return;
			}
			showSyncConflict(
				local,
				remote,
				connection,
				'Lokal und auf wwschool liegen unterschiedliche Versionen.',
				false
			);
		} catch (error) {
			if (syncStatus !== 'synced') return;
			syncError =
				error instanceof Error ? error.message : 'Die Synchronisierung ist fehlgeschlagen.';
			syncStatus = 'error';
			announce(syncError);
		}
	}

	async function persistWorkspaceNow(snapshot: WorkspaceSnapshot) {
		if (saveTimer) clearTimeout(saveTimer);
		const ticket = ++saveTicket;
		const savedAt = writeWorkspaceBackup(snapshot);
		if (!(await enqueueSave(snapshot, ticket, savedAt))) {
			throw new WebDavError('Die lokale Workspace konnte nicht gespeichert werden.');
		}
	}

	async function adoptRemoteWorkspace(remote: RemoteWorkspace, connection: WebDavConnection) {
		syncStatus = 'connecting';
		const nextState = nextSyncState(connection, remote.hash, remote.etag);
		await saveWebDavSyncState(nextState);
		webdavSyncState = nextState;
		await persistWorkspaceNow(remote.snapshot);
		workspace = remote.snapshot;
		markSaved(remote.snapshot);
		syncStatus = 'synced';
		syncError = '';
	}

	function showSyncConflict(
		local: WorkspaceSnapshot,
		remote: RemoteWorkspace | null,
		connection: WebDavConnection,
		message: string,
		openFiles: boolean
	) {
		syncConflict = { local: structuredClone(local), remote, connection, message };
		filesAfterConflict = openFiles;
		syncStatus = 'conflict';
		conflictOpen = true;
		loginOpen = false;
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
		const [remote, storedState] = await Promise.all([
			readWebDavWorkspace(credentials, connection),
			loadWebDavSyncState()
		]);
		const previous = storedState?.workspaceHref === connection.workspaceHref ? storedState : null;
		webdavSyncState = previous;
		const local = $state.snapshot(workspace) as WorkspaceSnapshot;
		const localHash = await hashWorkspace(local);

		if (remote) {
			if (localHash === remote.hash) {
				const state = nextSyncState(connection, remote.hash, remote.etag);
				await saveWebDavSyncState(state);
				webdavSyncState = state;
				syncStatus = 'synced';
			} else if (previous && localHash === previous.lastSyncedHash) {
				await adoptRemoteWorkspace(remote, connection);
			} else if (previous && remote.hash === previous.lastSyncedHash) {
				const uploaded = await writeWebDavWorkspace(credentials, connection, local, remote.hash);
				const state = nextSyncState(connection, uploaded.hash, uploaded.etag);
				await saveWebDavSyncState(state);
				webdavSyncState = state;
				syncStatus = 'synced';
			} else if (!previous && isEmptyWorkspace(local)) {
				await adoptRemoteWorkspace(remote, connection);
			} else {
				showSyncConflict(
					local,
					remote,
					connection,
					'Lokal und auf wwschool liegen unterschiedliche Versionen.',
					false
				);
				return;
			}
		} else if (previous) {
			showSyncConflict(
				local,
				null,
				connection,
				'Die zuvor synchronisierte Workspace-Datei fehlt auf wwschool. Der lokale Stand bleibt erhalten.',
				false
			);
			return;
		} else {
			const uploaded = await writeWebDavWorkspace(credentials, connection, local, null);
			const state = nextSyncState(connection, uploaded.hash, uploaded.etag);
			await saveWebDavSyncState(state);
			webdavSyncState = state;
			syncStatus = 'synced';
		}

		writeLocalOnly(false);
		if (filesAfterLogin) {
			showFilesManager();
			filesAfterLogin = false;
		}
		loginOpen = false;
		loginPassword = '';
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
					? 'Mit wwschool verbunden'
					: 'Mit wwschool verbunden. Die Anmeldung gilt nur für diese Sitzung.'
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
		loginError = syncError;
		loginOpen = true;
	}

	async function logoutWebDav() {
		settingsOpen = false;
		stopRemoteWatch();
		if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
		await clearWebDavCredentials();
		webdavCredentials = null;
		webdavConnection = null;
		webdavRemembered = false;
		syncConflict = null;
		conflictOpen = false;
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

	async function useRemoteVersion() {
		const conflict = syncConflict;
		const credentials = webdavCredentials;
		if (!conflict || !credentials) return;
		try {
			const current = await readWebDavWorkspace(credentials, conflict.connection);
			if (!current) {
				throw new WebDavError('Die Workspace-Datei ist auf wwschool nicht mehr vorhanden.');
			}
			if (current.hash !== conflict.remote?.hash) {
				syncConflict = {
					...conflict,
					remote: current,
					message: 'Der Serverstand hat sich erneut geändert. Prüfe beide Stände noch einmal.'
				};
				return;
			}
			await adoptRemoteWorkspace(current, conflict.connection);
			syncConflict = null;
			conflictOpen = false;
			if (filesAfterConflict) showFilesManager();
			announce('Der Stand von wwschool wurde geladen.');
		} catch (error) {
			syncError =
				error instanceof Error ? error.message : 'Der Serverstand konnte nicht geladen werden.';
			announce(syncError);
		}
	}

	async function useLocalVersion() {
		const conflict = syncConflict;
		const credentials = webdavCredentials;
		if (!conflict || !credentials) return;
		const local = $state.snapshot(workspace) as WorkspaceSnapshot;
		try {
			const uploaded = await writeWebDavWorkspace(
				credentials,
				conflict.connection,
				local,
				conflict.remote?.hash ?? null
			);
			const state = nextSyncState(conflict.connection, uploaded.hash, uploaded.etag);
			await saveWebDavSyncState(state);
			webdavSyncState = state;
			await persistWorkspaceNow(local);
			markSaved(local);
			syncConflict = null;
			conflictOpen = false;
			syncStatus = 'synced';
			if (filesAfterConflict) showFilesManager();
			announce('Der lokale Stand wurde übernommen.');
		} catch (error) {
			if (error instanceof WebDavConflictError) {
				syncConflict = { ...conflict, local, remote: error.remote, message: error.message };
				syncStatus = 'conflict';
				return;
			}
			syncError =
				error instanceof Error
					? error.message
					: 'Der lokale Stand konnte nicht hochgeladen werden.';
			announce(syncError);
		}
	}

	function openSyncConflict() {
		if (syncConflict) conflictOpen = true;
	}

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		if (!hydrated) return;
		flushWorkspace();
		if (!dirty && sharedCode === null) return;
		event.preventDefault();
		event.returnValue = 'Es gibt ungespeicherte Änderungen.';
	}

	function handleVisibility() {
		if (document.visibilityState === 'hidden') {
			flushWorkspace();
			pushRemoteWorkspace();
		} else queueRemotePull();
	}

	function editActiveFile(value: string) {
		if (viewingShare && sharedCode !== null) {
			if (value === sharedCode) return;
			sharedCode = value;
			return;
		}
		const next = updateFileContent(workspace, workspace.activeFileId, value);
		if (next === workspace) return;
		workspace = next;
	}

	function applyWorkspace(next: WorkspaceSnapshot) {
		const activeChanged = next.activeFileId !== workspace.activeFileId;
		workspace = next;
		if (activeChanged) pane = 'code';
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
		saveChooser = false;
		clearSharedImportUrl();
	}

	function showFile(fileId: string) {
		viewingShare = false;
		applyWorkspace(openFile(workspace, fileId));
		pane = 'code';
		void tick().then(() => codeEditor?.focusEditor());
	}

	function closeTab(fileId: string) {
		applyWorkspace(closeFile(workspace, fileId));
	}

	function createNamedFile(name: string) {
		const folderId = activeFile?.folderId;
		if (!folderId) return;
		applyWorkspace(createFile(workspace, folderId, name));
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
		saveChooser = false;
		pane = 'code';
		clearSharedImportUrl();
		void tick().then(() => codeEditor?.focusEditor());
	}

	function showFilesManager() {
		const folderId = activeFile?.folderId;
		if (folderId && workspace.selectedFolderId !== folderId) {
			workspace = selectFolder(workspace, folderId);
		}
		explorerToken += 1;
		filesOpen = true;
	}

	function openFilesManager(saveSharedFile = false) {
		saveChooser = saveSharedFile;
		if (webdavCredentials && webdavConnection && syncStatus !== 'error') {
			showFilesManager();
			if (syncStatus === 'conflict') openSyncConflict();
			return;
		}
		if (readLocalOnly()) {
			showFilesManager();
			return;
		}
		filesAfterLogin = true;
		loginError = syncError;
		loginOpen = true;
	}

	function openExplorer() {
		openFilesManager();
	}

	function openSaveShare() {
		openFilesManager(true);
	}

	function saveShared(folderId: string) {
		if (sharedCode === null) return;
		const existing = workspace.files.find(
			(file) => file.folderId === folderId && file.name.toLocaleLowerCase('de') === 'geteilt.py'
		);
		const next = existing
			? openFile(updateFileContent(workspace, existing.id, sharedCode), existing.id)
			: importFiles(workspace, folderId, [{ name: 'geteilt.py', content: sharedCode }]);
		sharedCode = null;
		viewingShare = false;
		saveChooser = false;
		filesOpen = false;
		applyWorkspace(next);
		clearSharedImportUrl();
		announce(
			webdavCredentials
				? 'Geteilte Datei gespeichert. Sie wird mit wwschool abgeglichen.'
				: 'Geteilte Datei gespeichert'
		);
	}

	function undo() {
		codeEditor?.undoEdit();
	}

	function redo() {
		codeEditor?.redoEdit();
	}

	function startRuffWorker() {
		if (ruffWorker) return;
		const worker = new Worker(new URL('$lib/runner/ruff.worker.ts', import.meta.url), {
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
		runId += 1;
		const payload = runPayload();
		const fileId = editorFileId;
		const thisId = runId;
		runFileId = fileId;
		beginRun(thisId, payload.filename, fileId);
		void runPython({
			code: editorCode,
			filename: payload.filename,
			files: payload.files,
			onOutput: (stream, text) => appendRunOutput(thisId, stream, text)
		}).then((result) => {
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
		stopPython(message);
	}

	function clearCode() {
		if (viewingShare && sharedCode !== null) {
			sharedCode = '';
			announce('Code gelöscht');
			return;
		}
		workspace = updateFileContent(workspace, workspace.activeFileId, '');
		announce('Code gelöscht');
	}

	function downloadCode() {
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
		announce(`${filename} heruntergeladen`);
	}

	async function downloadDatabase() {
		const snapshot = $state.snapshot(workspace) as WorkspaceSnapshot;
		if (saveTimer) clearTimeout(saveTimer);
		const ticket = ++saveTicket;
		const savedAt = writeWorkspaceBackup(snapshot);
		const stored = await enqueueSave(snapshot, ticket, savedAt);
		const blobUrl = URL.createObjectURL(
			new Blob([await workspaceExport(snapshot)], { type: 'text/x-python;charset=utf-8' })
		);
		const link = document.createElement('a');
		link.href = blobUrl;
		link.download = WORKSPACE_ARCHIVE_NAME;
		link.click();
		URL.revokeObjectURL(blobUrl);
		announce(
			stored
				? 'Datenbank heruntergeladen'
				: 'Python-Datei heruntergeladen. Speichern im Browser ist fehlgeschlagen.'
		);
	}

	async function shareCode() {
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
			if (viewingShare && sharedCode !== null) openSaveShare();
			else if (webdavCredentials) pushRemoteWorkspace({ announce: true });
			else downloadCode();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			runCode();
		}
	}

	$effect(() => {
		const watching = webdavCredentials && webdavConnection && syncStatus === 'synced';
		if (!watching) {
			stopRemoteWatch();
			return;
		}
		startRemoteWatch();
		return () => stopRemoteWatch();
	});

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
			void import('$lib/editor/web-lint').then(({ lintWeb }) => {
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
		if (!hydrated) return;
		void workspace.files.map((file) => file.content + file.name + file.folderId);
		void workspace.folders.map((folder) => folder.name + (folder.parentId ?? ''));
		void workspace.openFileIds;
		void workspace.activeFileId;
		void workspace.selectedFolderId;
		void workspace.welcomed;
		void workspace.layout;
		const ticket = ++saveTicket;
		saveTimer = setTimeout(() => {
			const snapshot = $state.snapshot(workspace) as WorkspaceSnapshot;
			const savedAt = writeWorkspaceBackup(snapshot);
			void enqueueSave(snapshot, ticket, savedAt);
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
			void import('$lib/editor/document-preview').then(({ renderDocumentPreview }) => {
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
			if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
			stopRemoteWatch();
			stopWatch();
			narrowQuery.removeEventListener('change', syncNarrow);
			window.removeEventListener('message', onPreviewMessage);
			flushWorkspace();
			disposePython();
			ruffWorker?.terminate();
			if (lintTimer) clearTimeout(lintTimer);
			if (noticeTimer) clearTimeout(noticeTimer);
		};

		async function boot() {
			const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
			let loaded: { snapshot: WorkspaceSnapshot; created: boolean };
			try {
				loaded = await loadWorkspace(legacy);
			} catch {
				loaded = { snapshot: createInitialWorkspace(legacy), created: false };
				announce('Die gespeicherte Workspace konnte nicht gelesen werden.');
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
			if (loaded.created && legacy) localStorage.removeItem(LEGACY_STORAGE_KEY);
			markSaved(loaded.snapshot);
			workspace = loaded.snapshot;
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
		content="Python, HTML, CSS und JavaScript im Browser bearbeiten – lokal oder synchronisiert mit wwschool."
	/>
</svelte:head>

<svelte:window
	onkeydown={handleShortcut}
	onbeforeunload={handleBeforeUnload}
	onpagehide={() => {
		flushWorkspace();
		pushRemoteWorkspace();
	}}
	onvisibilitychange={handleVisibility}
/>

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
				title={dirty || sharedCode !== null ? 'Ungespeicherte Änderungen' : 'Dateien'}
			>
				<Files />
				<span class="action-label">Dateien</span>
				{#if dirty || sharedCode !== null}<i class="dirty-mark" aria-hidden="true"></i>{/if}
			</Button>
			<div class="toolbar">
				<ButtonGroup.Root aria-label="Ausführen und Datei">
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						class={pythonLoading ? 'run-busy' : undefined}
						onclick={runCode}
						disabled={!showsPreview && !isJavaScript && (!isPython || pythonLoading)}
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
						aria-label="Teilen"
						title="Teilen"><Share2 /><span class="action-label">Teilen</span></Button
					>
					<Button
						variant="outline"
						size={narrow ? 'icon-sm' : 'sm'}
						onclick={() => openDocs()}
						aria-label="Doku"
						title="Doku"><Book /><span class="action-label">Doku</span></Button
					>
					{#if sharedCode !== null}
						<Button
							variant="outline"
							size={narrow ? 'icon-sm' : 'sm'}
							onclick={openSaveShare}
							aria-label="Geteilte Datei speichern"
							title="Geteilte Datei ist nicht gespeichert. Ordner in Dateien wählen."
							><Save /><span class="action-label">Speichern</span></Button
						>
					{:else if webdavCredentials}
						<Button
							variant="outline"
							size={narrow ? 'icon-sm' : 'sm'}
							onclick={() => pushRemoteWorkspace({ announce: true })}
							aria-label="Mit wwschool speichern"
							title="Mit wwschool speichern (Cmd/Strg+S)"
							><Save /><span class="action-label">Speichern</span></Button
						>
					{/if}
					<Button
						variant="outline"
						size="icon-sm"
						onclick={downloadCode}
						aria-label="{editorName} herunterladen"
						title="Herunterladen (Cmd/Strg+S)"><Download /></Button
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
									wwschool legt jeden Upload als neue Datei an. Gespeichert wird mit Speichern
									(Cmd/Strg+S) oder wenn der Tab in den Hintergrund geht.
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
		snapshot={workspace}
		onchange={applyWorkspace}
		ondownload={downloadDatabase}
		onnotice={announce}
		onrestore={restoredWorkspace}
		syncStatus={syncStatus === 'connecting' ? 'syncing' : syncStatus}
		syncLocation={webdavConnection?.personalName ?? ''}
		onresolve={syncConflict ? openSyncConflict : undefined}
		onsave={saveChooser ? saveShared : undefined}
	/>
	<Dialog.Root
		bind:open={loginOpen}
		onOpenChange={(open) => {
			if (!open) {
				loginPassword = '';
				loginError = '';
				if (!filesOpen) {
					filesAfterLogin = false;
					saveChooser = false;
				}
			}
		}}
	>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>Bei wwschool anmelden</Dialog.Title>
				<Dialog.Description>
					Dein Workspace bleibt lokal gespeichert und wird mit wwschool abgeglichen.
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
					<input id="wwschool-stay" type="checkbox" bind:checked={loginStay} disabled={loginBusy} />
					<span>Angemeldet bleiben</span>
				</label>
				<p class="text-xs text-muted-foreground">
					Ohne Haken gilt die Anmeldung nur für diese Sitzung.
				</p>
				{#if loginError}
					<p class="text-sm text-destructive" role="alert">{loginError}</p>
				{/if}
				<div class="grid gap-1">
					<Button type="submit" disabled={loginBusy}>
						{#if loginBusy}<LoaderCircle class="animate-spin" />{/if}
						{loginBusy ? 'Anmelden …' : 'Anmelden'}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={loginBusy}
						onclick={continueLocally}
					>
						Lokal weiterarbeiten
					</Button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Root>
	<Dialog.Root bind:open={conflictOpen}>
		<Dialog.Content class="sm:max-w-xl">
			<Dialog.Header>
				<Dialog.Title>Abweichende Stände</Dialog.Title>
				<Dialog.Description>{syncConflict?.message}</Dialog.Description>
			</Dialog.Header>
			{#if syncConflict}
				<div class="grid gap-3 text-sm">
					<div class="grid grid-cols-2 gap-3 rounded-md border p-3">
						<div class="grid gap-1">
							<p class="text-muted-foreground">Lokal</p>
							<p class="flex gap-1 font-medium">
								<span>{syncConflict.local.files.length}</span><span>&nbsp;Dateien</span>
							</p>
						</div>
						<div class="grid gap-1">
							<p class="text-muted-foreground">wwschool</p>
							<p class="flex gap-1 font-medium">
								{#if syncConflict.remote}
									<span>{syncConflict.remote.snapshot.files.length}</span><span>&nbsp;Dateien</span>
								{:else}
									<span>Datei fehlt</span>
								{/if}
							</p>
						</div>
					</div>
					<p>Beide Stände bleiben unverändert, bis du eine Seite übernimmst.</p>
				</div>
			{/if}
			<Dialog.Footer class="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
				<Button
					type="button"
					variant="outline"
					class="w-full whitespace-normal sm:col-span-2"
					onclick={() => (conflictOpen = false)}
				>
					Später
				</Button>
				{#if syncConflict?.remote}
					<Button
						type="button"
						variant="outline"
						class="w-full min-w-0 whitespace-normal"
						onclick={() => void useRemoteVersion()}
					>
						wwschool laden
					</Button>
				{/if}
				<Button
					type="button"
					class={syncConflict?.remote
						? 'w-full min-w-0 whitespace-normal'
						: 'w-full min-w-0 whitespace-normal sm:col-span-2'}
					onclick={() => void useLocalVersion()}
				>
					Lokal übernehmen
				</Button>
			</Dialog.Footer>
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
				{#await import('$lib/docs/docs-browser.svelte') then { default: DocsBrowser }}
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
							title="Geteilte Datei ist nicht gespeichert"
							onclick={showShare}
						>
							geteilt.py
							<i class="dirty-mark" aria-hidden="true"></i>
							<em>Nicht gespeichert</em>
						</button>
						<button
							type="button"
							class="tab-close"
							aria-label="Geteilte Datei schließen"
							onclick={discardShare}
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
							{#if dirtyFileIds.has(file.id)}
								<i class="dirty-mark" aria-hidden="true"></i>
								<span class="sr-only">Ungespeichert</span>
							{/if}
						</button>
						{#if openFiles.length > 1}
							<button
								type="button"
								class="tab-close"
								aria-label="{file.name} schließen"
								onclick={() => closeTab(file.id)}
							>
								<X />
							</button>
						{/if}
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
					disabled={!canUndo}
					aria-label="Rückgängig"
					title="Rückgängig"><Undo2 /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={redo}
					disabled={!canRedo}
					aria-label="Wiederholen"
					title="Wiederholen"><Redo2 /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => (clearOpen = true)}
					aria-label="Code löschen"
					title="Code löschen"><Trash2 /></Button
				>
			</ButtonGroup.Root>
		</div>
		<div class="tab-content" hidden={pane !== 'code'}>
			<CodeEditor
				bind:this={codeEditor}
				fileId={editorFileId}
				value={editorCode}
				language={codeLanguage(editorName)}
				{diagnostics}
				{theme}
				wrapLines={narrow}
				visible={pane === 'code'}
				onchange={editActiveFile}
				onopendocs={openDocs}
				onhistory={(state) => {
					canUndo = state.canUndo;
					canRedo = state.canRedo;
				}}
			/>
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
		<h2>Ausgabe</h2>
		<ButtonGroup.Root aria-label="Ausgabe steuern">
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
	{@render consoleBody()}
	<footer>Cmd/Strg + Enter</footer>
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
