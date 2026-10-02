import { describe, expect, it } from 'vitest';
import { resolveProjectPath } from './links';
import {
	editorLineForPreview,
	previewDocument,
	previewFileFromUrl,
	readPreviewDone,
	readPreviewMessage,
	readPreviewRequest,
	scriptDocument,
	scriptLineOffset
} from './preview';

const page = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <style>h1 { color: red; }</style>
</head>
<body>
  <h1>Hallo</h1>
  <script>console.log("geladen")</script>
</body>
</html>`;

describe('html preview', () => {
	it('keeps a full document and runs the bridge before page scripts', () => {
		const html = previewDocument(page, 4);
		expect(html).toContain('<style>h1 { color: red; }</style>');
		expect(html).toContain('console.log("geladen")');
		expect(html.indexOf('kplus-preview')).toBeLessThan(html.indexOf('console.log("geladen")'));
		expect(html).toContain('<!--kplus-preview:4-->');
	});

	it('wraps a fragment so style and script still belong to the page', () => {
		const html = previewDocument(
			'<h1>Hi</h1><style>h1{color:blue}</style><script>console.log(1)</script>',
			2
		);
		expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
		expect(html).toContain('<h1>Hi</h1>');
		expect(html).toContain('<style>h1{color:blue}</style>');
		expect(html.indexOf('parent.postMessage')).toBeLessThan(html.indexOf('<h1>Hi</h1>'));
	});

	it('accepts only the current preview generation', () => {
		expect(
			readPreviewMessage({ source: 'kplus-preview', token: 3, level: 'log', text: ' hi ' }, 3)
		).toEqual({
			level: 'log',
			text: 'hi'
		});
		expect(
			readPreviewMessage({ source: 'kplus-preview', token: 2, level: 'log', text: 'alt' }, 3)
		).toBeNull();
		expect(readPreviewMessage({ source: 'other', token: 3, text: 'nein' }, 3)).toBeNull();
		expect(
			readPreviewMessage({ source: 'kplus-preview', token: 3, kind: 'open', url: 'a.html' }, 3)
		).toBeNull();
		expect(
			readPreviewRequest({ source: 'kplus-preview', token: 3, kind: 'open', url: 'a.html' }, 3)
		).toEqual({
			kind: 'open',
			url: 'a.html'
		});
	});

	it('inlines local stylesheets, scripts, and css imports', () => {
		const html = previewDocument(
			'<link rel="stylesheet" href="style.css"><script src="app.js"></script>',
			1,
			{
				baseDir: '',
				files: [
					{ path: 'style.css', content: 'h1 { color: red; }' },
					{ path: 'app.js', content: 'console.log("von js")' }
				]
			}
		);
		expect(html).toContain(encodeURIComponent('h1 { color: red; }'));
		expect(html).toContain(encodeURIComponent('console.log("von js")'));
		expect(html).toContain(encodeURIComponent('//# sourceURL=app.js'));
		const imported = previewDocument('<style>@import "b.css";</style>', 1, {
			baseDir: '',
			files: [{ path: 'b.css', content: 'p{color:blue}' }]
		});
		expect(imported).toContain('p{color:blue}');
	});

	it('maps a preview error line back onto the editor', () => {
		const page =
			'<!DOCTYPE html>\n<html>\n<head></head>\n<body>\n<h1>Hallo</h1>\n</body>\n</html>\n';
		const full = previewDocument(page, 1);
		const fullLine = full.split('\n').findIndex((line) => line.includes('<h1>Hallo</h1>')) + 1;
		expect(editorLineForPreview(page, 1, fullLine)).toBe(5);
		const fragment = previewDocument('<h1>Hallo</h1>', 1);
		const fragmentLine =
			fragment.split('\n').findIndex((line) => line.includes('<h1>Hallo</h1>')) + 1;
		expect(editorLineForPreview('<h1>Hallo</h1>', 1, fragmentLine)).toBe(1);
		expect(
			readPreviewMessage(
				{ source: 'kplus-preview', token: 3, level: 'error', text: 'x', line: 4, column: 2 },
				3
			)
		).toEqual({ level: 'error', text: 'x', line: 4, column: 2 });
	});

	it('names a linked script and ignores the preview document itself', () => {
		expect(previewFileFromUrl('app.js')).toBe('app.js');
		expect(previewFileFromUrl('http://127.0.0.1:5173/js/app.js')).toBe('js/app.js');
		expect(previewFileFromUrl('about:srcdoc')).toBeNull();
		expect(previewFileFromUrl('data:text/javascript,console.log(1)')).toBeNull();
	});

	it('runs a javascript file on its own and maps the first line', () => {
		const source = 'console.log("eins")';
		const doc = scriptDocument(source, 7);
		const offset = scriptLineOffset(doc);
		const line = doc.split('\n').findIndex((entry) => entry.includes('console.log("eins")')) + 1;
		expect(line - offset).toBe(1);
		expect(doc).toContain('kind:"done"');
		expect(readPreviewDone({ source: 'kplus-preview', token: 7, kind: 'done' }, 7)).toBe(true);
		expect(
			readPreviewMessage(
				{ source: 'kplus-preview', token: 7, kind: 'done', level: 'log', text: '.' },
				7
			)
		).toBe(null);
	});

	it('resolves a project path from a folder and refuses to leave the project', () => {
		expect(resolveProjectPath('', '../x')).toBeNull();
		expect(resolveProjectPath('css', '../style.css')).toBe('style.css');
		expect(resolveProjectPath('', 'js/app.js')).toBe('js/app.js');
		expect(resolveProjectPath('', 'https://example.com/a.js')).toBeNull();
	});
});
