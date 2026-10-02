import { Marked } from 'marked';
import { codeLanguage } from '#lib/workspace/model.js';

const markdown = new Marked({ gfm: true });

function escapeHtml(value: string): string {
	return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function prettyJson(source: string): string {
	try {
		return JSON.stringify(JSON.parse(source), null, 2);
	} catch {
		return source;
	}
}

function renderMarkdown(source: string): string {
	try {
		return markdown.parse(source, { async: false });
	} catch {
		return `<pre class="kplus-plain">${escapeHtml(source)}</pre>`;
	}
}

function documentStyle(dark: boolean): string {
	const background = dark ? '#1c1410' : '#fffdf8';
	const foreground = dark ? '#f6f0e8' : '#1c1917';
	const muted = dark ? '#2a221c' : '#f4f1ec';
	const line = dark ? '#4a3f36' : '#e7e0d8';
	const link = dark ? '#e8a87c' : '#9a3412';
	return `<style>
body { margin: 0; background: ${background}; color: ${foreground}; font: 17px/1.6 Georgia, "Iowan Old Style", Palatino, serif; }
.kplus-doc { max-width: 42rem; margin: 0 auto; padding: 1.75rem 1.25rem 3rem; }
.kplus-doc h1, .kplus-doc h2, .kplus-doc h3 { line-height: 1.25; }
.kplus-doc pre, .kplus-doc code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
.kplus-doc pre { padding: 0.85rem 1rem; overflow: auto; background: ${muted}; border-radius: 0.5rem; }
.kplus-doc :not(pre) > code { background: ${muted}; padding: 0.1em 0.35em; border-radius: 0.25rem; }
.kplus-doc img { max-width: 100%; height: auto; }
.kplus-doc blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid ${line}; }
.kplus-doc table { border-collapse: collapse; }
.kplus-doc th, .kplus-doc td { border: 1px solid ${line}; padding: 0.35rem 0.55rem; }
.kplus-doc a { color: ${link}; }
.kplus-plain { white-space: pre-wrap; }
</style>`;
}

/** HTML for the preview pane. HTML files stay as written; documents become a page. */
export function renderDocumentPreview(filename: string, source: string, dark = false): string {
	switch (codeLanguage(filename)) {
		case 'markdown':
			return `${documentStyle(dark)}<article class="kplus-doc">${renderMarkdown(source)}</article>`;
		case 'json':
			return `${documentStyle(dark)}<article class="kplus-doc"><pre class="kplus-plain">${escapeHtml(prettyJson(source))}</pre></article>`;
		case 'xml':
		case 'text':
		case 'css':
		case 'javascript':
			return `${documentStyle(dark)}<article class="kplus-doc"><pre class="kplus-plain">${escapeHtml(source)}</pre></article>`;
		default:
			return source;
	}
}
