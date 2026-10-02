declare module 'css-tree' {
	export type CssNode = {
		type: string;
		property?: string;
		value?: CssNode;
		loc?: {
			start: { line: number; column: number };
			end: { line: number; column: number };
		};
	};

	export type CssParseError = {
		message?: string;
		line?: number;
		column?: number;
	};

	export function parse(
		source: string,
		options?: {
			positions?: boolean;
			context?: string;
			onParseError?: (error: CssParseError) => void;
		}
	): CssNode;

	export function walk(ast: CssNode, callback: (node: CssNode) => void): void;

	export const lexer: {
		matchProperty(property: string, value: CssNode): { error?: { message?: string } | null };
	};
}
