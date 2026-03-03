/**
 * GitHub Export Modal — Simplified
 * Uses standard Dialog component instead of custom Framer Motion portal.
 * Preserves all business logic: sync mode, remote status checking, conflict warnings, progress tracking.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Github,
    Lock,
    Globe,
    Upload,
    CheckCircle,
    AlertCircle,
    Loader2,
    AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/lib/api-client';

// --- Helpers ---
const getInitialMode = (existingUrl: string | null | undefined): 'first_export' | 'sync' =>
    existingUrl ? 'sync' : 'first_export';

const extractRepoName = (url: string): string => url.split('/').pop() || '';

const generateRepoName = (appTitle?: string): string => {
    if (appTitle) {
        return appTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'my-app';
    }
    const ts = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    return `generated-app-${ts}`;
};

// --- Types ---
interface GitHubExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExport: (options: { repositoryName: string; isPrivate: boolean; description?: string }) => void;
    isExporting?: boolean;
    exportProgress?: { message: string; step: 'creating_repository' | 'uploading_files' | 'finalizing'; progress: number };
    exportResult?: { success: boolean; repositoryUrl?: string; error?: string; repositoryAlreadyExists?: boolean; existingRepositoryUrl?: string };
    onRetry?: () => void;
    existingGithubUrl?: string | null;
    agentId?: string;
    appTitle?: string;
}

type RemoteStatus = {
    compatible: boolean;
    behindBy: number;
    aheadBy: number;
    divergedCommits: Array<{ sha: string; message: string; author: string; date: string }>;
};

// --- Component ---
export function GitHubExportModal({
    isOpen, onClose, onExport, isExporting = false, exportProgress, exportResult,
    onRetry, existingGithubUrl, agentId, appTitle,
}: GitHubExportModalProps) {
    const [repositoryName, setRepositoryName] = useState('');
    const [description, setDescription] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [mode, setMode] = useState<'first_export' | 'sync' | 'change_repo'>(getInitialMode(existingGithubUrl));
    const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
    const [showConflictWarning, setShowConflictWarning] = useState(false);
    const [isCheckingRemote, setIsCheckingRemote] = useState(false);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setMode(getInitialMode(existingGithubUrl));
            if (!repositoryName) {
                setRepositoryName(existingGithubUrl ? extractRepoName(existingGithubUrl) : generateRepoName(appTitle));
            }
        }
    }, [isOpen, existingGithubUrl, appTitle]);

    // Check remote status for sync mode
    useEffect(() => {
        if (isOpen && mode === 'sync' && existingGithubUrl && agentId) {
            setIsCheckingRemote(true);
            setShowConflictWarning(false);
            setRemoteStatus(null);
            apiClient.checkRemoteStatus({ repositoryUrl: existingGithubUrl, agentId })
                .then(r => {
                    if (r.success && r.data) {
                        setRemoteStatus(r.data);
                        if (r.data.aheadBy > 0) setShowConflictWarning(true);
                    }
                })
                .catch(e => console.error('Failed to check remote status:', e))
                .finally(() => setIsCheckingRemote(false));
        }
    }, [isOpen, mode, existingGithubUrl, agentId]);

    const exportOptions = useMemo(() => ({
        repositoryName: repositoryName.trim(),
        isPrivate,
        description: description.trim() || undefined,
    }), [repositoryName, isPrivate, description]);

    const handleExport = useCallback(() => onExport(exportOptions), [onExport, exportOptions]);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (repositoryName.trim()) handleExport();
    }, [repositoryName, handleExport]);

    const handleClose = useCallback(() => {
        if (!isExporting) {
            setMode(getInitialMode(existingGithubUrl));
            setRepositoryName('');
            setDescription('');
            onClose();
        }
    }, [isExporting, onClose, existingGithubUrl]);

    // --- Render content based on state ---
    const renderContent = () => {
        // Conflict warning
        if (showConflictWarning && remoteStatus && remoteStatus.aheadBy > 0) {
            return (
                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                        <div className="text-sm space-y-1">
                            <p className="font-medium text-yellow-600 dark:text-yellow-400">Repository Has Different History</p>
                            <p className="text-text-tertiary">
                                Remote has <strong>{remoteStatus.aheadBy}</strong> commit(s) not in your app.
                                Force pushing will replace GitHub's history.
                            </p>
                        </div>
                    </div>
                    {remoteStatus.divergedCommits.length > 0 && (
                        <div className="bg-bg-3/50 rounded-md p-3 max-h-24 overflow-y-auto space-y-1.5">
                            {remoteStatus.divergedCommits.slice(0, 3).map((c, i) => (
                                <p key={i} className="text-xs text-text-tertiary">
                                    <span className="font-medium text-text-secondary">{c.message}</span>
                                    {' — '}{c.author}
                                </p>
                            ))}
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setShowConflictWarning(false); onClose(); }}>Cancel</Button>
                        <Button variant="destructive" size="sm" onClick={() => { setShowConflictWarning(false); handleExport(); }}>
                            Force Push
                        </Button>
                    </DialogFooter>
                </div>
            );
        }

        // Export result
        if (exportResult) {
            if (exportResult.success) {
                return (
                    <div className="text-center py-6 space-y-3">
                        <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
                        <p className="font-medium">Export Successful!</p>
                        <a href={exportResult.repositoryUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="gap-2">
                                <Github className="h-4 w-4" /> View Repository
                            </Button>
                        </a>
                    </div>
                );
            }
            if (exportResult.repositoryAlreadyExists && exportResult.existingRepositoryUrl) {
                return (
                    <div className="text-center py-6 space-y-3">
                        <AlertCircle className="h-10 w-10 text-orange-500 mx-auto" />
                        <p className="font-medium">Repository Already Exists</p>
                        <a href={exportResult.existingRepositoryUrl} target="_blank" rel="noopener noreferrer"
                            className="text-sm text-brand hover:underline block break-all">{exportResult.existingRepositoryUrl}</a>
                        <div className="flex gap-2 justify-center">
                            <Button size="sm" onClick={handleExport}>Sync to Existing</Button>
                            <Button variant="outline" size="sm" onClick={onRetry || onClose}>Change Name</Button>
                        </div>
                    </div>
                );
            }
            return (
                <div className="text-center py-6 space-y-3">
                    <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
                    <p className="font-medium">Export Failed</p>
                    <p className="text-sm text-text-tertiary">{exportResult.error || 'An error occurred'}</p>
                    <div className="flex gap-2 justify-center">
                        <Button variant="outline" size="sm" onClick={onRetry || (() => window.location.reload())}>Try Again</Button>
                        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
                    </div>
                </div>
            );
        }

        // Exporting progress
        if (isExporting && exportProgress) {
            return (
                <div className="py-6 space-y-4">
                    <div className="text-center">
                        <Loader2 className="h-8 w-8 text-brand mx-auto mb-3 animate-spin" />
                        <p className="font-medium">Exporting to GitHub</p>
                        <p className="text-sm text-text-tertiary mt-1">{exportProgress.message}</p>
                    </div>
                    <div>
                        <div className="flex justify-between text-xs text-text-tertiary mb-1">
                            <span>Progress</span>
                            <span>{exportProgress.progress}%</span>
                        </div>
                        <div className="w-full bg-bg-3 rounded-full h-1.5">
                            <motion.div className="bg-brand h-1.5 rounded-full" initial={{ width: 0 }}
                                animate={{ width: `${exportProgress.progress}%` }} transition={{ duration: 0.4 }} />
                        </div>
                    </div>
                </div>
            );
        }

        // Form
        return (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                    <Label>Repository Name</Label>
                    <Input value={repositoryName} onChange={e => setRepositoryName(e.target.value)}
                        placeholder="my-awesome-app" required className="dark:bg-bg-1" />
                </div>

                {mode === 'sync' && existingGithubUrl && (
                    <div className="p-3 bg-bg-3/50 rounded-md space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-text-tertiary">Remote Repository</span>
                            <button type="button" onClick={() => setMode('change_repo')}
                                className="text-xs text-brand hover:text-brand/80">Change</button>
                        </div>
                        <a href={existingGithubUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-text-tertiary hover:text-brand flex items-center gap-1 break-all">
                            <Github className="h-3 w-3 shrink-0" />{existingGithubUrl}
                        </a>
                        {isCheckingRemote && (
                            <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                                <Loader2 className="h-3 w-3 animate-spin" />Checking status…
                            </div>
                        )}
                        {!isCheckingRemote && remoteStatus && (
                            remoteStatus.compatible && remoteStatus.behindBy === 0 && remoteStatus.aheadBy === 0
                                ? <Badge variant="outline" className="text-xs text-green-500">Up to date</Badge>
                                : <Badge variant="outline" className="text-xs text-yellow-500">
                                    {remoteStatus.behindBy > 0 && `${remoteStatus.behindBy} unpushed`}
                                    {remoteStatus.behindBy > 0 && remoteStatus.aheadBy > 0 && ' · '}
                                    {remoteStatus.aheadBy > 0 && `${remoteStatus.aheadBy} newer on remote`}
                                </Badge>
                        )}
                    </div>
                )}

                {mode !== 'sync' && (
                    <div className="space-y-1.5">
                        <Label>Description <span className="text-text-tertiary font-normal">(optional)</span></Label>
                        <Input value={description} onChange={e => setDescription(e.target.value)}
                            placeholder="A brief description of your app…" className="dark:bg-bg-1" />
                    </div>
                )}

                {mode !== 'sync' && (
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setIsPrivate(false)}
                            className={`flex-1 flex items-center gap-2 p-2.5 rounded-md border text-sm transition-colors ${!isPrivate ? 'border-brand bg-brand/5 text-text-primary' : 'border-border-primary text-text-tertiary hover:border-border-primary/80'}`}>
                            <Globe className="h-4 w-4" /> Public
                        </button>
                        <button type="button" onClick={() => setIsPrivate(true)}
                            className={`flex-1 flex items-center gap-2 p-2.5 rounded-md border text-sm transition-colors ${isPrivate ? 'border-brand bg-brand/5 text-text-primary' : 'border-border-primary text-text-tertiary hover:border-border-primary/80'}`}>
                            <Lock className="h-4 w-4" /> Private
                        </button>
                    </div>
                )}

                <DialogFooter className="gap-2 pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={!repositoryName.trim() || isExporting} className="gap-1.5">
                        <Upload className="h-3.5 w-3.5" />
                        {mode === 'sync' ? 'Sync' : 'Export'}
                    </Button>
                </DialogFooter>
            </form>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
            <DialogContent className="max-w-md w-[90vw]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Github className="h-4 w-4" />
                        {mode === 'sync' ? 'Sync to GitHub' : 'Export to GitHub'}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        {mode === 'sync' && existingGithubUrl
                            ? `Update ${extractRepoName(existingGithubUrl)} with your latest changes`
                            : 'Create a new repository with your generated code'}
                    </DialogDescription>
                </DialogHeader>
                {renderContent()}
            </DialogContent>
        </Dialog>
    );
}