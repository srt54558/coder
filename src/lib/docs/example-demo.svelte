<script lang="ts">
	import { onDestroy } from 'svelte';
	import Play from '@lucide/svelte/icons/play';
	import { Button } from '#lib/components/ui/button/index.js';

	let { code, output }: { code: string; output: string } = $props();

	let edited = $state<string | null>(null);
	let running = $state(false);
	let ran = $state(false);
	let shown = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	const draft = $derived(edited ?? code);
	const dirty = $derived(edited !== null && edited !== code);
	const runLabel = $derived(running ? 'Läuft' : 'Ausführen');

	function execute() {
		if (running) return;
		running = true;
		ran = true;
		shown = '';
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			shown = output;
			running = false;
		}, 180);
	}

	function reset() {
		if (timer) clearTimeout(timer);
		edited = null;
		running = false;
		shown = '';
		ran = false;
	}

	onDestroy(() => {
		if (timer) clearTimeout(timer);
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
		oninput={(event) => (edited = event.currentTarget.value)}></textarea>
	<div class="demo-actions">
		<Button variant="outline" size="sm" onclick={execute} disabled={running} title={runLabel}
			><Play />{runLabel}</Button
		>
		{#if dirty}
			<Button variant="ghost" size="sm" onclick={reset}>Zurücksetzen</Button>
		{/if}
	</div>
	{#if ran}
		<pre class="demo-out">{running ? '' : shown || 'Keine Ausgabe'}</pre>
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
	.demo-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.demo-out {
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0;
		font: 400 0.8rem/1.5 var(--font-code);
		font-variant-ligatures: contextual;
		font-feature-settings:
			'calt' 1,
			'liga' 1;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--foreground);
		background: var(--background);
		min-height: 2.4rem;
	}
</style>
