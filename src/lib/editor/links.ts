import { fileMime, isHtmlFile } from '#lib/workspace/model.js';

export type ProjectTextFile = {
	path: string;
	content: string;
};

function directoryOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

function fileKey(path: string): string {
	return path.toLocaleLowerCase('de');
}

export function resolveProjectPath(fromDir: string, raw: string): string | null {
	const value = raw.trim();
	if (!value || value.startsWith('#') || value.startsWith('?')) return null;
	if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('//')) return null;
	const path = value.split('#')[0]?.split('?')[0] ?? '';
	if (!path) return null;
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		decoded = path;
	}
	const segments = decoded.startsWith('/') ? [] : fromDir.split('/').filter(Boolean);
	for (const part of decoded.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (!segments.length) return null;
			segments.pop();
			continue;
		}
		if (part.includes('\\') || part.includes('\0')) return null;
		segments.push(part);
	}
	return segments.length ? segments.join('/') : null;
}

export function textDataUrl(mime: string, content: string): string {
	return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
}

function linkedContent(path: string, files: Map<string, string>, seen: Set<string>): string | null {
	const key = fileKey(path);
	const content = files.get(key);
	if (content == null) return null;
	if (seen.has(key)) return content;
	const next = new Set(seen);
	next.add(key);
	const directory = directoryOf(path);
	if (key.endsWith('.css')) return rewriteCss(content, directory, files, next);
	if (key.endsWith('.js')) return rewriteModuleSpecifiers(content, directory, files, next);
	return content;
}

function embed(path: string, files: Map<string, string>, seen: Set<string>): string | null {
	const body = linkedContent(path, files, seen);
	if (body == null) return null;
	return textDataUrl(fileMime(path), body);
}

function scriptSource(path: string, files: Map<string, string>, seen: Set<string>): string | null {
	const body = linkedContent(path, files, seen);
	if (body == null) return null;
	const marked = `${body.endsWith('\n') ? body : `${body}\n`}//# sourceURL=${path}\n`;
	return textDataUrl(fileMime(path), marked);
}

function rewriteCss(
	css: string,
	fromDir: string,
	files: Map<string, string>,
	seen: Set<string>
): string {
	const withUrls = css.replace(
		/url\(\s*(['"]?)([^'")]+)\1\s*\)/giu,
		(match, _quote, url: string) => {
			const resolved = resolveProjectPath(fromDir, url.trim());
			if (!resolved) return match;
			const href = embed(resolved, files, seen);
			return href ? `url("${href}")` : 'url("data:,")';
		}
	);
	return withUrls.replace(
		/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/giu,
		(match, _quote, url: string) => {
			const resolved = resolveProjectPath(fromDir, url.trim());
			if (!resolved) return match;
			const body = linkedContent(resolved, files, seen);
			return body ?? '';
		}
	);
}

export function rewriteModuleSpecifiers(
	code: string,
	fromDir: string,
	files: Map<string, string>,
	seen: Set<string>
): string {
	return code.replace(
		/(\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\2/gu,
		(match, prefix: string, quote: string, spec: string) => {
			const resolved = resolveProjectPath(fromDir, spec);
			if (!resolved) return match;
			const body = linkedContent(resolved, files, seen);
			if (body == null) return match;
			return `${prefix}${quote}${textDataUrl(fileMime(resolved), body)}${quote}`;
		}
	);
}

function fileMap(files: ProjectTextFile[]): Map<string, string> {
	return new Map(files.map((file) => [fileKey(file.path), file.content]));
}

function rewriteStyleTags(html: string, baseDir: string, files: Map<string, string>): string {
	return html.replace(
		/<style\b([^>]*)>([\s\S]*?)<\/style>/giu,
		(_tag, attrs: string, css: string) => {
			return `<style${attrs}>${rewriteCss(css, baseDir, files, new Set())}</style>`;
		}
	);
}

function rewriteInlineModules(html: string, baseDir: string, files: Map<string, string>): string {
	return html.replace(
		/<script\b([^>]*)>([\s\S]*?)<\/script>/giu,
		(tag, attrs: string, code: string) => {
			if (/\bsrc\s*=/iu.test(attrs) || !/type\s*=\s*(['"])module\1/iu.test(attrs)) return tag;
			return `<script${attrs}>${rewriteModuleSpecifiers(code, baseDir, files, new Set())}</script>`;
		}
	);
}

function rewriteResources(html: string, baseDir: string, files: Map<string, string>): string {
	return html.replace(
		/<(link|script|img|source|audio|video)\b([^>]*?)>/giu,
		(tag, name: string, attrs: string) => {
			const attribute = name.toLowerCase() === 'link' ? 'href' : 'src';
			const nextAttrs = attrs.replace(
				new RegExp(`(\\s${attribute}\\s*=\\s*)(['"])([^'"]*)\\2`, 'iu'),
				(match, prefix: string, quote: string, url: string) => {
					const resolved = resolveProjectPath(baseDir, url);
					if (!resolved) return match;
					const href =
						name.toLowerCase() === 'script'
							? scriptSource(resolved, files, new Set())
							: embed(resolved, files, new Set());
					return href ? `${prefix}${quote}${href}${quote}` : `${prefix}${quote}data:,${quote}`;
				}
			);
			return `<${name}${nextAttrs}>`;
		}
	);
}

const TAG_URL = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/giu;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/giu;
const CSS_URL = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/giu;
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/gu;

function referencedPaths(source: string, fromDir: string): string[] {
	const found: string[] = [];
	const add = (raw: string) => {
		const resolved = resolveProjectPath(fromDir, raw.trim());
		if (resolved) found.push(resolved);
	};
	for (const match of source.matchAll(TAG_URL)) add(match[2] ?? '');
	for (const match of source.matchAll(CSS_IMPORT)) add(match[2] ?? '');
	for (const match of source.matchAll(CSS_URL)) add(match[2] ?? '');
	for (const match of source.matchAll(JS_IMPORT)) add(match[2] ?? '');
	return found;
}

function reachesAsset(
	source: string,
	fromDir: string,
	assetKey: string,
	files: Map<string, ProjectTextFile>,
	seen: Set<string>
): boolean {
	for (const path of referencedPaths(source, fromDir)) {
		const key = fileKey(path);
		if (key === assetKey) return true;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!key.endsWith('.css') && !key.endsWith('.js')) continue;
		const next = files.get(key);
		if (!next) continue;
		if (reachesAsset(next.content, directoryOf(path), assetKey, files, seen)) return true;
	}
	return false;
}

/** HTML file that loads `assetPath`, directly or through a CSS or JS file it loads. */
export function htmlUsingAsset(
	files: readonly ProjectTextFile[],
	assetPath: string,
	preferredPath?: string
): string | null {
	const assetKey = fileKey(assetPath);
	const byKey = new Map(files.map((file) => [fileKey(file.path), file]));
	const htmlFiles = files.filter((file) => isHtmlFile(file.path));
	const preferred = preferredPath ? fileKey(preferredPath) : '';
	const ordered = [...htmlFiles].sort((a, b) => {
		if (fileKey(a.path) === preferred) return -1;
		if (fileKey(b.path) === preferred) return 1;
		return 0;
	});
	for (const html of ordered) {
		if (reachesAsset(html.content, directoryOf(html.path), assetKey, byKey, new Set()))
			return html.path;
	}
	return null;
}

export function linkDocument(source: string, baseDir: string, files: ProjectTextFile[]): string {
	const map = fileMap(files);
	return rewriteResources(
		rewriteInlineModules(rewriteStyleTags(source, baseDir, map), baseDir, map),
		baseDir,
		map
	);
}
