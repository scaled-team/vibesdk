import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import type { AppDetailsData, FileType } from '@/api-types';
import { apiClient, ApiError } from '@/lib/api-client';
import { appEvents } from '@/lib/app-events';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import {
	Star,
	Eye,
	Code2,
	ChevronLeft,
	ExternalLink,
	Copy,
	Check,
	Loader2,
	MessageSquare,
	Calendar,
	User,
	Play,
	Lock,
	Bookmark,
	Globe,
	Trash2,
	Github,
	GitBranch,
} from 'lucide-react';

const MonacoEditor = lazy(() => import('@/components/monaco-editor/monaco-editor'));
import { getFileType } from '@/utils/string';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { toggleFavorite } from '@/hooks/use-apps';
import { formatDistanceToNow, isValid } from 'date-fns';
import { toast } from 'sonner';
import { capitalizeFirstLetter, cn, getPreviewUrl } from '@/lib/utils';
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog';
import { GitCloneModal } from '@/components/shared/GitCloneModal';
import { GitCloneCommand, GitClonePrivatePrompt } from '@/components/shared/GitCloneInline';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { PreviewIframe } from '../chat/components/preview-iframe';

// Use proper types from API types
type AppDetails = AppDetailsData;

// Define supported actions for OAuth redirect
type PendingAction = 'favorite' | 'bookmark' | 'star' | 'fork' | 'remix';

// Supported actions constant for validation
const SUPPORTED_ACTIONS: PendingAction[] = [
	'favorite',
	'bookmark',
	'star',
	'fork',
	'remix',
];

// Action configuration type for reusability
interface ActionConfig {
	action: PendingAction;
	context: string;
	handler: () => Promise<void>;
	errorMessage: string;
}

// Action mapping for aliases (bookmark -> favorite, remix -> fork)
const ACTION_MAP: Record<PendingAction, string> = {
	favorite: 'favorite',
	bookmark: 'favorite',
	star: 'star',
	fork: 'fork',
	remix: 'fork',
};
export default function AppView() {
	const { id } = useParams();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { user } = useAuth();
	const { requireAuth } = useAuthGuard();
	const [app, setApp] = useState<AppDetails | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isFavorited, setIsFavorited] = useState(false);
	const [isStarred, setIsStarred] = useState(false);
	const { copied: urlCopied, copy: copyUrl } = useCopyToClipboard();
	const { copy: copyFile } = useCopyToClipboard({ successMessage: 'Code copied to clipboard' });
	const { copy: copyPrompt } = useCopyToClipboard({ successMessage: 'Prompt copied to clipboard' });
	const [activeTab, setActiveTab] = useState('preview');
	const [isDeploying, setIsDeploying] = useState(false);
	const [deploymentProgress, setDeploymentProgress] = useState<string>('');
	const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isGitCloneModalOpen, setIsGitCloneModalOpen] = useState(false);
	const [activeFilePath, setActiveFilePath] = useState<string>();
	const previewIframeRef = useRef<HTMLIFrameElement>(null);

	const fetchAppDetails = useCallback(async () => {
		if (!id) return;

		try {
			setLoading(true);
			setError(null);

			// Fetch app details using API client
			const appResponse = await apiClient.getAppDetails(id);

			if (appResponse.success && appResponse.data) {
				const appData = appResponse.data;
				setApp(appData);
				setIsFavorited(appData.userFavorited || false);
				setIsStarred(appData.userStarred || false);
			} else {
				throw new Error(
					appResponse.error?.message || 'Failed to fetch app details',
				);
			}
		} catch (err) {
			console.error('Error fetching app:', err);
			if (err instanceof ApiError) {
				if (err.status === 404) {
					setError('App not found');
				} else {
					setError(`Failed to load app: ${err.message}`);
				}
			} else {
				setError(
					err instanceof Error ? err.message : 'Failed to load app',
				);
			}
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		fetchAppDetails();
	}, [id, fetchAppDetails]);


	// Convert agent files to chat FileType format
	const files = useMemo<FileType[]>(() => {
		if (!app?.agentSummary?.generatedCode) return [];
		return app.agentSummary.generatedCode
			.filter((file) => file && file.filePath && typeof file.filePath === 'string')
			.map((file) => ({
				filePath: file.filePath,
				fileContents: file.fileContents || '',
				explanation: file.filePurpose,
				language: getFileType(file.filePath),
				isGenerating: false,
				needsFixing: false,
				hasErrors: false,
			}));
	}, [app?.agentSummary?.generatedCode]);

	// Get active file
	const activeFile = useMemo(() => {
		return files.find((file) => file.filePath === activeFilePath);
	}, [files, activeFilePath]);

	// Auto-select first file when files are loaded
	useEffect(() => {
		if (files.length > 0 && !activeFilePath) {
			setActiveFilePath(files[0].filePath);
		}
	}, [files, activeFilePath]);

	// File click handler
	const handleFileClick = useCallback((file: FileType) => {
		setActiveFilePath(file.filePath);
	}, []);

	// Action configuration for reusability
	const actionConfigs: Record<string, ActionConfig> = useMemo(
		() => ({
			favorite: {
				action: 'favorite',
				context: 'to bookmark apps',
				handler: async () => {
					if (!app) return;
					const newState = await toggleFavorite(app.id);
					setIsFavorited(newState);
					toast.success(
						newState
							? 'Added to bookmarks'
							: 'Removed from bookmarks',
					);
				},
				errorMessage: 'Failed to update bookmarks',
			},
			star: {
				action: 'star',
				context: 'to star apps',
				handler: async () => {
					if (!app) return;
					const response = await apiClient.toggleAppStar(app.id);

					if (response.success && response.data) {
						setIsStarred(response.data.isStarred);
						setApp((prev) =>
							prev
								? {
									...prev,
									starCount: response.data?.starCount || 0,
								}
								: null,
						);
						toast.success(
							response.data.isStarred ? 'Starred!' : 'Unstarred',
						);
					} else {
						throw new Error(response.error?.message || 'Failed to star app');
					}
				},
				errorMessage: 'Failed to update star',
			},
			// fork: {
			// 	action: 'fork',
			// 	context: 'to remix this app',
			// 	handler: async () => {
			// 		if (!app) return;
			// 		const response = await apiClient.forkApp(app.id);

			// 		if (response.success && response.data) {
			// 			toast.success(
			// 				response.data.message ||
			// 					'App remixed successfully!',
			// 			);

			// 			// Emit app-created event for sidebar updates
			// 			appEvents.emitAppCreated(response.data.forkedAppId, {
			// 				title: `${app.title} (Remix)`,
			// 				description: app.description || undefined,
			// 				isForked: true,
			// 			});

			// 			navigate(`/chat/${response.data.forkedAppId}`);
			// 		} else {
			// 			throw new Error(
			// 				response.error?.message || 'Failed to remix app',
			// 			);
			// 		}
			// 	},
			// 	errorMessage: 'Failed to remix app',
			// },
		}),
		[app],
	);

	// Reusable authenticated action handler
	const createAuthenticatedHandler = useCallback(
		(configKey: string) => {
			return async () => {
				if (!app) return;

				const config = actionConfigs[configKey];
				if (!config) return;

				const currentUrl = `/app/${app.id}?action=${config.action}`;

				// Use auth guard with action parameter in intended URL
				if (
					!requireAuth({
						requireFullAuth: true,
						actionContext: config.context,
						intendedUrl: currentUrl,
					})
				) {
					return;
				}

				// User is authenticated, execute immediately
				try {
					await config.handler();
				} catch (error) {
					console.error(`${config.action} error:`, error);
					toast.error(
						error instanceof ApiError
							? error.message
							: config.errorMessage,
					);
				}
			};
		},
		[actionConfigs, app, requireAuth],
	);

	// Create action handlers using the reusable pattern
	const handleFavorite = useMemo(
		() => createAuthenticatedHandler('favorite'),
		[createAuthenticatedHandler],
	);
	const handleStar = useMemo(
		() => createAuthenticatedHandler('star'),
		[createAuthenticatedHandler],
	);
	// const handleFork = useMemo(
	// 	() => createAuthenticatedHandler('fork'),
	// 	[createAuthenticatedHandler],
	// );

	// Handle pending actions after OAuth redirect
	const executePendingAction = useCallback(
		async (action: PendingAction) => {
			if (!app) return;

			const configKey = ACTION_MAP[action];
			if (!configKey) {
				console.warn('Unknown pending action:', action);
				return;
			}

			const config = actionConfigs[configKey];
			if (!config) {
				console.warn('No config found for action:', action);
				return;
			}

			try {
				await config.handler();
			} catch (error) {
				console.error(
					'Failed to execute pending action:',
					action,
					error,
				);
				toast.error(
					error instanceof ApiError
						? error.message
						: config.errorMessage,
				);
			}
		},
		[actionConfigs, app],
	);

	// Effect to handle pending actions after OAuth redirect
	useEffect(() => {
		if (!user || !app || loading) return;

		const actionParam = searchParams.get('action');
		if (!actionParam) return;

		// Validate action parameter against our supported types
		const action = SUPPORTED_ACTIONS.find((a) => a === actionParam);

		if (!action) {
			console.warn('Unsupported action parameter:', actionParam);
			return;
		}

		// Clear the action parameter from URL first
		const newSearchParams = new URLSearchParams(searchParams);
		newSearchParams.delete('action');
		setSearchParams(newSearchParams, { replace: true });

		// Execute the pending action
		executePendingAction(action);
	}, [
		user,
		app,
		loading,
		searchParams,
		setSearchParams,
		executePendingAction,
	]);

	const handleCopyUrl = () => {
		if (!appUrl) return;
		copyUrl(appUrl);
	};

	const getAppUrl = () => {
		return app?.cloudflareUrl || app?.previewUrl || '';
	};

	const handlePreviewDeploy = async () => {
		if (!app || isDeploying) return;

		try {
			setIsDeploying(true);
			setDeploymentProgress('Connecting to agent...');
			const response = await apiClient.deployPreview(app.id);
			if (response.success && response.data) {
				const data = response.data;
				if (data.previewURL || data.tunnelURL) {
					const newUrl = getPreviewUrl(
						data.previewURL,
						data.tunnelURL,
					);
					setApp((prev) =>
						prev
							? {
								...prev,
								cloudflareUrl: newUrl,
								previewUrl: newUrl,
							}
							: null,
					);
					setDeploymentProgress('Deployment complete!');
				}
			}
			setIsDeploying(false);
		} catch (error) {
			console.error('Error starting deployment:', error);
			setDeploymentProgress('Failed to start deployment');
			setIsDeploying(false);
			toast.error('Failed to start deployment');
		}
	};

	const handleToggleVisibility = async () => {
		if (!app || !user || !isOwner) {
			toast.error('You can only change visibility of your own apps');
			return;
		}

		try {
			setIsUpdatingVisibility(true);
			const newVisibility =
				app.visibility === 'private' ? 'public' : 'private';

			const response = await apiClient.updateAppVisibility(
				app.id,
				newVisibility,
			);

			if (response.success && response.data) {
				// Update the app state with new visibility
				setApp((prev) =>
					prev ? { ...prev, visibility: newVisibility } : null,
				);

				toast.success(
					response.data.message ||
					`App is now ${newVisibility === 'private' ? 'private' : 'public'}`,
				);
			} else {
				throw new Error(
					response.error?.message || 'Failed to update visibility',
				);
			}
		} catch (error) {
			console.error('Error updating app visibility:', error);
			toast.error(
				error instanceof ApiError
					? error.message
					: 'Failed to update visibility',
			);
		} finally {
			setIsUpdatingVisibility(false);
		}
	};

	const handleDeleteApp = async () => {
		if (!app) return;

		try {
			setIsDeleting(true);
			const response = await apiClient.deleteApp(app.id);

			if (response.success) {
				toast.success('App deleted successfully');
				setIsDeleteDialogOpen(false);

				// Emit global app deleted event
				appEvents.emitAppDeleted(app.id);

				// Smart navigation after deletion
				// Use window.history to go back if possible, otherwise navigate to apps page
				if (window.history.length > 1) {
					// Try to go back to previous page
					window.history.back();
				} else {
					// No history available, go to apps page
					navigate('/apps');
				}
			}
		} catch (error) {
			console.error('Error deleting app:', error);
			toast.error('An unexpected error occurred while deleting the app');
		} finally {
			setIsDeleting(false);
		}
	};

	if (loading) {
		return (
			<div className="min-h-screen bg-bg-3 flex items-center justify-center">
				<div className="text-center">
					<Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-text-tertiary" />
					<p className="text-text-tertiary">Loading app...</p>
				</div>
			</div>
		);
	}

	if (error || !app) {
		return (
			<div className="min-h-screen bg-bg-3 flex items-center justify-center">
				<div className="max-w-md rounded-lg border border-border-primary bg-bg-2 p-6">
					<div className="text-center">
						<h2 className="text-xl font-semibold mb-2">
							App not found
						</h2>
						<p className="text-text-tertiary mb-4">
							{error ||
								"The app you're looking for doesn't exist."}
						</p>
						<Button onClick={() => navigate('/apps')}>
							<ChevronLeft className="mr-2 h-4 w-4" />
							Back to Apps
						</Button>
					</div>
				</div>
			</div>
		);
	}

	const isOwner = app.userId === user?.id;
	const appUrl = getAppUrl();
	const createdDate = app.createdAt ? new Date(app.createdAt) : new Date();

	return (
		<div className="min-h-screen bg-bg-3 flex flex-col">
			<div className="container mx-auto px-4 pb-6 space-y-4 flex flex-col flex-1">
				{/* Back button */}
				<button
					onClick={() => history.back()}
					className="gap-1.5 flex items-center text-text-tertiary hover:text-text-primary text-sm transition-colors w-fit"
				>
					<ChevronLeft className="h-3.5 w-3.5" />
					Back
				</button>

				{/* Header — compact layout */}
				<div className="space-y-3">
					{/* Title + visibility */}
					<div className="flex items-center gap-3 flex-wrap">
						<h1 className="text-2xl font-semibold tracking-tight text-text-primary">
							{app.title}
						</h1>
						<Badge variant="outline" className="gap-1 text-xs font-normal">
							{app.visibility === 'private' ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
							{capitalizeFirstLetter(app.visibility)}
						</Badge>
						{isOwner && (
							<Button
								variant="ghost"
								size="sm"
								onClick={handleToggleVisibility}
								disabled={isUpdatingVisibility}
								className="h-6 px-1.5"
								title={`Make ${app.visibility === 'private' ? 'public' : 'private'}`}
							>
								{isUpdatingVisibility ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : app.visibility === 'private' ? (
									<span className="text-xs text-text-tertiary">Make public</span>
								) : (
									<span className="text-xs text-text-tertiary">Make private</span>
								)}
							</Button>
						)}
					</div>

					{/* Description */}
					{app.description && (
						<p className="text-sm text-text-secondary max-w-3xl leading-relaxed">
							{app.description}
						</p>
					)}

					{/* Metadata row */}
					<div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
						{app.user && (
							<span className="flex items-center gap-1">
								<User className="h-3 w-3" />
								{app.user.displayName}
							</span>
						)}
						<span className="flex items-center gap-1">
							<Calendar className="h-3 w-3" />
							{isValid(createdDate)
								? formatDistanceToNow(createdDate, { addSuffix: true })
								: 'recently'}
						</span>
						<span className="flex items-center gap-1">
							<Eye className="h-3 w-3" />
							{app.viewCount || 0}
						</span>
						<span className="flex items-center gap-1">
							<Star className="h-3 w-3" />
							{app.starCount || 0}
						</span>
					</div>

					{/* Action toolbar */}
					<div className="flex flex-wrap items-center gap-2">
						<Button variant="outline" size="sm" onClick={handleFavorite} className="gap-1.5 h-8 text-xs">
							<Bookmark className={cn('h-3.5 w-3.5', isFavorited && 'fill-current')} />
							{isFavorited ? 'Bookmarked' : 'Bookmark'}
						</Button>

						<Button variant="outline" size="sm" onClick={handleStar} className="gap-1.5 h-8 text-xs">
							<Star className={cn('h-3.5 w-3.5', isStarred && 'fill-current')} />
							{isStarred ? 'Starred' : 'Star'}
						</Button>

						<Button variant="outline" size="sm" onClick={() => setIsGitCloneModalOpen(true)} className="gap-1.5 h-8 text-xs">
							<GitBranch className="h-3.5 w-3.5" />
							Clone
						</Button>

						{app.githubRepositoryUrl && (
							<Button variant="outline" size="sm"
								onClick={() => app.githubRepositoryUrl && window.open(app.githubRepositoryUrl, '_blank', 'noopener,noreferrer')}
								className="gap-1.5 h-8 text-xs"
								title={`View on GitHub (${app.githubRepositoryVisibility || 'public'})`}
							>
								<Github className="h-3.5 w-3.5" />
								GitHub
								{app.githubRepositoryVisibility === 'private' && <Lock className="h-2.5 w-2.5 opacity-60" />}
							</Button>
						)}

						{isOwner && (
							<>
								<Button size="sm" onClick={() => navigate(`/chat/${app.id}`)}
									className="gap-1.5 h-8 text-xs bg-text-primary text-bg-4 border-bg-4 border"
								>
									<Code2 className="h-3.5 w-3.5" />
									Continue Editing
								</Button>
								<Button variant="ghost" size="sm"
									onClick={() => setIsDeleteDialogOpen(true)}
									className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
									title="Delete app"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</>
						)}
					</div>
				</div>

				{/* Tabs */}
				<Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 gap-2">
					<div className="flex items-center gap-4">
						<TabsList className="inline-flex h-auto w-fit items-center gap-0.5 bg-bg-2 dark:bg-bg-1 rounded-md p-0.5 border border-border-primary/30">
							<TabsTrigger value="preview"
								className="px-3 py-1.5 rounded text-xs font-medium data-[state=active]:bg-bg-4 dark:data-[state=active]:bg-bg-3 data-[state=active]:text-text-primary data-[state=active]:shadow-sm">
								<Eye className={cn("h-3.5 w-3.5 mr-1.5", activeTab === 'preview' ? 'text-accent' : 'text-accent/60')} />
								Preview
							</TabsTrigger>
							<TabsTrigger value="code"
								className="px-3 py-1.5 rounded text-xs font-medium data-[state=active]:bg-bg-4 dark:data-[state=active]:bg-bg-3 data-[state=active]:text-text-primary data-[state=active]:shadow-sm">
								<Code2 className={cn("h-3.5 w-3.5 mr-1.5", activeTab === 'code' ? 'text-accent' : 'text-accent/60')} />
								Code
							</TabsTrigger>
							<TabsTrigger value="prompt"
								className="px-3 py-1.5 rounded text-xs font-medium data-[state=active]:bg-bg-4 dark:data-[state=active]:bg-bg-3 data-[state=active]:text-text-primary data-[state=active]:shadow-sm">
								<MessageSquare className={cn("h-3.5 w-3.5 mr-1.5", activeTab === 'prompt' ? 'text-accent' : 'text-accent/60')} />
								Prompt
							</TabsTrigger>
						</TabsList>

						<div className="flex-shrink-0">
							{app.visibility === 'public' ? (
								<GitCloneCommand
									cloneUrl={`${window.location.protocol}//${window.location.host}/apps/${app.id}.git`}
									appTitle={app.title}
								/>
							) : isOwner ? (
								<GitClonePrivatePrompt onOpenModal={() => setIsGitCloneModalOpen(true)} />
							) : null}
						</div>
					</div>

					{/* Preview tab */}
					<TabsContent value="preview" className="flex-1">
						<div className="rounded-lg border border-border-primary overflow-hidden bg-bg-2">
							{appUrl ? (
								<>
									<div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary/50 bg-bg-3/50">
										<span className="text-xs font-medium text-text-tertiary">Live Preview</span>
										<div className="ml-auto flex items-center gap-1">
											<Button variant="ghost" size="sm" onClick={handleCopyUrl} className="h-7 px-2 text-xs gap-1.5">
												{urlCopied ? <><Check className="h-3 w-3" /> Copied</> : <Copy className="h-3 w-3" />}
											</Button>
											<Button variant="ghost" size="sm" onClick={() => window.open(appUrl, '_blank')} className="h-7 w-7 p-0">
												<ExternalLink className="h-3 w-3" />
											</Button>
										</div>
									</div>
									<PreviewIframe ref={previewIframeRef} src={appUrl}
										className="w-full h-[600px] lg:h-[800px]" title={`${app.title} Preview`} />
								</>
							) : (
								<div className="relative w-full h-[350px] bg-bg-2 flex items-center justify-center">
									<div className="absolute inset-0 bg-bg-3/80 backdrop-blur-sm flex items-center justify-center z-10">
										<div className="text-center p-8">
											<h3 className="text-lg font-semibold mb-1.5 text-text-primary">Run App</h3>
											<p className="text-sm text-text-tertiary mb-5 max-w-sm">Run the app to see a live preview.</p>
											{deploymentProgress && (
												<p className="text-xs text-text-secondary mb-3">{deploymentProgress}</p>
											)}
											<Button onClick={handlePreviewDeploy} disabled={isDeploying} className="gap-2" size="sm">
												{isDeploying
													? <><Loader2 className="h-4 w-4 animate-spin" /> Deploying...</>
													: <><Play className="h-4 w-4" /> Deploy for Preview</>}
											</Button>
										</div>
									</div>
								</div>
							)}
						</div>
					</TabsContent>

					{/* Code tab */}
					<TabsContent value="code" className="flex-1">
						<div className="rounded-lg border border-border-primary overflow-hidden bg-bg-3" style={{ maxHeight: '600px' }}>
							<div className="flex items-center justify-between px-3 py-2 border-b border-border-primary/50 bg-bg-3/50">
								<span className="text-xs font-medium text-text-tertiary">
									Generated Code {app?.agentSummary && `· ${files.length} files`}
								</span>
								{activeFile && (
									<Button variant="ghost" size="sm" onClick={() => void copyFile(activeFile.fileContents)}
										className="h-7 px-2 text-xs gap-1.5">
										<Copy className="h-3 w-3" /> Copy
									</Button>
								)}
							</div>
							{files.length > 0 ? (
								<div className="h-[450px] flex">
									<div className="w-full max-w-[200px] bg-bg-3/50 border-r border-border-primary/30 overflow-y-auto">
										{files.map((file) => (
											<button key={file.filePath} onClick={() => handleFileClick(file)}
												className={cn(
													'flex items-center w-full gap-2 py-1.5 px-3 text-left text-xs transition-colors',
													activeFile?.filePath === file.filePath
														? 'bg-accent/10 text-accent border-r-2 border-accent'
														: 'text-text-tertiary hover:text-text-primary hover:bg-bg-3',
												)}>
												<Code2 className="h-3 w-3 flex-shrink-0" />
												<span className="truncate font-mono">{file.filePath}</span>
											</button>
										))}
									</div>
									<div className="flex-1 flex flex-col min-w-0">
										{activeFile ? (
											<>
												<div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-primary/30 bg-bg-3/30">
													<span className="text-xs font-mono text-text-secondary">{activeFile.filePath}</span>
													{activeFile.explanation && (
														<span className="text-xs text-text-tertiary ml-2 truncate">{activeFile.explanation}</span>
													)}
												</div>
												<div className="flex-1 min-h-0">
													<Suspense fallback={<div className="h-full w-full bg-bg-3" />}>
														<MonacoEditor className="h-full"
															createOptions={{
																value: activeFile.fileContents,
																language: activeFile.language || 'plaintext',
																readOnly: true,
																minimap: { enabled: false },
																lineNumbers: 'on',
																scrollBeyondLastLine: false,
																fontSize: 13,
																theme: 'vibesdk',
																automaticLayout: true,
															}} />
													</Suspense>
												</div>
											</>
										) : (
											<div className="flex-1 flex items-center justify-center">
												<p className="text-xs text-text-tertiary">Select a file to view</p>
											</div>
										)}
									</div>
								</div>
							) : (
								<div className="flex items-center justify-center h-[300px]">
									<p className="text-xs text-text-tertiary">
										{app?.agentSummary === null ? 'Loading code...' : 'No code has been generated yet.'}
									</p>
								</div>
							)}
						</div>
					</TabsContent>

					{/* Prompt tab */}
					<TabsContent value="prompt" className="flex-1">
						<div className="rounded-lg border border-border-primary bg-bg-2 p-5">
							{app?.agentSummary?.query || app?.originalPrompt ? (
								<div className="space-y-3">
									<p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Original Prompt</p>
									<p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
										{app?.agentSummary?.query || app?.originalPrompt}
									</p>
									<div className="flex justify-end pt-1">
										<Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
											onClick={() => {
												const prompt = app?.agentSummary?.query || app?.originalPrompt;
												if (prompt) void copyPrompt(prompt);
											}}>
											<Copy className="h-3 w-3" /> Copy Prompt
										</Button>
									</div>
								</div>
							) : (
								<div className="flex items-center justify-center py-10 text-text-tertiary gap-2">
									<MessageSquare className="h-4 w-4" />
									<p className="text-sm">{app?.agentSummary === null ? 'Loading prompt...' : 'No prompt available'}</p>
								</div>
							)}
						</div>
					</TabsContent>
				</Tabs>
			</div>

			<ConfirmDeleteDialog
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
				onConfirm={handleDeleteApp}
				isLoading={isDeleting}
				appTitle={app?.title}
			/>

			<GitCloneModal
				open={isGitCloneModalOpen}
				onOpenChange={setIsGitCloneModalOpen}
				appId={app.id}
				appTitle={app.title}
				isPublic={app.visibility === 'public'}
				isOwner={isOwner}
			/>
		</div>
	);
}
