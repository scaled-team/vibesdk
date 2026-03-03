import { memo, useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { useTheme } from '../../contexts/theme-context';

export type MonacoDiffEditorProps = React.ComponentProps<'div'> & {
	original: string;
	modified: string;
	language?: string;
};

export const MonacoDiffEditor = memo<MonacoDiffEditorProps>(function MonacoDiffEditor({
	original,
	modified,
	language = 'typescript',
	...props
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const diffEditor = useRef<monaco.editor.IStandaloneDiffEditor>(undefined);
	const { theme } = useTheme();

	useEffect(() => {
		if (!containerRef.current) return;

		let configuredTheme = theme;
		if (theme === 'system') {
			configuredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}

		diffEditor.current = monaco.editor.createDiffEditor(containerRef.current, {
			automaticLayout: true,
			readOnly: true,
			minimap: { enabled: false },
			fontSize: 13,
			scrollBeyondLastLine: false,
			renderSideBySide: true,
			theme: configuredTheme === 'dark' ? 'vibesdk-dark' : 'vibesdk',
			originalEditable: false,
			enableSplitViewResizing: true,
			renderOverviewRuler: false,
			diffWordWrap: 'on',
		});

		const originalModel = monaco.editor.createModel(original, language);
		const modifiedModel = monaco.editor.createModel(modified, language);

		diffEditor.current.setModel({
			original: originalModel,
			modified: modifiedModel,
		});

		return () => {
			originalModel.dispose();
			modifiedModel.dispose();
			diffEditor.current?.dispose();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Update content when props change
	useEffect(() => {
		if (!diffEditor.current) return;
		const model = diffEditor.current.getModel();
		if (!model) return;

		// Update original
		if (model.original.getValue() !== original) {
			model.original.setValue(original);
		}
		// Update modified
		if (model.modified.getValue() !== modified) {
			model.modified.setValue(modified);
		}
	}, [original, modified]);

	// Update language
	useEffect(() => {
		if (!diffEditor.current) return;
		const model = diffEditor.current.getModel();
		if (!model) return;
		monaco.editor.setModelLanguage(model.original, language);
		monaco.editor.setModelLanguage(model.modified, language);
	}, [language]);

	// Update theme
	useEffect(() => {
		if (diffEditor.current) {
			monaco.editor.setTheme(theme === 'dark' ? 'vibesdk-dark' : 'vibesdk');
		}
	}, [theme]);

	return <div {...props} ref={containerRef} />;
});

export default MonacoDiffEditor;

