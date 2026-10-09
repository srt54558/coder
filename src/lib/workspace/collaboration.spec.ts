import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createInitialWorkspace } from './model';
import { seedSharedWorkspace, syncSharedWorkspace } from './collaboration';

describe('syncSharedWorkspace', () => {
	it('does not emit another Yjs update when the open tabs already match', () => {
		const snapshot = createInitialWorkspace();
		const doc = new Y.Doc();
		seedSharedWorkspace(doc, snapshot);
		let updates = 0;
		doc.on('update', () => updates++);

		syncSharedWorkspace(doc, snapshot);

		expect(updates).toBe(0);
		doc.destroy();
	});
});
