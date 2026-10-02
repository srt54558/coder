<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { newFileNameError, normalizeName } from '#lib/workspace/model.js';

	let {
		open = $bindable(false),
		oncreate
	}: {
		open?: boolean;
		oncreate: (name: string) => void;
	} = $props();

	let name = $state('');
	let error = $state('');
	let field = $state<HTMLInputElement | null>(null);

	async function onOpenChange(value: boolean) {
		if (!value) return;
		name = '';
		error = '';
		await tick();
		field?.focus();
		field?.select();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const problem = newFileNameError(name);
		if (problem) {
			error = problem;
			return;
		}
		oncreate(normalizeName(name));
		name = '';
		error = '';
		open = false;
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Neue Datei</Dialog.Title>
			<Dialog.Description
				>Name mit Endung, zum Beispiel seite.html oder notiz.txt.</Dialog.Description
			>
		</Dialog.Header>
		<form class="grid gap-3" onsubmit={submit}>
			<label class="grid gap-1.5 text-sm font-medium">
				Name
				<input
					class="h-9 w-full rounded-md border border-input bg-background px-3 font-normal"
					bind:this={field}
					bind:value={name}
					oninput={() => (error = '')}
					placeholder="seite.html"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					aria-invalid={error ? 'true' : undefined}
				/>
			</label>
			<p class="text-xs text-muted-foreground">py, html, css, js, json, xml, md, txt</p>
			{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
				<Button type="submit">Anlegen</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
