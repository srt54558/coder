/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `k-plus-coder-${version}`;

function manifestPath(entry: { path: string } | string): string {
	return typeof entry === 'string' ? entry : entry.path;
}

function withSlash(pathname: string): string {
	return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

// `_headers` is a Cloudflare config file, not an app asset. `_app` stays included.
const PRECACHE = [
	...new Set(
		[...immutable, ...assets, ...prerendered]
			.map(manifestPath)
			.filter((pathname) => pathname.length > 0)
			.map(withSlash)
	)
].filter((pathname) => {
	const name = pathname.slice(pathname.lastIndexOf('/') + 1);
	if (name === '_headers' || name === '_redirects') return false;
	if (pathname.includes('/pyodide/')) return false;
	if (pathname.endsWith('.wasm')) return false;
	return true;
});

// A new worker waits until open editors close, so an update cannot drop hashed
// files out from under a running session.
sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET' || request.headers.has('range')) return;
	if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

	const url = new URL(request.url);
	// Pyodide is served with the site from /pyodide. Leave other origins alone.
	if (url.origin !== sw.location.origin) return;
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
	if (url.pathname.endsWith('/service-worker.js')) return;

	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request, '/'));
		return;
	}

	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(cacheFirst(url.pathname, request));
		return;
	}

	if (url.pathname.includes('/pyodide/') || url.pathname.endsWith('.wasm')) {
		event.respondWith(cacheFirstRequest(request));
		return;
	}

	event.respondWith(networkFirst(request));
});

async function cacheFirst(pathname: string, request: Request) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(pathname);
	if (cached) return cached;
	return networkFirst(request);
}

async function cacheFirstRequest(request: Request) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	return networkFirst(request);
}

async function networkFirst(request: Request, fallbackPath?: string) {
	const cache = await caches.open(CACHE);
	try {
		const response = await fetch(request);
		if (response.ok && response.type === 'basic') {
			try {
				await cache.put(request, response.clone());
			} catch {
				// A full cache must not take the editor down.
			}
		}
		return response;
	} catch (error) {
		const cached =
			(await cache.match(request)) ?? (fallbackPath ? await cache.match(fallbackPath) : undefined);
		if (cached) return cached;
		throw error;
	}
}
