/**
 * Model Configuration Modal — Simplified
 * Clean top-to-bottom flow: Model → Fallback → Temperature → Reasoning → Save
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Settings, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ModelSelector } from '@/components/ui/model-selector';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/lib/api-client';
import type {
  ModelConfig,
  UserModelConfigWithMetadata,
  ModelConfigUpdate,
  ByokProvidersData,
  AgentDisplayConfig
} from '@/api-types';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentConfig: AgentDisplayConfig;
  userConfig?: UserModelConfigWithMetadata;
  defaultConfig?: ModelConfig;
  onSave: (config: ModelConfigUpdate) => Promise<void>;
  onTest: (tempConfig?: ModelConfigUpdate) => Promise<void>;
  onReset: () => Promise<void>;
  isTesting: boolean;
}

// Helper to extract provider from model name (e.g., "openai/gpt-4" -> "openai")
const getProviderFromModel = (modelName: string): string => {
  if (!modelName || modelName === 'default') return '';
  return modelName.split('/')[0] || '';
};

// Helper to check if user has BYOK key for a model's provider
const hasUserKeyForModel = (modelName: string, byokProviders: Array<{ provider: string; hasValidKey: boolean }>): boolean => {
  const provider = getProviderFromModel(modelName);
  if (!provider) return false;
  return byokProviders.some(p => p.provider === provider && p.hasValidKey);
};

export function ConfigModal({
  isOpen,
  onClose,
  agentConfig,
  userConfig,
  defaultConfig,
  onSave,
  onTest,
  onReset,
  isTesting
}: ConfigModalProps) {
  // Form state
  const [formData, setFormData] = useState({
    modelName: userConfig?.name || 'default',
    temperature: userConfig?.temperature?.toString() || '',
    reasoningEffort: userConfig?.reasoning_effort || 'default',
    fallbackModel: userConfig?.fallbackModel || 'default'
  });

  // UI state
  const [hasChanges, setHasChanges] = useState(false);

  // Modal lifecycle tracking
  const [isInitialOpen, setIsInitialOpen] = useState(false);

  // BYOK data state
  const [byokData, setByokData] = useState<ByokProvidersData | null>(null);
  const [loadingByok, setLoadingByok] = useState(false);

  // Load BYOK data (filtered by agent constraints)
  const loadByokData = useCallback(async () => {
    try {
      setLoadingByok(true);
      const response = await apiClient.getByokProviders(agentConfig.key);
      if (response.success && response.data) {
        setByokData(response.data);
      }
    } catch (error) {
      console.error('Failed to load BYOK data:', error);
    } finally {
      setLoadingByok(false);
    }
  }, [agentConfig.key]);

  // Handle modal open/close lifecycle
  useEffect(() => {
    if (isOpen && !isInitialOpen) {
      setFormData({
        modelName: userConfig?.name || 'default',
        temperature: userConfig?.temperature?.toString() || '',
        reasoningEffort: userConfig?.reasoning_effort || 'default',
        fallbackModel: userConfig?.fallbackModel || 'default'
      });
      setHasChanges(false);
      setIsInitialOpen(true);
      loadByokData();
    } else if (!isOpen && isInitialOpen) {
      setIsInitialOpen(false);
    }
  }, [isOpen, isInitialOpen, userConfig, loadByokData]);

  // Check for changes
  useEffect(() => {
    const originalFormData = {
      modelName: userConfig?.name || 'default',
      temperature: userConfig?.temperature?.toString() || '',
      reasoningEffort: userConfig?.reasoning_effort || 'default',
      fallbackModel: userConfig?.fallbackModel || 'default'
    };
    setHasChanges(JSON.stringify(formData) !== JSON.stringify(originalFormData));
  }, [formData, userConfig]);

  // Get unified model list with BYOK status info
  const availableModels = useMemo(() => {
    if (!byokData) return [];

    const models: { value: string; label: string; provider: string; hasUserKey: boolean; byokAvailable: boolean }[] = [];
    const processedModels = new Set<string>();

    // BYOK models first
    Object.values(byokData.modelsByProvider).forEach(providerModels => {
      providerModels.forEach(model => {
        const modelStr = model as string;
        if (!processedModels.has(modelStr)) {
          const provider = getProviderFromModel(modelStr);
          const hasUserKey = hasUserKeyForModel(modelStr, byokData.providers);
          models.push({ value: modelStr, label: modelStr, provider, hasUserKey, byokAvailable: true });
          processedModels.add(modelStr);
        }
      });
    });

    // Platform-only models
    byokData.platformModels.forEach(model => {
      const modelStr = model as string;
      if (!processedModels.has(modelStr)) {
        models.push({ value: modelStr, label: modelStr, provider: '', hasUserKey: false, byokAvailable: false });
        processedModels.add(modelStr);
      }
    });

    return models.sort((a, b) => a.label.localeCompare(b.label));
  }, [byokData]);

  // Create config object from current form state
  const buildCurrentConfig = (): ModelConfigUpdate => {
    return {
      ...(formData.modelName !== 'default' && { modelName: formData.modelName }),
      ...(formData.temperature && { temperature: parseFloat(formData.temperature) }),
      ...(formData.reasoningEffort !== 'default' && { reasoningEffort: formData.reasoningEffort }),
      ...(formData.fallbackModel !== 'default' && { fallbackModel: formData.fallbackModel }),
      isUserOverride: true
    };
  };

  const handleSave = async () => {
    const config = buildCurrentConfig();
    await onSave(config);
  };

  const handleTestWithCurrentConfig = async () => {
    const currentConfig = buildCurrentConfig();
    await onTest(currentConfig);
  };

  const handleReset = async () => {
    await onReset();
    onClose();
  };

  const isUserOverride = userConfig?.isUserOverride || false;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="overflow-y-auto max-w-lg w-[90vw] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {agentConfig.name}
          </DialogTitle>
          <DialogDescription>
            {agentConfig.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Status indicator */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-tertiary">
              {isUserOverride ? 'Custom configuration' : 'Using defaults'}
            </span>
            <Badge variant={isUserOverride ? "default" : "outline"} className="text-xs">
              {isUserOverride ? "Custom" : "Default"}
            </Badge>
          </div>

          {/* Constraint notice — only when relevant */}
          {agentConfig.constraint?.enabled && (
            <p className="text-xs text-text-tertiary bg-bg-3/50 px-3 py-2 rounded-md">
              Limited to {agentConfig.constraint.allowedModels.length} allowed model{agentConfig.constraint.allowedModels.length !== 1 ? 's' : ''} for this operation.
            </p>
          )}

          {/* Primary Model */}
          <div className="space-y-2">
            <ModelSelector
              value={formData.modelName}
              onValueChange={(value) => setFormData({ ...formData, modelName: value })}
              availableModels={availableModels}
              placeholder="Select model..."
              label="AI Model"
              systemDefault={defaultConfig?.name}
              disabled={loadingByok}
            />
          </div>

          {/* Fallback Model */}
          <div className="space-y-2">
            <ModelSelector
              value={formData.fallbackModel}
              onValueChange={(value) => setFormData({ ...formData, fallbackModel: value })}
              availableModels={availableModels}
              placeholder="Select fallback model..."
              label="Fallback Model"
              systemDefault={defaultConfig?.fallbackModel}
              includeDefaultOption={true}
              disabled={loadingByok}
            />
          </div>

          {/* Parameters — side by side */}
          <div className="grid grid-cols-2 gap-4">
            {/* Temperature */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Temperature</Label>
              <Input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={formData.temperature}
                placeholder={defaultConfig?.temperature ? `${defaultConfig.temperature}` : '0.7'}
                onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                className="h-9"
              />
              {defaultConfig?.temperature && (
                <p className="text-xs text-text-tertiary">Default: {defaultConfig.temperature}</p>
              )}
            </div>

            {/* Reasoning Effort */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Reasoning Effort</Label>
              <Select value={formData.reasoningEffort} onValueChange={(value) => setFormData({ ...formData, reasoningEffort: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="low">Low (Fast)</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High (Deep)</SelectItem>
                </SelectContent>
              </Select>
              {defaultConfig?.reasoning_effort && (
                <p className="text-xs text-text-tertiary">Default: {defaultConfig.reasoning_effort}</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row sm:justify-between pt-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestWithCurrentConfig}
              disabled={isTesting}
              className="gap-1.5"
            >
              {isTesting ? (
                <>
                  <Settings className="h-3.5 w-3.5 animate-spin" />
                  Testing…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Test
                </>
              )}
            </Button>

            {isUserOverride && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 text-text-tertiary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}