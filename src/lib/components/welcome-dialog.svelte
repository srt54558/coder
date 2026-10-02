<script lang="ts">
	import Coffee from '@lucide/svelte/icons/coffee';
	import Flower2 from '@lucide/svelte/icons/flower-2';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import type { AppTheme } from '#lib/theme.js';
	import { WELCOME_FILES, WELCOME_LANGUAGES, type WelcomeLanguage } from '#lib/workspace/model.js';

	let {
		open,
		theme,
		ontheme,
		onstart
	}: {
		open: boolean;
		theme: AppTheme;
		ontheme: (theme: AppTheme) => void;
		onstart: (language: WelcomeLanguage) => void;
	} = $props();

	let language = $state<WelcomeLanguage>('python');

	const styles: { id: AppTheme; label: string }[] = [
		{ id: 'light', label: 'Hell' },
		{ id: 'dark', label: 'Dunkel' },
		{ id: 'coffee', label: 'Kaffee' },
		{ id: 'pink', label: 'Rosa' }
	];

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onstart(language);
	}
</script>

<Dialog.Root {open}>
	<Dialog.Content
		class="sm:max-w-lg"
		showCloseButton={false}
		interactOutsideBehavior="ignore"
		escapeKeydownBehavior="ignore"
	>
		<Dialog.Header>
			<Dialog.Title>Willkommen</Dialog.Title>
			<Dialog.Description>
				Wähle ein Design und die Sprache der ersten Datei. Beides bleibt in diesem Browser.
			</Dialog.Description>
		</Dialog.Header>
		<form class="grid gap-5" onsubmit={submit}>
			<fieldset class="grid gap-2">
				<legend class="text-sm font-medium">Design</legend>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each styles as style (style.id)}
						<Button
							type="button"
							variant={theme === style.id ? 'secondary' : 'outline'}
							aria-pressed={theme === style.id}
							onclick={() => ontheme(style.id)}
						>
							{#if style.id === 'light'}<Sun />
							{:else if style.id === 'dark'}<Moon />
							{:else if style.id === 'coffee'}<Coffee />
							{:else}<Flower2 />{/if}
							{style.label}
						</Button>
					{/each}
				</div>
			</fieldset>
			<fieldset class="grid gap-2">
				<legend class="text-sm font-medium">Erste Datei</legend>
				<div class="grid grid-cols-2 gap-2">
					{#each WELCOME_LANGUAGES as id (id)}
						<label
							class="flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm has-checked:border-ring has-checked:bg-muted"
						>
							<input type="radio" name="welcome-language" value={id} bind:group={language} />
							{WELCOME_FILES[id].label}
						</label>
					{/each}
				</div>
			</fieldset>
			<Dialog.Footer>
				<Button type="submit">Loslegen</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
