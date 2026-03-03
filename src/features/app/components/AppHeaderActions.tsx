import { BaseHeaderActions } from '@/components/shared/BaseHeaderActions';
import type { HeaderActionsProps } from '../../core/types';

export function AppHeaderActions({
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	previewRef,
	onEnvVarsClick,
	viewport,
	onViewportChange,
}: HeaderActionsProps) {
	return (
		<BaseHeaderActions
			containerRef={previewRef}
			modelConfigs={modelConfigs}
			onRequestConfigs={onRequestConfigs}
			loadingConfigs={loadingConfigs}
			onGitCloneClick={onGitCloneClick}
			isGitHubExportReady={isGitHubExportReady}
			onGitHubExportClick={onGitHubExportClick}
			onEnvVarsClick={onEnvVarsClick}
			viewport={viewport}
			onViewportChange={onViewportChange}
		/>
	);
}
