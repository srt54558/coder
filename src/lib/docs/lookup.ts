import { LESSONS, type Lesson } from './lessons';
import { WEB_LESSONS } from './web-lessons';
import type { CodeLanguage } from '#lib/workspace/model.js';

const GROUPS: Record<Exclude<CodeLanguage, 'python'>, string> = {
	html: 'HTML',
	css: 'CSS',
	javascript: 'JavaScript',
	json: 'JSON',
	xml: 'XML',
	markdown: 'Markdown',
	text: 'Text'
};

export function lessonsForLanguage(language: CodeLanguage): Lesson[] {
	if (language === 'python') return LESSONS;
	const group = GROUPS[language];
	return WEB_LESSONS.filter((lesson) => lesson.group === group);
}

export function languageForLessonId(id: string): CodeLanguage | null {
	if (LESSONS.some((lesson) => lesson.id === id)) return 'python';
	const lesson = WEB_LESSONS.find((item) => item.id === id);
	if (!lesson) return null;
	const groups: Record<string, Exclude<CodeLanguage, 'python'>> = {
		HTML: 'html',
		CSS: 'css',
		JavaScript: 'javascript',
		JSON: 'json',
		XML: 'xml',
		Markdown: 'markdown',
		Text: 'text'
	};
	return groups[lesson.group] ?? null;
}

export function lessonForToken(language: CodeLanguage, token: string): Lesson | null {
	const needle = token.trim().toLocaleLowerCase('de-DE');
	if (!needle) return null;
	const lessons = lessonsForLanguage(language);
	const keywordHits = lessons.filter((lesson) =>
		lesson.keywords.some((keyword) => keyword.toLocaleLowerCase('de-DE') === needle)
	);
	if (keywordHits.length > 0) return keywordHits[0];
	return (
		lessons.find((lesson) => lesson.title.toLocaleLowerCase('de-DE') === needle) ??
		lessons.find((lesson) => lesson.id.toLocaleLowerCase('de-DE') === needle) ??
		null
	);
}
