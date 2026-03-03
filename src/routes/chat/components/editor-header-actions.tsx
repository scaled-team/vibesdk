import type { RefObject } from 'react';
import { BaseHeaderActions, type DeployProps, type ViewportMode } from '@/components/shared/BaseHeaderActions';
import type { ModelConfigsInfo } from '@/api-types';

interface EditorHeaderActionsProps {
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	editorRef: RefObject<HTMLDivElement | null>;
	deploy?: DeployProps;
	onEnvVarsClick?: () => void;
	viewport?: ViewportMode;
	onViewportChange?: (viewport: ViewportMode) => void;
}

export function EditorHeaderActions({
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	editorRef,
	deploy,
	onEnvVarsClick,
	viewport,
	onViewportChange,
}: EditorHeaderActionsProps) {
	return (
		<BaseHeaderActions
			containerRef={editorRef}
			modelConfigs={modelConfigs}
			onRequestConfigs={onRequestConfigs}
			loadingConfigs={loadingConfigs}
			onGitCloneClick={onGitCloneClick}
			isGitHubExportReady={isGitHubExportReady}
			onGitHubExportClick={onGitHubExportClick}
			deploy={deploy}
			onEnvVarsClick={onEnvVarsClick}
			viewport={viewport}
			onViewportChange={onViewportChange}
		/>
	);
}
