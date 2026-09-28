import { sanitizeWorkspace, type WorkspaceSnapshot } from './model';

export const WORKSPACE_ARCHIVE_NAME = 'python-workspace.py';

const BEGIN = '# BEGIN KPLUS_WORKSPACE_V1';
const END = '# END KPLUS_WORKSPACE_V1';

const RESTORE_PROGRAM = `#!/usr/bin/env python3
"""Workspace von python.k-plus.one.

Im Terminal ausführen und mit y bestätigen, um alle Ordner und Dateien
neben dieser Datei anzulegen. In der App über Importieren laden, um die
gespeicherte Datenbank zu ersetzen.
"""

from __future__ import annotations

import base64
import gzip
import json
import sys
from pathlib import Path


def load_workspace(text: str) -> dict:
    begin = "${BEGIN}"
    end = "${END}"
    start = text.rfind(begin)
    stop = text.find(end, start + len(begin)) if start >= 0 else -1
    if start < 0 or stop < 0:
        raise ValueError("Markierung fehlt")
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
    encoded = "".join(ch for ch in text[start + len(begin) : stop] if ch in alphabet)
    raw = base64.b64decode(encoded)
    if raw[:2] == bytes((31, 139)):
        raw = gzip.decompress(raw)
    data = json.loads(raw)
    if data.get("application") != "python.k-plus.one" or not isinstance(data.get("workspace"), dict):
        raise ValueError("Unbekanntes Format")
    return data["workspace"]


def safe_part(name: object) -> str | None:
    if not isinstance(name, str):
        return None
    cleaned = name.strip()
    if not cleaned or cleaned in {".", ".."} or "/" in cleaned or "\\\\" in cleaned or "\\x00" in cleaned:
        return None
    return cleaned


def folder_parts(folders: list, folder_id: object) -> list[str] | None:
    by_id = {folder.get("id"): folder for folder in folders if isinstance(folder, dict)}
    parts: list[str] = []
    seen: set[object] = set()
    current = by_id.get(folder_id)
    while isinstance(current, dict) and current.get("id") not in seen:
        seen.add(current.get("id"))
        parent_id = current.get("parentId")
        if not parent_id:
            if current.get("id") != "root":
                part = safe_part(current.get("name"))
                if part is None:
                    return None
                parts.append(part)
            return list(reversed(parts))
        part = safe_part(current.get("name"))
        parent = by_id.get(parent_id)
        if part is None or not isinstance(parent, dict):
            return None
        parts.append(part)
        current = parent
    return None


def is_inside(root: Path, target: Path) -> bool:
    root_resolved = root.resolve()
    target_resolved = target.resolve()
    return target_resolved == root_resolved or root_resolved in target_resolved.parents


def restore(workspace: dict, destination: Path, script: Path) -> int:
    folders = workspace.get("folders") or []
    files = workspace.get("files") or []
    if not isinstance(folders, list) or not isinstance(files, list):
        raise ValueError("Workspace ist unvollständig")
    for folder in folders:
        if not isinstance(folder, dict) or folder.get("id") == "root":
            continue
        parts = folder_parts(folders, folder.get("id"))
        if not parts:
            continue
        target = destination.joinpath(*parts)
        if not is_inside(destination, target):
            print(f"Übersprungen: {folder.get('name')}")
            continue
        target.mkdir(parents=True, exist_ok=True)
    written = 0
    for file in files:
        if not isinstance(file, dict):
            continue
        parts = folder_parts(folders, file.get("folderId"))
        name = safe_part(file.get("name"))
        label = file.get("name")
        if parts is None or name is None:
            print(f"Übersprungen: {label}")
            continue
        target = destination.joinpath(*parts, name)
        if not is_inside(destination, target) or target.resolve() == script.resolve():
            print(f"Übersprungen: {label}")
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            content = file.get("content")
            target.write_text(content if isinstance(content, str) else "", encoding="utf-8")
        except OSError as error:
            print(f"Konnte nicht angelegt werden: {label} ({error})")
            continue
        written += 1
        print(target.relative_to(destination))
    return written


def interactive() -> bool:
    try:
        return bool(sys.stdin and sys.stdin.isatty())
    except Exception:
        return False


def main() -> None:
    if "__file__" not in globals():
        print("Diese Datei im Terminal ausführen und mit y bestätigen.")
        return
    script = Path(__file__).resolve()
    destination = script.parent
    try:
        workspace = load_workspace(script.read_text(encoding="utf-8"))
    except Exception as error:
        print(f"Die Workspace-Datei lässt sich nicht lesen: {error}")
        raise SystemExit(1) from error
    print("Alle Dateien und Ordner in diesem Ordner anlegen?")
    print(destination)
    print("Vorhandene Dateien mit demselben Namen werden ersetzt.")
    if not interactive():
        print("Im Terminal ausführen und mit y bestätigen.")
        return
    answer = input("Mit y anlegen: ").strip().lower()
    if answer != "y":
        print("Abgebrochen.")
        return
    written = restore(workspace, destination, script)
    print(f"{written} Dateien angelegt.")


if __name__ == "__main__":
    main()
`;

function base64FromBytes(bytes: Uint8Array): string {
	const chunks: string[] = [];
	for (let index = 0; index < bytes.length; index += 0x8000) {
		chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
	}
	return btoa(chunks.join(''));
}

function bytesFromBase64(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function wrap(value: string, width = 76): string {
	const lines: string[] = [];
	for (let index = 0; index < value.length; index += width) {
		lines.push(`# ${value.slice(index, index + width)}`);
	}
	return lines.join('\n');
}

function isGzip(bytes: Uint8Array): boolean {
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function bytesAsBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}

async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof CompressionStream !== 'function') return bytes;
	const stream = new Blob([bytesAsBuffer(bytes)])
		.stream()
		.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new Error('gzip');
	}
	const stream = new Blob([bytesAsBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function archivePayload(snapshot: WorkspaceSnapshot): string {
	return JSON.stringify({
		application: 'python.k-plus.one',
		exportedAt: new Date().toISOString(),
		workspace: snapshot
	});
}

function parseArchivePayload(text: string): WorkspaceSnapshot | null {
	const parsed = JSON.parse(text) as {
		application?: unknown;
		workspace?: unknown;
	};
	if (parsed.application !== 'python.k-plus.one') return null;
	if (!parsed.workspace || typeof parsed.workspace !== 'object') return null;
	return sanitizeWorkspace(parsed.workspace as WorkspaceSnapshot);
}

export function looksLikeWorkspaceArchive(source: string): boolean {
	const start = source.lastIndexOf(BEGIN);
	if (start < 0) return false;
	return source.indexOf(END, start + BEGIN.length) >= 0;
}

export async function workspaceExport(snapshot: WorkspaceSnapshot): Promise<string> {
	const json = new TextEncoder().encode(archivePayload(snapshot));
	const compressed = await gzipCompress(json);
	return `${RESTORE_PROGRAM}\n${BEGIN}\n${wrap(base64FromBytes(compressed))}\n${END}\n`;
}

export async function parseWorkspaceArchive(source: string): Promise<WorkspaceSnapshot | null> {
	try {
		const start = source.lastIndexOf(BEGIN);
		const end = start < 0 ? -1 : source.indexOf(END, start + BEGIN.length);
		if (start < 0 || end < 0) return null;
		const encoded = source.slice(start + BEGIN.length, end).replace(/[^A-Za-z0-9+/=]/g, '');
		if (!encoded) return null;
		const bytes = bytesFromBase64(encoded);
		const jsonBytes = isGzip(bytes) ? await gzipDecompress(bytes) : bytes;
		return parseArchivePayload(new TextDecoder().decode(jsonBytes));
	} catch {
		return null;
	}
}
