import { describe, expect, it } from 'vitest';
import { LESSONS } from './lessons';
import { WEB_LESSONS, webLessonMatches } from './web-lessons';

describe('web lessons', () => {
	it('keeps every lesson when the query is empty', () => {
		expect(webLessonMatches('  ')).toHaveLength(WEB_LESSONS.length);
	});

	it('finds flex, a click handler, and nothing for a missing word', () => {
		expect(webLessonMatches('flex').map((lesson) => lesson.id)).toEqual(['css-reihe']);
		expect(webLessonMatches('addEventListener').some((lesson) => lesson.id === 'js-klick')).toBe(
			true
		);
		expect(webLessonMatches('kein-treffer')).toHaveLength(0);
	});

	it('uses its own ids and keeps each file type in its own group', () => {
		const ids = WEB_LESSONS.map((lesson) => lesson.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => !LESSONS.some((lesson) => lesson.id === id))).toBe(true);
		expect(WEB_LESSONS.every((lesson) => lesson.text && lesson.code.trim())).toBe(true);
		expect(
			WEB_LESSONS.filter((lesson) => !lesson.filename).every((lesson) => lesson.code.includes('<'))
		).toBe(true);
		expect(WEB_LESSONS.find((lesson) => lesson.id === 'txt-nur')?.code).toBe(
			'... es ist nur text :D'
		);
		const groups = [...new Set(WEB_LESSONS.map((lesson) => lesson.group))];
		expect(groups).toEqual(['HTML', 'CSS', 'JavaScript', 'JSON', 'XML', 'Markdown', 'Text']);
	});
});
