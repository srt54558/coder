import { linkDocument, type ProjectTextFile } from './links';

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;

function bridgeScript(token: number): string {
	return `<script>(function(){
var token=${token};
function frame(line){var text=String(line||"").trim();var wrapped=/\\((.*):(\\d+):(\\d+)\\)\\s*$/.exec(text);if(wrapped)return {url:wrapped[1],line:+wrapped[2],column:+wrapped[3]};var at=/(\\S+):(\\d+):(\\d+)\\s*$/.exec(text);if(!at)return null;return {url:at[1],line:+at[2],column:+at[3]}}
function locate(stack){var frames=String(stack||"").split("\\n").map(frame).filter(Boolean);var own=[];for(var i=0;i<frames.length;i++){var url=frames[i].url;if(url.indexOf("about:srcdoc")<0&&url.indexOf("blob:")<0&&url.indexOf("data:")<0)return frames[i];own.push(frames[i])}return own.length>1?own[1]:{url:"",line:0,column:0}}
function send(level,values,where){var text="";try{text=values.map(function(value){if(typeof value==="string")return value;try{return JSON.stringify(value)}catch(error){return String(value)}}).join(" ")}catch(error){text=String(error)}var place=where||{url:"",line:0,column:0};parent.postMessage({source:"kplus-preview",token:token,level:level,text:text,line:place.line||0,column:place.column||0,url:place.url||""},"*")}
["${LEVELS.join('","')}"].forEach(function(level){var original=console[level]?console[level].bind(console):function(){};console[level]=function(){var values=[].slice.call(arguments);original.apply(console,values);send(level,values,locate(new Error().stack))}});
window.addEventListener("error",function(event){parent.postMessage({source:"kplus-preview",token:token,level:"error",text:String(event.message||"Fehler"),line:event.lineno||0,column:event.colno||0,url:String(event.filename||"")},"*")});
window.addEventListener("unhandledrejection",function(event){var reason=event.reason;send("error",[reason instanceof Error?reason.message:String(reason)],locate(reason&&reason.stack))});
function isLocal(url){if(!url||url.charAt(0)==="#"||url.charAt(0)==="?")return false;if(/^[a-z][a-z0-9+.-]*:/i.test(url)||url.indexOf("//")===0)return false;return true}
document.addEventListener("click",function(event){var node=event.target;if(!node||!node.closest)return;var link=node.closest("a");if(!link)return;var href=link.getAttribute("href");if(!isLocal(href))return;event.preventDefault();parent.postMessage({source:"kplus-preview",token:token,kind:"open",url:href},"*")},true);
var waiters={};var seq=0;
window.addEventListener("message",function(event){var data=event.data;if(!data||data.source!=="kplus-preview-host"||data.token!==token||data.kind!=="file")return;var waiter=waiters[data.id];if(!waiter)return;delete waiters[data.id];waiter(data)});
function ask(url){return new Promise(function(resolve){var id=++seq;waiters[id]=resolve;parent.postMessage({source:"kplus-preview",token:token,kind:"read",id:id,url:url},"*")})}
var nativeFetch=window.fetch;
window.fetch=function(input,init){var url=typeof input==="string"?input:(input&&input.url);if(!isLocal(url))return nativeFetch.apply(window,arguments);return ask(url).then(function(data){if(!data||data.missing)return new Response("",{status:404,statusText:"Not Found"});return new Response(data.text,{status:200,headers:{"Content-Type":data.mime||"text/plain"}})})};
var xhrOpen=XMLHttpRequest.prototype.open;
var xhrSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(method,url){this.__kplusUrl=isLocal(String(url))?String(url):"";return xhrOpen.apply(this,arguments)};
XMLHttpRequest.prototype.send=function(){if(!this.__kplusUrl)return xhrSend.apply(this,arguments);var xhr=this;ask(this.__kplusUrl).then(function(data){var missing=!data||data.missing;var body=missing?"":data.text;Object.defineProperty(xhr,"status",{configurable:true,value:missing?404:200});Object.defineProperty(xhr,"responseText",{configurable:true,value:body});Object.defineProperty(xhr,"response",{configurable:true,value:body});Object.defineProperty(xhr,"readyState",{configurable:true,value:4});if(typeof xhr.onreadystatechange==="function")xhr.onreadystatechange();if(typeof xhr.onload==="function")xhr.onload()})};
})();</script>`;
}

function isFullDocument(source: string): boolean {
	return /^\s*<!doctype\s+html\b/i.test(source) || /^\s*<html\b/i.test(source);
}

export type PreviewLinks = {
	baseDir: string;
	files: ProjectTextFile[];
};

export function previewDocument(source: string, token: number, links?: PreviewLinks): string {
	const linked = links ? linkDocument(source, links.baseDir, links.files) : source;
	const bridge = bridgeScript(token);
	const mark = `<!--kplus-preview:${token}-->`;
	if (!isFullDocument(linked)) {
		return `<!DOCTYPE html>${mark}<html><head><meta charset="utf-8">${bridge}</head><body>\n${linked}\n</body></html>`;
	}
	if (/<head\b[^>]*>/i.test(linked)) {
		return linked.replace(/<head\b[^>]*>/i, (head) => `${mark}${head}${bridge}`);
	}
	if (/<html\b[^>]*>/i.test(linked)) {
		return linked.replace(
			/<html\b[^>]*>/i,
			(tag) => `${mark}${tag}<head><meta charset="utf-8">${bridge}</head>`
		);
	}
	return `${mark}${bridge}${linked}`;
}

export type PreviewMessage = {
	source: 'kplus-preview';
	token: number;
	level: string;
	text: string;
};

export function readPreviewMessage(
	data: unknown,
	token: number
): { level: string; text: string; line?: number; column?: number; url?: string } | null {
	if (!data || typeof data !== 'object') return null;
	const message = data as Partial<PreviewMessage> & {
		kind?: string;
		line?: number;
		column?: number;
		url?: string;
	};
	if (message.source !== 'kplus-preview' || message.token !== token) return null;
	if (message.kind === 'open' || message.kind === 'read' || message.kind === 'done') return null;
	const text = typeof message.text === 'string' ? message.text.trim() : '';
	if (!text) return null;
	const result: { level: string; text: string; line?: number; column?: number; url?: string } = {
		level: typeof message.level === 'string' ? message.level : 'log',
		text
	};
	if (typeof message.line === 'number' && message.line > 0) result.line = message.line;
	if (typeof message.column === 'number' && message.column > 0) result.column = message.column;
	if (typeof message.url === 'string' && message.url) result.url = message.url;
	return result;
}

/** Project path named by a preview stack or error, when the call did not come from the page itself. */
export function previewFileFromUrl(url: string): string | null {
	const value = url.trim();
	if (
		!value ||
		value.includes('about:srcdoc') ||
		value.startsWith('data:') ||
		value.startsWith('blob:')
	) {
		return null;
	}
	let path = value;
	if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
		try {
			path = new URL(value).pathname;
		} catch {
			return null;
		}
	}
	path = path.split('?')[0]?.split('#')[0] ?? path;
	try {
		path = decodeURIComponent(path);
	} catch {
		return null;
	}
	path = path.replace(/^\.?\//u, '').replace(/^\/+/u, '');
	return path || null;
}

/** Map a line number from the preview document back onto the editor source. */
export function editorLineForPreview(
	source: string,
	token: number,
	previewLine: number,
	links?: PreviewLinks
): number {
	const doc = previewDocument(source, token, links);
	if (!isFullDocument(source)) {
		const marker = '<body>\n';
		const at = doc.indexOf(marker);
		if (at === -1) return Math.max(1, previewLine);
		const contentStartLine = doc.slice(0, at + marker.length).split('\n').length;
		return Math.max(1, previewLine - contentStartLine + 1);
	}
	const inserted = bridgeScript(token);
	const at = doc.indexOf(inserted);
	if (at === -1) return Math.max(1, previewLine);
	const insertLine = doc.slice(0, at).split('\n').length;
	const extra = inserted.split('\n').length - 1;
	return previewLine <= insertLine ? previewLine : Math.max(1, previewLine - extra);
}

const SCRIPT_MARK = '<script type="module">\n';

/** Sandboxed page that runs a JavaScript file and reports when it finishes. */
export function scriptDocument(source: string, token: number, links?: PreviewLinks): string {
	const safe = source.replace(/<\/script/giu, '<\\/script');
	const program = `<script type="module">\n${safe}\n</script><script type="module">parent.postMessage({source:"kplus-preview",token:${token},kind:"done",level:"log",text:"."},"*")</script>`;
	return previewDocument(program, token, links);
}

/** Lines the runner document inserts before the first line of the script. */
export function scriptLineOffset(doc: string): number {
	const at = doc.indexOf(SCRIPT_MARK);
	if (at === -1) return 0;
	return doc.slice(0, at + SCRIPT_MARK.length).split('\n').length - 1;
}

export function readPreviewDone(data: unknown, token: number): boolean {
	if (!token || !data || typeof data !== 'object') return false;
	const message = data as { source?: string; token?: number; kind?: string };
	return message.source === 'kplus-preview' && message.token === token && message.kind === 'done';
}

export type PreviewRequest =
	{ kind: 'open'; url: string } | { kind: 'read'; id: number; url: string };

export function readPreviewRequest(data: unknown, token: number): PreviewRequest | null {
	if (!data || typeof data !== 'object') return null;
	const message = data as {
		source?: string;
		token?: number;
		kind?: string;
		url?: string;
		id?: number;
	};
	if (
		message.source !== 'kplus-preview' ||
		message.token !== token ||
		typeof message.url !== 'string'
	) {
		return null;
	}
	if (message.kind === 'open') return { kind: 'open', url: message.url };
	if (message.kind === 'read' && typeof message.id === 'number') {
		return { kind: 'read', id: message.id, url: message.url };
	}
	return null;
}
