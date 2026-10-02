<script lang="ts">
	import ExampleDemo from '#lib/docs/example-demo.svelte';
	import Guide from '#lib/docs/guide.svelte';
	import WebDemo from '#lib/docs/web-demo.svelte';
	import { LESSONS, type Lesson } from '#lib/docs/lessons.js';
	import { WEB_LESSONS } from '#lib/docs/web-lessons.js';
	import type { CodeLanguage } from '#lib/workspace/model.js';

	let {
		fill = false,
		language,
		focusId = ''
	}: { fill?: boolean; language: CodeLanguage; focusId?: string } = $props();

	const topics = {
		html: { label: 'HTML', lead: 'Elemente, Text und das Gerüst einer Seite.' },
		css: { label: 'CSS', lead: 'Farben, Abstände und Layout.' },
		javascript: { label: 'JavaScript', lead: 'Verhalten in der Seite und in eigenen Dateien.' },
		json: { label: 'JSON', lead: 'Daten als Text.' },
		xml: { label: 'XML', lead: 'Strukturierte Daten mit Tags.' },
		markdown: { label: 'Markdown', lead: 'Text mit einfacher Auszeichnung.' },
		text: { label: 'Text', lead: 'Zeichen, sonst nichts.' },
		python: {
			label: 'Python',
			lead: 'Kurz erklärt. Ausführen zeigt die Ausgabe des Beispiels.'
		}
	} as const;

	const topic = $derived(topics[language]);
	const lessons = $derived(
		language === 'python' ? LESSONS : WEB_LESSONS.filter((lesson) => lesson.group === topic.label)
	);
</script>

{#snippet example(lesson: Lesson)}
	{#if language === 'python'}
		<ExampleDemo code={lesson.code} output={lesson.output ?? ''} />
	{:else}
		<WebDemo code={lesson.code} filename={lesson.filename} />
	{/if}
{/snippet}

<div class="browser" class:fill>
	{#key language}
		<Guide title={topic.label} lead={topic.lead} {lessons} {example} embedded={fill} {focusId} />
	{/key}
</div>

<style>
	.browser {
		min-height: 100dvh;
		background: var(--background);
		color: var(--foreground);
	}
	.browser.fill {
		min-height: 0;
		height: 100%;
	}
</style>
