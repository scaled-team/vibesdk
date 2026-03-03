import type { RefObject } from 'react';
import { GitBranch, Github, Expand, Zap, Loader, ExternalLink, KeyRound, Monitor, Tablet, Smartphone } from 'lucide-react';
import { ModelConfigInfo } from '@/components/shared/ModelConfigInfo';
import { HeaderButton, HeaderToggleButton, HeaderDivider } from '@/components/shared/header-actions';
import type { ModelConfigsInfo } from '@/api-types';

export type ViewportMode = 'desktop' | 'tablet' | 'mobile';

export interface DeployProps {
	isDeployReady: boolean;
	isDeploying: boolean;
	deploymentUrl?: string;
	onDeploy: () => void;
}

export interface BaseHeaderActionsProps {
	containerRef: RefObject<HTMLElement | null>;
	modelConfigs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loadingConfigs: boolean;
	onGitCloneClick: () => void;
	isGitHubExportReady: boolean;
	onGitHubExportClick: () => void;
	deploy?: DeployProps;
	onEnvVarsClick?: () => void;
	viewport?: ViewportMode;
	onViewportChange?: (viewport: ViewportMode) => void;
}

export function BaseHeaderActions({
	containerRef,
	modelConfigs,
	onRequestConfigs,
	loadingConfigs,
	onGitCloneClick,
	isGitHubExportReady,
	onGitHubExportClick,
	deploy,
	onEnvVarsClick,
	viewport,
	onViewportChange,
}: BaseHeaderActionsProps) {
	return (
		<>
			<ModelConfigInfo
				configs={modelConfigs}
				onRequestConfigs={onRequestConfigs}
				loading={loadingConfigs}
			/>
			<HeaderButton
				icon={GitBranch}
				label="Clone"
				onClick={onGitCloneClick}
				title="Clone to local machine"
			/>
			{isGitHubExportReady && (
				<HeaderButton
					icon={Github}
					label="GitHub"
					onClick={onGitHubExportClick}
					title="Export to GitHub"
				/>
			)}
			{onEnvVarsClick && (
				<HeaderButton
					icon={KeyRound}
					label="Env"
					onClick={onEnvVarsClick}
					title="Environment variables"
				/>
			)}
			{/* Deploy button */}
			{deploy && (deploy.isDeployReady || deploy.isDeploying || deploy.deploymentUrl) && (
				deploy.deploymentUrl && !deploy.isDeploying ? (
					<HeaderButton
						icon={ExternalLink}
						label="Live"
						onClick={() => window.open(deploy.deploymentUrl, '_blank')}
						title="View live site"
					/>
				) : deploy.isDeploying ? (
					<HeaderButton
						icon={Loader}
						label="Deploying"
						onClick={() => { }}
						title="Deployment in progress..."
					/>
				) : (
					<HeaderButton
						icon={Zap}
						label="Deploy"
						onClick={deploy.onDeploy}
						title="Deploy"
					/>
				)
			)}
			{onViewportChange && (
				<>
					<HeaderDivider />
					<HeaderToggleButton
						icon={Monitor}
						onClick={() => onViewportChange('desktop')}
						title="Desktop"
						active={viewport === 'desktop'}
					/>
					<HeaderToggleButton
						icon={Tablet}
						onClick={() => onViewportChange('tablet')}
						title="Tablet (768×1024)"
						active={viewport === 'tablet'}
					/>
					<HeaderToggleButton
						icon={Smartphone}
						onClick={() => onViewportChange('mobile')}
						title="Mobile (375×667)"
						active={viewport === 'mobile'}
					/>
				</>
			)}
			<HeaderButton
				icon={Expand}
				onClick={() => containerRef.current?.requestFullscreen()}
				title="Fullscreen"
				iconOnly
			/>
		</>
	);
}
