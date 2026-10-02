import { describe, expect, it } from 'vitest';
import { previewDocument } from './preview';
import { renderDocumentPreview } from './document-preview';

describe('document preview', () => {
	it('renders markdown as a page and leaves html untouched', () => {
		const page = renderDocumentPreview(
			'notiz.md',
			'# Titel\n\nEin **Satz** und `code`.\n\n- Punkt\n'
		);
		expect(page).toContain('<h1>Titel</h1>');
		expect(page).toContain('<strong>Satz</strong>');
		expect(page).toContain('<code>code</code>');
		expect(page).toContain('<li>Punkt</li>');
		expect(renderDocumentPreview('seite.html', '<h1>Hallo</h1>')).toBe('<h1>Hallo</h1>');
	});

	it('shows json, xml, and text without treating them as markup', () => {
		expect(renderDocumentPreview('daten.json', '{"name":"Welt"}')).toContain('"name": "Welt"');
		expect(renderDocumentPreview('daten.xml', '<name>Welt</name>')).toContain(
			'&lt;name&gt;Welt&lt;/name&gt;'
		);
		expect(renderDocumentPreview('notiz.txt', '<b>roh</b>')).toContain('&lt;b&gt;roh&lt;/b&gt;');
		expect(renderDocumentPreview('app.js', 'if (a < b)')).toContain('a &lt; b');
		expect(renderDocumentPreview('style.css', 'h1 { color: red; }')).toContain(
			'h1 { color: red; }'
		);
	});

	it('keeps a dark page distinct and inlines a local markdown image', () => {
		expect(renderDocumentPreview('notiz.md', '# Hallo', true)).toContain('background: #1c1410');
		const html = previewDocument(renderDocumentPreview('notiz.md', '![Foto](foto.png)'), 1, {
			baseDir: '',
			files: [{ path: 'foto.png', content: 'bild' }]
		});
		expect(html).toContain('data:text/plain');
		expect(html).toContain(encodeURIComponent('bild'));
	});
});
