import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Eye, EyeOff, Loader } from 'lucide-react';

interface EnvVarsModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	envVars: Record<string, string>;
	onSave: (envVars: Record<string, string>) => void;
	isSaving: boolean;
}

export function EnvVarsModal({ open, onOpenChange, envVars, onSave, isSaving }: EnvVarsModalProps) {
	const [draft, setDraft] = useState<Array<{ key: string; value: string }>>([]);
	const [newKey, setNewKey] = useState('');
	const [newValue, setNewValue] = useState('');
	const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

	// Sync draft from envVars when modal opens
	const handleOpenChange = useCallback((isOpen: boolean) => {
		if (isOpen) {
			setDraft(Object.entries(envVars).map(([key, value]) => ({ key, value })));
			setVisibleKeys(new Set());
			setNewKey('');
			setNewValue('');
		}
		onOpenChange(isOpen);
	}, [envVars, onOpenChange]);

	const addVar = useCallback(() => {
		const trimmedKey = newKey.trim();
		if (!trimmedKey) return;
		if (draft.some(v => v.key === trimmedKey)) return;
		setDraft(prev => [...prev, { key: trimmedKey, value: newValue }]);
		setNewKey('');
		setNewValue('');
	}, [newKey, newValue, draft]);

	const removeVar = useCallback((key: string) => {
		setDraft(prev => prev.filter(v => v.key !== key));
		setVisibleKeys(prev => {
			const next = new Set(prev);
			next.delete(key);
			return next;
		});
	}, []);

	const updateValue = useCallback((key: string, value: string) => {
		setDraft(prev => prev.map(v => v.key === key ? { ...v, value } : v));
	}, []);

	const toggleVisibility = useCallback((key: string) => {
		setVisibleKeys(prev => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const handleSave = useCallback(() => {
		const result: Record<string, string> = {};
		for (const { key, value } of draft) {
			if (key.trim()) result[key.trim()] = value;
		}
		onSave(result);
	}, [draft, onSave]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Environment Variables</DialogTitle>
					<DialogDescription>
						Add API keys and env vars for your generated project. Saving will rebuild the preview.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 max-h-[40vh] overflow-y-auto">
					{draft.map(({ key, value }) => (
						<div key={key} className="flex items-center gap-2">
							<Input
								value={key}
								readOnly
								className="flex-[2] font-mono text-xs bg-bg-2"
							/>
							<div className="flex-[3] relative">
								<Input
									type={visibleKeys.has(key) ? 'text' : 'password'}
									value={value}
									onChange={e => updateValue(key, e.target.value)}
									className="font-mono text-xs pr-8"
									placeholder="value"
								/>
								<button
									type="button"
									onClick={() => toggleVisibility(key)}
									className="absolute right-2 top-1/2 -translate-y-1/2 text-text-primary/40 hover:text-text-primary/70 transition-colors"
								>
									{visibleKeys.has(key) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
								</button>
							</div>
							<button
								type="button"
								onClick={() => removeVar(key)}
								className="p-1.5 text-text-primary/40 hover:text-red-400 transition-colors"
							>
								<Trash2 className="size-3.5" />
							</button>
						</div>
					))}

					{draft.length === 0 && (
						<p className="text-text-tertiary text-sm text-center py-4">
							No environment variables set
						</p>
					)}
				</div>

				{/* Add new var row */}
				<div className="flex items-center gap-2 pt-2 border-t border-border-primary">
					<Input
						value={newKey}
						onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
						placeholder="KEY_NAME"
						className="flex-[2] font-mono text-xs"
						onKeyDown={e => e.key === 'Enter' && addVar()}
					/>
					<Input
						value={newValue}
						onChange={e => setNewValue(e.target.value)}
						placeholder="value"
						className="flex-[3] font-mono text-xs"
						onKeyDown={e => e.key === 'Enter' && addVar()}
					/>
					<Button
						variant="outline"
						size="icon"
						onClick={addVar}
						disabled={!newKey.trim()}
						title="Add variable"
					>
						<Plus className="size-3.5" />
					</Button>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isSaving}>
						{isSaving ? (
							<>
								<Loader className="size-3.5 animate-spin" />
								Rebuilding...
							</>
						) : (
							'Save & Rebuild'
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
