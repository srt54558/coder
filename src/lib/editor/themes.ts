import { tags } from '@lezer/highlight';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { isDarkTheme, type AppTheme } from '#lib/theme.js';

interface Palette {
	keyword: string;
	string: string;
	comment: string;
	number: string;
	function: string;
	type: string;
	operator: string;
	error: string;
}

const palettes: Record<AppTheme, Palette> = {
	light: {
		keyword: '#1d4ed8',
		string: '#047857',
		comment: '#6b7280',
		number: '#b45309',
		function: '#6d28d9',
		type: '#0f766e',
		operator: '#374151',
		error: '#e11d48'
	},
	dark: {
		keyword: '#93c5fd',
		string: '#86efac',
		comment: '#9ca3af',
		number: '#fdba74',
		function: '#d8b4fe',
		type: '#5eead4',
		operator: '#e5e7eb',
		error: '#fb7185'
	},
	coffee: {
		keyword: '#e7a36a',
		string: '#f0d7a4',
		comment: '#a08978',
		number: '#f0c36a',
		function: '#f6d2b0',
		type: '#d7b08a',
		operator: '#ead8c4',
		error: '#e38b73'
	},
	pink: {
		keyword: '#c2185b',
		string: '#ad5a2b',
		comment: '#b58196',
		number: '#b4236a',
		function: '#8e1b4b',
		type: '#9d174d',
		operator: '#7a4458',
		error: '#be123c'
	}
};

function highlight(palette: Palette) {
	return HighlightStyle.define([
		{ tag: [tags.keyword, tags.modifier, tags.self, tags.bool, tags.null], color: palette.keyword },
		{ tag: [tags.string, tags.special(tags.string)], color: palette.string },
		{
			tag: [tags.comment, tags.lineComment, tags.blockComment],
			color: palette.comment,
			fontStyle: 'italic'
		},
		{ tag: [tags.number, tags.integer, tags.float], color: palette.number },
		{
			tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName))],
			color: palette.function
		},
		{ tag: [tags.className, tags.typeName, tags.definition(tags.className)], color: palette.type },
		{ tag: [tags.operator, tags.punctuation, tags.bracket], color: palette.operator },
		{ tag: tags.invalid, color: palette.error }
	]);
}

export function themeExtensions(theme: AppTheme) {
	const palette = palettes[theme];
	return [
		EditorView.darkTheme.of(isDarkTheme(theme)),
		syntaxHighlighting(highlight(palette)),
		EditorView.theme(
			{
				'&': {
					height: '100%',
					backgroundColor: 'var(--background)',
					color: 'var(--foreground)'
				},
				'.cm-scroller': {
					fontFamily: 'var(--font-code)',
					fontSize: '0.84rem',
					lineHeight: '1.55',
					fontVariantLigatures: 'contextual',
					fontFeatureSettings: '"calt" 1, "liga" 1'
				},
				'.cm-content': {
					padding: '0.85rem 0',
					caretColor: 'var(--foreground)'
				},
				'.cm-line': {
					padding: '0 0.9rem'
				},
				'.cm-gutters': {
					backgroundColor: 'color-mix(in oklch, var(--muted) 42%, var(--background))',
					color: 'var(--muted-foreground)',
					borderRight: '1px solid var(--border)'
				},
				'.cm-activeLine': {
					backgroundColor: 'color-mix(in oklch, var(--accent) 70%, transparent)'
				},
				'.cm-activeLineGutter': {
					backgroundColor: 'color-mix(in oklch, var(--accent) 80%, transparent)',
					color: 'var(--foreground)'
				},
				'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
					backgroundColor: 'color-mix(in oklch, var(--primary) 30%, transparent)'
				},
				'.cm-cursor, .cm-dropCursor': {
					borderLeftColor: 'var(--foreground)'
				},
				'.cm-tooltip, .cm-tooltip-lint, .cm-tooltip-hover, .cm-tooltip-autocomplete': {
					backgroundColor: 'var(--popover)',
					color: 'var(--popover-foreground)',
					border: '1px solid var(--border)',
					borderRadius: '0.4rem'
				},
				'.cm-tooltip-autocomplete ul': {
					fontFamily: 'var(--font-code)',
					fontSize: '0.78rem'
				},
				'.cm-tooltip-autocomplete ul li[aria-selected]': {
					backgroundColor: 'var(--accent)',
					color: 'var(--accent-foreground)'
				},
				'.cm-completionDetail': {
					color: 'var(--muted-foreground)',
					fontStyle: 'normal'
				},
				'.cm-completionMatchedText': {
					textDecoration: 'none',
					fontWeight: '700'
				},
				'.cm-python-hover': {
					maxWidth: '28rem',
					padding: '0.45rem 0.6rem 0.5rem'
				},
				'.cm-python-hover-kind': {
					color: 'var(--muted-foreground)',
					fontFamily: 'var(--font-sans)',
					fontSize: '0.68rem',
					fontWeight: '650',
					letterSpacing: '0.03em',
					textTransform: 'uppercase'
				},
				'.cm-python-hover-scheme': {
					margin: '0.2rem 0 0',
					fontFamily: 'var(--font-code)',
					fontFeatureSettings: '"calt" 1, "liga" 1',
					fontVariantLigatures: 'contextual',
					fontSize: '0.78rem',
					lineHeight: '1.45',
					whiteSpace: 'pre-wrap'
				},
				'.cm-python-hover-doc': {
					marginTop: '0.35rem',
					color: 'var(--muted-foreground)',
					fontFamily: 'var(--font-sans)',
					fontSize: '0.75rem',
					lineHeight: '1.4',
					whiteSpace: 'pre-wrap'
				},
				'.cm-docs-link': {
					display: 'inline-flex',
					alignItems: 'center',
					gap: '0.28rem',
					marginTop: '0.4rem',
					padding: 0,
					border: 0,
					background: 'transparent',
					color: 'inherit',
					fontFamily: 'var(--font-sans)',
					fontSize: '0.75rem',
					lineHeight: 1.2,
					textDecoration: 'underline',
					textUnderlineOffset: '0.16em',
					cursor: 'pointer'
				},
				'.cm-docs-link svg': {
					width: '0.75rem',
					height: '0.75rem',
					flex: '0 0 auto'
				},
				'.cm-diagnosticText': {
					fontFamily: 'var(--font-sans)'
				},
				'.cm-lintRange-error': {
					backgroundImage: 'none',
					textDecoration: `underline wavy ${palette.error}`
				},
				'.cm-lintRange-warning': {
					backgroundImage: 'none',
					textDecoration: `underline wavy ${palette.number}`
				}
			},
			{ dark: isDarkTheme(theme) }
		)
	];
}
