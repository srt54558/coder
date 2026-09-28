<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import FileCode from '@lucide/svelte/icons/file-code';
	import FileDown from '@lucide/svelte/icons/file-down';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import Folder from '@lucide/svelte/icons/folder';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import Cloud from '@lucide/svelte/icons/cloud';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { parseWorkspaceArchive } from '$lib/workspace/archive';
	import NewFileDialog from '$lib/components/new-file-dialog.svelte';
	import {
		createFile,
		createFolder,
		deleteFile,
		deleteFolder,
		filesInFolder,
		folderPath,
		folderRows,
		importFiles,
		newFileNameError,
		openFile,
		renameFile,
		renameFolder,
		ROOT_FOLDER_ID,
		selectFolder,
		type WorkspaceFile,
		type WorkspaceFolder,
		type WorkspaceSnapshot
	} from '$lib/workspace/model';

	const FILE_IMPORT_LIMIT = 1_000_000;
	const ARCHIVE_IMPORT_LIMIT = 20_000_000;

	let {
		open = $bindable(false),
		openedToken = 0,
		snapshot,
		onchange,
		ondownload,
		onnotice,
		onrestore,
		syncStatus = 'local',
		syncLocation = '',
		onresolve,
		onsave
	}: {
		open?: boolean;
		openedToken?: number;
		snapshot: WorkspaceSnapshot;
		onchange: (next: WorkspaceSnapshot) => void;
		ondownload: () => void;
		onnotice?: (message: string) => void;
		onrestore?: () => void;
		syncStatus?: 'local' | 'syncing' | 'synced' | 'conflict' | 'error';
		syncLocation?: string;
		onresolve?: () => void;
		onsave?: (folderId: string) => void;
	} = $props();

	let createOpen = $state(false);
	let picked = $state<{ token: number; fileId: string | null } | null>(null);
	let deleteOpen = $state(false);
	let pendingDelete = $state<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
	let renaming = $state<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let restoreOpen = $state(false);
	let pendingRestore = $state<{
		name: string;
		snapshot: WorkspaceSnapshot;
		ignored: number;
	} | null>(null);

	const rows = $derived(folderRows(snapshot.folders));
	const visibleFiles = $derived(filesInFolder(snapshot, snapshot.selectedFolderId));
	const currentPath = $derived(folderPath(snapshot.folders, snapshot.selectedFolderId));
	const soleFile = $derived(snapshot.files.length <= 1);
	const selectedFileId = $derived.by(() => {
		if (picked?.token === openedToken) return picked.fileId;
		const active = snapshot.files.find((file) => file.id === snapshot.activeFileId);
		return active?.folderId === snapshot.selectedFolderId ? active.id : null;
	});

	function focusRename(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function pickFile(fileId: string | null) {
		picked = { token: openedToken, fileId };
	}

	function chooseFolder(folderId: string) {
		pickFile(null);
		onchange(selectFolder(snapshot, folderId));
	}

	function addFolder(parentId: string | null) {
		const next = createFolder(snapshot, parentId, 'Ordner');
		const created = next.folders.find(
			(folder) => !snapshot.folders.some((existing) => existing.id === folder.id)
		);
		onchange(next);
		if (created) renaming = { kind: 'folder', id: created.id, name: created.name };
	}

	function createNamed(name: string) {
		const next = createFile(snapshot, snapshot.selectedFolderId, name);
		const created = next.files.find(
			(file) => !snapshot.files.some((existing) => existing.id === file.id)
		);
		if (created) pickFile(created.id);
		onchange(next);
	}

	function openSelected(fileId: string) {
		onchange(openFile(snapshot, fileId));
		open = false;
	}

	function startRename(kind: 'file' | 'folder', id: string, name: string) {
		renaming = { kind, id, name };
	}

	function commitRename() {
		if (!renaming) return;
		const current = renaming;
		renaming = null;
		if (!current.name.trim()) return;
		if (current.kind === 'file') {
			const problem = newFileNameError(current.name);
			if (problem) {
				onnotice?.(problem);
				return;
			}
		}
		const next =
			current.kind === 'folder'
				? renameFolder(snapshot, current.id, current.name)
				: renameFile(snapshot, current.id, current.name);
		if (next !== snapshot) onchange(next);
	}

	function handleRenameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			renaming = null;
		}
	}

	function askDeleteFolder(folder: WorkspaceFolder) {
		if (folder.id === ROOT_FOLDER_ID) return;
		if (deleteFolder(snapshot, folder.id) === snapshot) {
			onnotice?.('Dieser Ordner enthält die letzten Dateien und bleibt erhalten.');
			return;
		}
		pendingDelete = { kind: 'folder', id: folder.id, name: folder.name };
		deleteOpen = true;
	}

	function askDeleteFile(file: WorkspaceFile) {
		if (soleFile) {
			onnotice?.('Die letzte Datei bleibt erhalten.');
			return;
		}
		pendingDelete = { kind: 'file', id: file.id, name: file.name };
		deleteOpen = true;
	}

	function downloadText(name: string, content: string) {
		const blobUrl = URL.createObjectURL(
			new Blob([content], { type: 'text/x-python;charset=utf-8' })
		);
		const link = document.createElement('a');
		link.href = blobUrl;
		link.download = name;
		link.click();
		URL.revokeObjectURL(blobUrl);
	}

	function exportFiles() {
		const selected = visibleFiles.find((file) => file.id === selectedFileId);
		const files = selected ? [selected] : visibleFiles;
		if (!files.length) {
			onnotice?.('In diesem Ordner gibt es keine Datei zum Exportieren.');
			return;
		}
		for (const file of files) downloadText(file.name, file.content);
		onnotice?.(
			files.length === 1 ? `${files[0].name} exportiert` : `${files.length} Dateien exportiert`
		);
	}

	function limitNote(names: string[], limit: string): string {
		if (names.length === 1) return `${names[0]} ist größer als ${limit} und wurde übersprungen.`;
		return `${names.length} Dateien über ${limit} wurden übersprungen.`;
	}

	async function importChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const chosen = [...(input.files ?? [])];
		input.value = '';
		if (!chosen.length) return;
		const incoming: { name: string; content: string }[] = [];
		const skippedArchive: string[] = [];
		const skippedFile: string[] = [];
		const skippedType: string[] = [];
		const archives: { name: string; snapshot: WorkspaceSnapshot }[] = [];
		for (const file of chosen) {
			if (file.size > ARCHIVE_IMPORT_LIMIT) {
				skippedArchive.push(file.name);
				continue;
			}
			const content = await file.text();
			const restored = await parseWorkspaceArchive(content);
			if (restored) {
				archives.push({ name: file.name, snapshot: restored });
				continue;
			}
			if (newFileNameError(file.name)) {
				skippedType.push(file.name);
				continue;
			}
			if (file.size > FILE_IMPORT_LIMIT) {
				skippedFile.push(file.name);
				continue;
			}
			incoming.push({ name: file.name, content });
		}
		const notes: string[] = [];
		if (skippedArchive.length) notes.push(limitNote(skippedArchive, '20 MB'));
		if (skippedFile.length) notes.push(limitNote(skippedFile, '1 MB'));
		if (skippedType.length === 1)
			notes.push(`${skippedType[0]} hat ein Format, das nicht unterstützt wird.`);
		else if (skippedType.length) {
			notes.push(`${skippedType.length} Dateien haben ein Format, das nicht unterstützt wird.`);
		}
		if (archives.length) {
			pendingRestore = {
				name: archives[0].name,
				snapshot: archives[0].snapshot,
				ignored: incoming.length + archives.length - 1
			};
			restoreOpen = true;
			if (notes.length) onnotice?.(notes.join(' '));
			return;
		}
		if (incoming.length) onchange(importFiles(snapshot, snapshot.selectedFolderId, incoming));
		if (incoming.length === 1) notes.push(`${incoming[0].name} importiert`);
		else if (incoming.length) notes.push(`${incoming.length} Dateien importiert`);
		if (notes.length) onnotice?.(notes.join(' '));
	}

	function confirmRestore() {
		const pending = pendingRestore;
		pendingRestore = null;
		restoreOpen = false;
		if (!pending) return;
		picked = null;
		renaming = null;
		onchange(pending.snapshot);
		onrestore?.();
		onnotice?.('Datenbank ersetzt. Die bisherigen Dateien wurden gelöscht.');
		open = false;
	}

	function confirmDelete() {
		if (!pendingDelete) return;
		const next =
			pendingDelete.kind === 'folder'
				? deleteFolder(snapshot, pendingDelete.id)
				: deleteFile(snapshot, pendingDelete.id);
		if (next === snapshot) {
			onnotice?.(
				pendingDelete.kind === 'folder'
					? 'Dieser Ordner enthält die letzten Dateien und bleibt erhalten.'
					: 'Die letzte Datei bleibt erhalten.'
			);
		} else {
			if (pendingDelete.kind === 'file' && selectedFileId === pendingDelete.id) pickFile(null);
			onchange(next);
		}
		pendingDelete = null;
		deleteOpen = false;
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value) pendingDelete = null;
	}}
>
	<Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-3xl">
		<div class="explorer-header">
			<div>
				<Dialog.Title>Dateien</Dialog.Title>
				<Dialog.Description class={onsave ? 'mt-1 text-xs' : 'sr-only'}>
					{#if onsave}
						Ordner wählen, dann hier speichern. Die Datei bleibt sonst ungespeichert.
					{:else}
						Dateien und Ordner.
					{/if}
				</Dialog.Description>
			</div>
			<div class="sync-state" data-state={syncStatus} aria-live="polite" title={syncLocation}>
				{#if syncStatus === 'syncing'}
					<LoaderCircle class="sync-spinner" /><span>Wird synchronisiert …</span>
				{:else if syncStatus === 'synced'}
					<Cloud /><span>wwschool</span>
				{:else if syncStatus === 'conflict'}
					<TriangleAlert /><span>Abgleich nötig</span>
					{#if onresolve}<Button variant="outline" size="xs" onclick={onresolve}>Lösen</Button>{/if}
				{:else if syncStatus === 'error'}
					<TriangleAlert /><span>Verbindung gestört</span>
				{:else}
					<HardDrive /><span>Nur lokal</span>
				{/if}
			</div>
			<div class="header-actions">
				<input
					bind:this={fileInput}
					class="file-input"
					type="file"
					accept=".py,.pyw,.pyi,.html,.htm,.css,.js,.json,.xml,.txt,.md,text/plain,text/html,text/css,text/javascript,application/json,application/xml,text/markdown"
					multiple
					onchange={(event) => void importChosen(event)}
				/>
				<Button variant="outline" size="sm" onclick={() => fileInput?.click()}
					><Upload /> Importieren</Button
				>
				<Button
					variant="outline"
					size="sm"
					onclick={exportFiles}
					disabled={visibleFiles.length === 0}><FileDown /> Exportieren</Button
				>
				<Button
					variant="outline"
					size="sm"
					onclick={ondownload}
					title="Datenbank herunterladen"
					aria-label="Datenbank herunterladen"><Download /> Datenbank</Button
				>
				{#if onsave}
					<Button size="sm" onclick={() => onsave(snapshot.selectedFolderId)}>Hier speichern</Button
					>
				{/if}
			</div>
		</div>
		<div class="explorer-panes">
			<section class="pane" aria-label="Ordner">
				<div class="pane-label folders-label">
					<span>Ordner</span>
					<button
						type="button"
						class="add-btn"
						aria-label="Neuer Ordner"
						title="Neuer Ordner"
						onclick={() => addFolder(null)}
					>
						<Plus />
					</button>
				</div>
				<ScrollArea class="pane-scroll">
					<ul>
						{#each rows as row (row.folder.id)}
							<li class:selected={snapshot.selectedFolderId === row.folder.id}>
								{#if renaming?.kind === 'folder' && renaming.id === row.folder.id}
									<input
										class="rename-input"
										style:margin-left={`${0.7 + row.depth * 0.9}rem`}
										{@attach focusRename}
										bind:value={renaming.name}
										aria-label="Neuer Ordnername"
										onkeydown={handleRenameKeydown}
										onblur={commitRename}
									/>
								{:else}
									<button
										type="button"
										class="row"
										style:padding-left={`${0.7 + row.depth * 0.9}rem`}
										aria-current={snapshot.selectedFolderId === row.folder.id ? 'true' : undefined}
										onclick={() => chooseFolder(row.folder.id)}
									>
										<Folder />
										<span>{row.folder.name}</span>
									</button>
									<button
										type="button"
										class="icon-btn"
										aria-label={`In ${row.folder.name} einen Ordner anlegen`}
										title="Neuer Ordner"
										onclick={() => addFolder(row.folder.id)}
									>
										<Plus />
									</button>
									<button
										type="button"
										class="icon-btn"
										aria-label={`${row.folder.name} umbenennen`}
										onclick={() => startRename('folder', row.folder.id, row.folder.name)}
									>
										<Pencil />
									</button>
									<button
										type="button"
										class="icon-btn"
										aria-label={`${row.folder.name} löschen`}
										title={row.folder.id === ROOT_FOLDER_ID
											? 'Der Hauptordner bleibt erhalten'
											: 'Ordner löschen'}
										disabled={row.folder.id === ROOT_FOLDER_ID}
										onclick={() => askDeleteFolder(row.folder)}
									>
										<Trash2 />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</ScrollArea>
			</section>
			<section class="pane" aria-label="Dateien">
				<div class="pane-label files-label">
					<span>{currentPath}</span>
					<div class="file-actions">
						<button
							type="button"
							class="add-btn"
							aria-label="Neue Datei"
							title="Neue Datei"
							onclick={() => (createOpen = true)}
						>
							<FilePlus />
						</button>
						<Button
							variant="outline"
							size="xs"
							disabled={!selectedFileId}
							onclick={() => selectedFileId && openSelected(selectedFileId)}>Öffnen</Button
						>
					</div>
				</div>
				<ScrollArea class="pane-scroll">
					{#if visibleFiles.length === 0}
						<p class="empty">Dieser Ordner enthält keine Dateien.</p>
					{:else}
						<ul>
							{#each visibleFiles as file (file.id)}
								<li class:selected={selectedFileId === file.id}>
									{#if renaming?.kind === 'file' && renaming.id === file.id}
										<input
											class="rename-input"
											{@attach focusRename}
											bind:value={renaming.name}
											aria-label="Neuer Dateiname"
											onkeydown={handleRenameKeydown}
											onblur={commitRename}
										/>
									{:else}
										<button
											type="button"
											class="row"
											aria-current={selectedFileId === file.id ? 'true' : undefined}
											onclick={() => pickFile(file.id)}
											ondblclick={() => openSelected(file.id)}
										>
											<FileCode />
											<span>{file.name}</span>
											{#if file.id === snapshot.activeFileId}<em>Offen</em>{/if}
										</button>
										<button
											type="button"
											class="icon-btn"
											aria-label={`${file.name} umbenennen`}
											onclick={() => startRename('file', file.id, file.name)}
										>
											<Pencil />
										</button>
										<button
											type="button"
											class="icon-btn"
											aria-label={`${file.name} löschen`}
											title={soleFile ? 'Die letzte Datei bleibt erhalten' : 'Datei löschen'}
											disabled={soleFile}
											onclick={() => askDeleteFile(file)}
										>
											<Trash2 />
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</ScrollArea>
			</section>
		</div>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={restoreOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Datenbank ersetzen?</AlertDialog.Title>
			<AlertDialog.Description>
				„{pendingRestore?.name}“ ersetzt die gesamte Datenbank. Alle Ordner und Dateien in diesem
				Browser werden gelöscht.
				{#if pendingRestore && pendingRestore.ignored > 0}
					Die anderen ausgewählten Dateien werden dabei nicht importiert.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={confirmRestore}
				>Ersetzen</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title
				>{pendingDelete?.kind === 'folder'
					? 'Ordner löschen?'
					: 'Datei löschen?'}</AlertDialog.Title
			>
			<AlertDialog.Description>
				{#if pendingDelete?.kind === 'folder'}
					„{pendingDelete.name}“ und alles darin wird aus dem Workspace entfernt.
				{:else}
					„{pendingDelete?.name}“ wird aus dem Workspace entfernt.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Abbrechen</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={confirmDelete}>Löschen</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<NewFileDialog bind:open={createOpen} oncreate={createNamed} />

<style>
	.explorer-header,
	.files-label,
	.folders-label,
	.header-actions,
	.file-actions,
	.row {
		display: flex;
		align-items: center;
	}
	.explorer-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 1rem 3.2rem 0.9rem 1rem;
	}
	.header-actions {
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.4rem;
	}
	.sync-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-width: 0;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		white-space: nowrap;
	}
	.sync-state[data-state='synced'] {
		color: var(--muted-foreground);
	}
	.sync-state[data-state='conflict'],
	.sync-state[data-state='error'] {
		color: var(--destructive);
	}
	.sync-state :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
		flex: 0 0 auto;
	}
	.sync-state :global(.sync-spinner) {
		animation: sync-spin 1s linear infinite;
	}
	@keyframes sync-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.file-input {
		display: none;
	}
	.explorer-panes {
		display: grid;
		grid-template-columns: minmax(13rem, 0.85fr) minmax(0, 1.15fr);
		height: min(26rem, calc(100svh - 12rem));
		min-height: 16rem;
		border-block: 1px solid var(--border);
	}
	@media (max-width: 899px) {
		.explorer-header {
			grid-template-columns: 1fr;
			align-items: start;
			padding-right: 2.6rem;
		}
		.sync-state {
			justify-content: flex-start;
		}
		.header-actions {
			justify-content: flex-start;
		}
		.explorer-panes {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(6.5rem, 0.72fr) minmax(0, 1fr);
			height: min(68svh, 32rem);
			min-height: 0;
		}
	}
	.pane {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}
	.pane + .pane {
		border-left: 1px solid var(--border);
	}
	@media (max-width: 899px) {
		.pane + .pane {
			border-left: 0;
			border-top: 1px solid var(--border);
		}
	}
	.pane-label {
		margin: 0;
		padding: 0.55rem 0.75rem;
		color: var(--muted-foreground);
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.folders-label {
		justify-content: space-between;
		gap: 0.5rem;
	}
	.files-label {
		justify-content: space-between;
		gap: 0.5rem;
		text-transform: none;
		letter-spacing: 0;
		font: 500 0.75rem/1.2 var(--font-code);
	}
	.files-label span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file-actions {
		flex: 0 0 auto;
		gap: 0.35rem;
	}
	.add-btn {
		display: grid;
		width: 1.55rem;
		height: 1.55rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		background: var(--background);
		color: var(--foreground);
		cursor: pointer;
	}
	.add-btn:hover {
		background: var(--accent);
	}
	:global(.pane-scroll) {
		height: 100%;
		min-height: 0;
	}
	ul {
		margin: 0;
		padding: 0.2rem;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		align-items: center;
		min-height: 2rem;
		border-radius: 0.4rem;
	}
	li.selected {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.row {
		gap: 0.45rem;
		width: 100%;
		min-width: 0;
		height: 2rem;
		padding-right: 0.35rem;
		border: 0;
		background: transparent;
		color: inherit;
		font: 400 0.78rem/1 var(--font-code);
		text-align: left;
		cursor: pointer;
	}
	.row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row em {
		margin-left: auto;
		color: var(--muted-foreground);
		font-style: normal;
		font-size: 0.65rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.icon-btn {
		display: grid;
		width: 1.55rem;
		height: 1.55rem;
		place-items: center;
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}
	li:hover .icon-btn,
	li:focus-within .icon-btn,
	li.selected .icon-btn {
		opacity: 1;
		pointer-events: auto;
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--background);
		color: var(--foreground);
	}
	li:hover .icon-btn:disabled,
	li:focus-within .icon-btn:disabled,
	li.selected .icon-btn:disabled {
		cursor: not-allowed;
		opacity: 0.35;
		pointer-events: none;
	}
	.rename-input {
		grid-column: 1 / -1;
		width: auto;
		height: 1.7rem;
		margin: 0.15rem 0.3rem;
		border: 1px solid var(--border);
		border-radius: 0.35rem;
		background: var(--background);
		color: var(--foreground);
		font: 400 0.78rem/1 var(--font-code);
		padding: 0 0.4rem;
	}
	.empty {
		margin: 0;
		padding: 1rem 0.8rem;
		color: var(--muted-foreground);
		font-size: 0.78rem;
	}
	:global(.icon-btn svg),
	:global(.add-btn svg) {
		width: 0.85rem;
		height: 0.85rem;
	}
	:global(.row svg) {
		width: 0.9rem;
		height: 0.9rem;
		flex: 0 0 auto;
	}
</style>
