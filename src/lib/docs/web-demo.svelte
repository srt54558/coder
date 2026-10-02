<script lang="ts" module>
	let issued = 0;

	function issueToken() {
		issued += 1;
		return issued;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { renderDocumentPreview } from '#lib/editor/document-preview.js';
	import { previewDocument, readPreviewMessage } from '#lib/editor/preview.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { clipBlocks } from '#lib/runner/limits.js';
	import { isHtmlFile } from '#lib/workspace/model.js';

	let { code, filename }: { code: string; filename?: string } = $props();

	let edited = $state<string | null>(null);
	let doc = $state('');
	let logs = $state<{ level: string; text: string }[]>([]);
	let token = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const draft = $derived(edited ?? code);
	const dirty = $derived(edited !== null && edited !== code);

	function onMessage(event: MessageEvent) {
		const message = readPreviewMessage(event.data, token);
		if (!message) return;
		logs = clipBlocks([...logs, message]);
	}

	function publish(source: string) {
		token = issueToken();
		logs = [];
		const dark = document.documentElement.classList.contains('dark');
		const rendered =
			filename && !isHtmlFile(filename) ? renderDocumentPreview(filename, source, dark) : source;
		doc = previewDocument(rendered, token);
	}

	function onInput(event: Event) {
		const target = event.currentTarget;
		if (!(target instanceof HTMLTextAreaElement)) return;
		edited = target.value;
		if (timer) clearTimeout(timer);
		const source = target.value;
		timer = setTimeout(() => publish(source), 160);
	}

	function reset() {
		if (timer) clearTimeout(timer);
		edited = null;
		publish(code);
	}

	onMount(() => {
		window.addEventListener('message', onMessage);
		publish(code);
		return () => {
			if (timer) clearTimeout(timer);
			window.removeEventListener('message', onMessage);
		};
	});
</script>

<div class="demo">
	<textarea
		spellcheck="false"
		autocapitalize="off"
		autocomplete="off"
		{@attach (node) => node.setAttribute('autocorrect', 'off')}
		aria-label="Beispiel"
		value={draft}
		oninput={onInput}></textarea>
	{#if doc}
		<iframe
			title="Vorschau"
			sandbox="allow-scripts allow-forms allow-popups allow-modals"
			referrerpolicy="no-referrer"
			srcdoc={doc}
		></iframe>
	{/if}
	{#if logs.length}
		<div class="demo-logs">
			{#each logs as line, index (index)}
				<p class:bad={line.level === 'error' || line.level === 'warn'}>{line.text}</p>
			{/each}
		</div>
	{/if}
	{#if dirty}
		<div class="demo-actions">
			<Button variant="ghost" size="sm" onclick={reset}>Zurücksetzen</Button>
		</div>
	{/if}
</div>

<style>
	.demo {
		display: grid;
		gap: 0.55rem;
	}
	textarea {
		width: 100%;
		min-height: 6.5rem;
		margin: 0;
		padding: 0.7rem 0.75rem;
		resize: vertical;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: color-mix(in oklch, var(--muted) 35%, var(--background));
		color: var(--foreground);
		font: 400 0.82rem/1.55 var(--font-code);
		font-variant-ligatures: contextual;
		font-feature-settings:
			'calt' 1,
			'liga' 1;
		field-sizing: fixed;
		max-width: 100%;
		min-width: 0;
		overflow: auto;
	}
	textarea:focus {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	iframe {
		width: 100%;
		height: 11rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: #fff;
	}
	.demo-logs {
		display: grid;
		gap: 0.2rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border);
		background: var(--background);
	}
	.demo-logs p {
		margin: 0;
		font: 400 0.8rem/1.45 var(--font-code);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.bad {
		color: var(--destructive);
	}
	.demo-actions {
		display: flex;
	}
</style>
