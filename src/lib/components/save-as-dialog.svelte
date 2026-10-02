<script lang="ts">
	import FileCode from '@lucide/svelte/icons/file-code';
	import Folder from '@lucide/svelte/icons/folder';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { folderPath, folderRows } from '#lib/workspace/model.js';
	import type { WebDavTreeFile, WebDavTreeFolder } from '#lib/workspace/webdav.js';

	let {
		open = $bindable(false),
		openedToken = 0,
		initialName = '',
		folders,
		files,
		rootId,
		busy = false,
		onsave
	}: {
		open?: boolean;
		openedToken?: number;
		initialName?: string;
		folders: WebDavTreeFolder[];
		files: WebDavTreeFile[];
		rootId: string;
		busy?: boolean;
		onsave: (folderId: string, filename: string) => void;
	} = $props();

	let filename = $state('');
	let selectedFolderId = $state('');
	let selectedFileId = $state<string | null>(null);
	let primed = $state(-1);

	const rows = $derived(folderRows(folders));
	const childFolders = $derived(
		folders
			.filter((folder) => folder.parentId === selectedFolderId)
			.sort((a, b) => a.name.localeCompare(b.name, 'de'))
	);
	const childFiles = $derived(
		files
			.filter((file) => file.folderId === selectedFolderId)
			.sort((a, b) => a.name.localeCompare(b.name, 'de'))
	);
	const currentPath = $derived(folderPath(folders, selectedFolderId || rootId));

	$effect(() => {
		if (!open) return;
		if (primed === openedToken) return;
		primed = openedToken;
		filename = initialName;
		selectedFolderId = rootId;
		selectedFileId = null;
	});

	function chooseFolder(folderId: string) {
		selectedFolderId = folderId;
		selectedFileId = null;
	}

	function pickFile(file: WebDavTreeFile) {
		selectedFileId = file.id;
		filename = file.name;
	}

	function submit() {
		if (busy) return;
		onsave(selectedFolderId || rootId, filename);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="save-as gap-0 overflow-hidden p-0 sm:max-w-3xl">
		<div class="save-header">
			<Dialog.Title>Dateien</Dialog.Title>
			<Dialog.Description class="sr-only">
				Ordner wählen und Dateiname festlegen.
			</Dialog.Description>
		</div>
		<div class="explorer-panes">
			<section class="pane" aria-label="Ordner">
				<div class="pane-label">Ordner</div>
				<ScrollArea class="pane-scroll">
					<ul>
						{#each rows as row (row.folder.id)}
							<li class:selected={selectedFolderId === row.folder.id}>
								<button
									type="button"
									class="row"
									style:padding-left={`${0.7 + row.depth * 0.9}rem`}
									aria-current={selectedFolderId === row.folder.id ? 'true' : undefined}
									onclick={() => chooseFolder(row.folder.id)}
								>
									<Folder />
									<span>{row.folder.name}</span>
								</button>
							</li>
						{/each}
					</ul>
				</ScrollArea>
			</section>
			<section class="pane" aria-label="Inhalt">
				<div class="pane-label path">{currentPath}</div>
				<ScrollArea class="pane-scroll">
					{#if childFolders.length === 0 && childFiles.length === 0}
						<p class="empty">Dieser Ordner ist leer.</p>
					{:else}
						<ul>
							{#each childFolders as folder (folder.id)}
								<li>
									<button
										type="button"
										class="row"
										ondblclick={() => chooseFolder(folder.id)}
										onclick={() => chooseFolder(folder.id)}
									>
										<Folder />
										<span>{folder.name}</span>
									</button>
								</li>
							{/each}
							{#each childFiles as file (file.id)}
								<li class:selected={selectedFileId === file.id}>
									<button
										type="button"
										class="row"
										aria-current={selectedFileId === file.id ? 'true' : undefined}
										onclick={() => pickFile(file)}
									>
										<FileCode />
										<span>{file.name}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</ScrollArea>
			</section>
		</div>
		<form class="save-footer" onsubmit={(event) => (event.preventDefault(), submit())}>
			<Label for="wwschool-save-name">Name</Label>
			<input
				id="wwschool-save-name"
				class="name-input"
				bind:value={filename}
				autocomplete="off"
				spellcheck="false"
				disabled={busy}
			/>
			<Button type="button" variant="outline" disabled={busy} onclick={() => (open = false)}
				>Abbrechen</Button
			>
			<Button type="submit" disabled={busy}>
				{#if busy}<LoaderCircle class="animate-spin" />{/if}
				Speichern
			</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>

<style>
	.save-header {
		padding: 1rem 3.2rem 0.9rem 1rem;
	}
	.explorer-panes {
		display: grid;
		grid-template-columns: minmax(13rem, 0.85fr) minmax(0, 1.15fr);
		height: min(26rem, calc(100svh - 14rem));
		min-height: 16rem;
		border-block: 1px solid var(--border);
	}
	@media (max-width: 899px) {
		.save-header {
			padding-right: 2.6rem;
		}
		.explorer-panes {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(6.5rem, 0.72fr) minmax(0, 1fr);
			height: min(62svh, 30rem);
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
	.pane-label.path {
		text-transform: none;
		letter-spacing: 0;
		font: 500 0.75rem/1.2 var(--font-code);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		align-items: center;
		min-height: 2rem;
		border-radius: 0.4rem;
	}
	li.selected {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.row {
		display: flex;
		align-items: center;
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
	:global(.row svg) {
		width: 0.9rem;
		height: 0.9rem;
		flex: 0 0 auto;
	}
	.empty {
		margin: 0;
		padding: 1rem 0.8rem;
		color: var(--muted-foreground);
		font-size: 0.78rem;
	}
	.save-footer {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.55rem;
		padding: 0.85rem 1rem 1rem;
	}
	@media (max-width: 899px) {
		.save-footer {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.save-footer :global(button) {
			grid-column: 1 / -1;
		}
	}
	.save-footer :global(label) {
		color: var(--muted-foreground);
	}
	.name-input {
		height: 2.25rem;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--background);
		color: var(--foreground);
		font: 400 0.85rem/1 var(--font-code);
		padding: 0 0.6rem;
	}
</style>
