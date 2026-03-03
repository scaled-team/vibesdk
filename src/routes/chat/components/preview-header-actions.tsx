import type { RefObject } from 'react';
import { BaseHeaderActions, type DeployProps, type ViewportMode } from '@/components/shared/BaseHeaderActions';
import type { ModelConfigsInfo } from '@/api-types';

interface PreviewHeaderActionsProps {
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	previewRef: RefObject<HTMLIFrameElement | null>;
	deploy?: DeployProps;
	onEnvVarsClick?: () => void;
	viewport?: ViewportMode;
	onViewportChange?: (viewport: ViewportMode) => void;
}

export function PreviewHeaderActions({
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	deploy,
	onEnvVarsClick,
	viewport,
	onViewportChange,
}: PreviewHeaderActionsProps) {
	return (
		<BaseHeaderActions
			containerRef={previewRef}
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
