import { describe, expect, it } from 'vitest';
import { createInitialWorkspace } from './model';
import { chooseSession, sessionFromWorkspace } from './session';

describe('editor session', () => {
	it('keeps the newer copy when a reload happens before IndexedDB finishes', () => {
		const stored = sessionFromWorkspace(createInitialWorkspace('print(1)'));
		const backup = sessionFromWorkspace(createInitialWorkspace('print(2)'));
		expect(chooseSession(null, { savedAt: 5, session: backup }, 0)).toBe(backup);
		expect(chooseSession(stored, null, 4)).toBe(stored);
		const newer = chooseSession(stored, { savedAt: 10, session: backup }, 4);
		expect(newer?.workspace.files[0]?.content).toBe('print(2)');
		expect(chooseSession(stored, { savedAt: 4, session: backup }, 4)).toBe(stored);
	});

	it('drops published markers for files that no longer exist', () => {
		const workspace = createInitialWorkspace('print(1)');
		const session = sessionFromWorkspace(workspace, {
			publishedContents: {
				[workspace.files[0].id]: 'print(1)',
				gone: 'alt'
			},
			localUnsavedIds: [workspace.files[0].id, 'gone'],
			remotePaths: { [workspace.files[0].id]: 'coder-kplus/main.py', gone: 'x' }
		});
		expect(session.publishedContents.gone).toBeUndefined();
		expect(session.remotePaths.gone).toBeUndefined();
		expect(session.localUnsavedIds).toEqual([workspace.files[0].id]);
	});
});
