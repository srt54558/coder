<script lang="ts">
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { requestDocsPopup } from '#lib/docs/popup.js';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	if (browser) {
		requestDocsPopup();
		void goto(resolve('/'), { replace: true });
	}
</script>

{@render children()}
