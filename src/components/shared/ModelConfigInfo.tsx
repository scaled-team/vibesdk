import { useState } from 'react';
import { Info, Settings, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { getModelDisplayName, getProviderInfo, categorizeAgent } from '@/utils/model-helpers';
import { WORKFLOW_TABS } from '@/lib/constants/workflow-tabs';
import type { ModelConfigsInfo } from '@/api-types';

interface ModelConfigInfoProps {
	configs?: ModelConfigsInfo;
	onRequestConfigs: () => void;
	loading?: boolean;
}

export function ModelConfigInfo({ configs, onRequestConfigs, loading }: ModelConfigInfoProps) {
	const [isOpen, setIsOpen] = useState(false);

	const handleOpen = () => {
		setIsOpen(true);
		if (!configs) {
			onRequestConfigs();
		}
	};

	// Group agents by workflow tab
	const groupedAgents = configs
		? Object.values(WORKFLOW_TABS)
			.map((tab) => ({
				tab,
				agents: configs.agents.filter((a) => categorizeAgent(a.key) === tab.id),
			}))
			.filter((group) => group.agents.length > 0)
		: [];

	return (
		<>
			<button
				onClick={handleOpen}
				className="group relative flex items-center gap-1.5 p-1.5 group-hover:pl-2 group-hover:pr-2.5 rounded-full group-hover:rounded-md transition-all duration-300 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm overflow-hidden"
				title="View current model configurations"
				type="button"
			>
				<Info className="size-3.5 text-text-primary/60 group-hover:text-brand-primary transition-colors duration-300 flex-shrink-0" />
				<span className="max-w-0 group-hover:max-w-[75px] opacity-0 group-hover:opacity-100 overflow-hidden transition-all duration-300 ease-in-out whitespace-nowrap text-xs font-medium text-text-primary">
					Model Info
				</span>
			</button>

			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className="max-w-2xl w-[90vw] max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-base">
							<Settings className="h-4 w-4" />
							Model Configurations
						</DialogTitle>
						<DialogDescription className="text-xs">
							Current AI model settings for each workflow stage.
						</DialogDescription>
					</DialogHeader>

					{loading ? (
						<div className="flex items-center justify-center gap-2 py-12">
							<Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
							<span className="text-sm text-text-tertiary">Loading configurations…</span>
						</div>
					) : !configs ? (
						<div className="text-center py-12 text-text-tertiary">
							<p className="text-sm">Failed to load configurations.</p>
							<Button variant="outline" size="sm" onClick={onRequestConfigs} className="mt-3">
								Retry
							</Button>
						</div>
					) : (
						<div className="space-y-5 -mt-1">
							{groupedAgents.map(({ tab, agents }) => {
								const Icon = tab.icon;
								return (
									<div key={tab.id}>
										{/* Section header */}
										<div className="flex items-center gap-2 mb-2.5">
											<Icon className="h-3.5 w-3.5 text-text-tertiary" />
											<span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
												{tab.label}
											</span>
											<div className="flex-1 h-px bg-border-primary/30" />
										</div>

										{/* Agent rows */}
										<div className="space-y-1">
											{agents.map((agent) => {
												const userConfig = configs.userConfigs[agent.key];
												const defaultConfig = configs.defaultConfigs[agent.key];
												const isCustomized = userConfig?.isUserOverride || false;
												const currentModel = userConfig?.name || defaultConfig?.name;
												const modelDisplayName = getModelDisplayName(currentModel);
												const providerInfo = getProviderInfo(currentModel);
												const temperature = userConfig?.temperature ?? defaultConfig?.temperature;
												const reasoningEffort = userConfig?.reasoning_effort ?? defaultConfig?.reasoning_effort;

												return (
													<div
														key={agent.key}
														className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-bg-3/60 transition-colors group/row"
													>
														{/* Agent name */}
														<div className="min-w-0 flex-shrink-0 w-[140px]">
															<span className="text-sm font-medium text-text-primary truncate block" title={agent.name}>
																{agent.name}
															</span>
														</div>

														{/* Model + provider */}
														<div className="flex items-center gap-1.5 min-w-0 flex-1">
															<span className="text-xs text-text-secondary truncate" title={modelDisplayName}>
																{modelDisplayName}
															</span>
															<Badge
																variant="secondary"
																className={`text-[10px] px-1 py-0 shrink-0 ${providerInfo.color}`}
															>
																{providerInfo.name}
															</Badge>
														</div>

														{/* Parameters */}
														<div className="flex items-center gap-1 shrink-0">
															{temperature !== null && temperature !== undefined && (
																<span className="text-[10px] text-text-tertiary font-mono">
																	T:{temperature}
																</span>
															)}
															{reasoningEffort && (
																<span className="text-[10px] text-text-tertiary font-mono">
																	{reasoningEffort.charAt(0).toUpperCase()}
																</span>
															)}
															{isCustomized && (
																<Badge variant="default" className="text-[10px] px-1 py-0 ml-1">
																	Custom
																</Badge>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
