import { Settings, Code2, Zap, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getModelDisplayName, getProviderInfo } from '@/utils/model-helpers';
import type { ModelConfig, UserModelConfigWithMetadata, AgentDisplayConfig } from '@/api-types';

interface ConfigCardProps {
  agent: AgentDisplayConfig;
  userConfig?: UserModelConfigWithMetadata;
  defaultConfig?: ModelConfig;
  onConfigure: () => void;
  onTest: () => void;
  onReset: () => void;
  isTesting: boolean;
}

// Helper function to get agent icon based on type
const getAgentIcon = (agentKey: string) => {
  if (agentKey.includes('Code') || agentKey.includes('phase') || agentKey.includes('file')) return Code2;
  if (agentKey.includes('fast') || agentKey.includes('template')) return Zap;
  if (agentKey.includes('blueprint') || agentKey.includes('suggestion') || agentKey.includes('review')) return Brain;
  return Settings;
};

export function ConfigCard({
  agent,
  userConfig,
  defaultConfig,
  onConfigure,
  isTesting
}: ConfigCardProps) {
  const isCustomized = userConfig?.isUserOverride || false;
  const currentModel = userConfig?.name || defaultConfig?.name;
  const modelDisplayName = getModelDisplayName(currentModel);
  const providerInfo = getProviderInfo(currentModel);
  const AgentIcon = getAgentIcon(agent.key);

  return (
    <Card className={`flex flex-col overflow-hidden transition-all dark:!bg-bg-3 !bg-bg-3 hover:shadow-md !border-bg-1/40`}>
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-bg-2 dark:bg-bg-4 shrink-0 mt-0.5">
              <AgentIcon className="h-3.5 w-3.5 text-text-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <h5 className="font-medium text-sm leading-tight" title={agent.name}>
                {agent.name}
              </h5>
              <p className="text-xs text-text-tertiary line-clamp-2 leading-snug mt-0.5" title={agent.description}>
                {agent.description}
              </p>
            </div>
          </div>

          {isCustomized && (
            <Badge variant="default" className="text-xs px-1.5 py-0 shrink-0">
              Custom
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 flex-1 flex flex-col justify-end">
        {/* Model info + Configure button */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs text-text-secondary truncate" title={modelDisplayName}>
              {modelDisplayName}
            </span>
            <Badge
              variant="secondary"
              className={`text-[10px] shrink-0 px-1 py-0 dark:contrast-50 ${providerInfo.color}`}
            >
              {providerInfo.name}
            </Badge>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={onConfigure}
            disabled={isTesting}
            className="h-7 text-xs font-medium shrink-0 dark:bg-bg-2"
          >
            {isTesting ? (
              <>
                <Settings className="h-3 w-3 mr-1 animate-spin" />
                Testing…
              </>
            ) : (
              'Configure'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}