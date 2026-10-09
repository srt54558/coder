import { describe, expect, it } from 'vitest';
import { programBlocks } from './program-visualizer';

describe('programBlocks', () => {
	it('classifies common Python flow and keeps line and indentation context', () => {
		expect(
			programBlocks('total = 0\nif total < 3:\n    print(total)\n    total += 1\nreturn total')
		).toEqual([
			{ line: 1, indent: 0, kind: 'assignment', label: 'Wert setzen', source: 'total = 0' },
			{ line: 2, indent: 0, kind: 'condition', label: 'Bedingung', source: 'if total < 3:' },
			{ line: 3, indent: 4, kind: 'output', label: 'Ausgabe', source: 'print(total)' },
			{ line: 4, indent: 4, kind: 'assignment', label: 'Wert setzen', source: 'total += 1' },
			{ line: 5, indent: 0, kind: 'return', label: 'Rückgabe', source: 'return total' }
		]);
	});

	it('omits blank lines and leaves incomplete statements visible', () => {
		expect(programBlocks('if value:\n\n    result =')).toMatchObject([
			{ line: 1, kind: 'condition' },
			{ line: 3, indent: 4, kind: 'assignment', source: 'result =' }
		]);
	});
});
