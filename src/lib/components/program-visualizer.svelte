<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { programBlocks } from '#lib/runner/program-visualizer.js';

	let { code, outputs = {} }: { code: string; outputs?: Record<number, string> } = $props();
	let zoom = $state(1);
	const blocks = $derived(programBlocks(code));

	function changeZoom(amount: number) {
		zoom = Math.min(2, Math.max(0.5, Math.round((zoom + amount) * 10) / 10));
	}
</script>

<section class="visualizer" aria-label="Programmablauf">
	<div class="visualizer-scroll" aria-live="polite">
		{#if blocks.length}
			<div class="flow" style:zoom>
				{#each blocks as block, index (block.line)}
					{@const output = outputs[block.line]}
					<div class="flow-row" style={`--indent: ${block.indent * 5}px`}>
						{#if index > 0}<span class="flow-arrow" aria-hidden="true">↓</span>{/if}
						<div
							class="flow-block"
							class:condition={block.kind === 'condition'}
							class:loop={block.kind === 'loop'}
							class:emitted={output !== undefined}
						>
							<div class="flow-label">
								<span>{block.label}</span><span>Zeile {block.line}</span>
							</div>
							<code>{block.source}</code>
							{#if output !== undefined}
								<pre class="flow-output" aria-live="polite">{output}</pre>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="visualizer-empty">
				<p>Programmablauf</p>
				<p>Python-Code eingeben, um den Ablauf hier live zu sehen.</p>
			</div>
		{/if}
	</div>
	<div class="zoom-dock" aria-label="Zoom-Steuerung">
		<button
			type="button"
			aria-label="Verkleinern"
			title="Verkleinern"
			disabled={zoom <= 0.5}
			onclick={() => changeZoom(-0.1)}><Minus /></button
		>
		<output aria-live="polite">{Math.round(zoom * 100)}%</output>
		<button
			type="button"
			aria-label="Vergrößern"
			title="Vergrößern"
			disabled={zoom >= 2}
			onclick={() => changeZoom(0.1)}><Plus /></button
		>
	</div>
</section>

<style>
	.visualizer {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		background: var(--background);
	}

	.visualizer-scroll {
		min-height: 0;
		flex: 1;
		overflow: auto;
		padding: 1.5rem 1.25rem 2rem;
		overscroll-behavior: contain;
	}

	.flow {
		display: flex;
		width: max-content;
		min-width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.45rem;
		padding-bottom: 1rem;
	}

	.flow-row {
		position: relative;
		padding-left: var(--indent);
	}

	.flow-arrow {
		display: block;
		height: 1.35rem;
		margin-left: 1.4rem;
		color: var(--muted-foreground);
		font: 600 0.85rem/1.35rem var(--font-code);
	}

	.flow-block {
		width: min(34rem, 74vw);
		min-width: 15rem;
		max-width: calc(100vw - 8rem);
		overflow-wrap: anywhere;
		border: 1px solid var(--border);
		border-left: 3px solid color-mix(in oklch, var(--primary) 62%, var(--border));
		border-radius: 0.65rem;
		background: color-mix(in oklch, var(--muted) 22%, var(--background));
		padding: 0.65rem 0.8rem 0.75rem;
		box-shadow: 0 1px 2px color-mix(in oklch, var(--foreground) 5%, transparent);
	}

	.flow-block.condition {
		border-left-color: oklch(68% 0.15 78);
		border-radius: 0.9rem 0.4rem 0.9rem 0.4rem;
	}

	.flow-block.loop {
		border-left-color: oklch(64% 0.13 185);
	}

	.flow-block.emitted {
		border-color: color-mix(in oklch, var(--primary) 58%, var(--border));
		border-left-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 9%, var(--background));
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--primary) 13%, transparent);
	}

	.flow-label {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.35rem;
		color: var(--muted-foreground);
		font: 600 0.68rem/1.2 var(--font-sans);
		letter-spacing: 0.025em;
	}

	.flow-block code {
		color: var(--foreground);
		font: 500 0.82rem/1.55 var(--font-code);
		white-space: pre-wrap;
	}

	.flow-output {
		margin: 0.55rem 0 0;
		border-top: 1px solid color-mix(in oklch, var(--primary) 25%, var(--border));
		padding-top: 0.45rem;
		color: var(--primary);
		font: 500 0.8rem/1.5 var(--font-code);
		white-space: pre-wrap;
	}

	.visualizer-empty {
		display: grid;
		min-height: 100%;
		align-content: center;
		justify-items: center;
		gap: 0.35rem;
		color: var(--muted-foreground);
		text-align: center;
	}

	.visualizer-empty p:first-child {
		margin: 0;
		color: var(--foreground);
		font-weight: 600;
	}

	.visualizer-empty p:last-child {
		margin: 0;
		font-size: 0.82rem;
	}

	.zoom-dock {
		position: sticky;
		bottom: 0;
		z-index: 1;
		display: flex;
		min-height: 2.8rem;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		border-top: 1px solid var(--border);
		background: color-mix(in oklch, var(--background) 94%, transparent);
		backdrop-filter: blur(12px);
	}

	.zoom-dock button {
		display: grid;
		width: 1.9rem;
		height: 1.9rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--background);
		color: var(--foreground);
		cursor: pointer;
	}

	.zoom-dock button:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.zoom-dock :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.zoom-dock output {
		min-width: 3.2rem;
		color: var(--muted-foreground);
		font: 500 0.75rem/1 var(--font-code);
		text-align: center;
	}
</style>
