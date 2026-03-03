import {
    IDeploymentManager,
    DeploymentParams,
    DeploymentResult,
    SandboxDeploymentCallbacks,
    CloudflareDeploymentCallbacks
} from '../interfaces/IDeploymentManager';
import { BootstrapResponse, StaticAnalysisResponse, RuntimeError, PreviewType } from '../../../services/sandbox/sandboxTypes';
import { FileOutputType } from '../../schemas';
import { generateId } from '../../../utils/idGenerator';
import { generateAppProxyToken, generateAppProxyUrl } from '../../../services/aigateway-proxy/controller';
import { BaseAgentService } from './BaseAgentService';
import { ServiceOptions } from '../interfaces/IServiceOptions';
import { BaseSandboxService } from 'worker/services/sandbox/BaseSandboxService';
import { getSandboxService } from '../../../services/sandbox/factory';
import { validateAndCleanBootstrapCommands } from 'worker/agents/utils/common';
import { DeploymentTarget } from '../../core/types';
import { BaseProjectState } from '../../core/state';

const PER_ATTEMPT_TIMEOUT_MS = 30000;  // 30 seconds per individual attempt
const MASTER_DEPLOYMENT_TIMEOUT_MS = 120000;  // 2 minutes total
const HEALTH_CHECK_INITIAL_INTERVAL_MS = 3000;  // 3s initial check (fast detection)
const HEALTH_CHECK_STABLE_INTERVAL_MS = 15000;  // 15s after stable
const HEALTH_CHECK_IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes — stop checks after inactivity

/**
 * Manages deployment operations for sandbox instances
 * Handles instance creation, file deployment, analysis, and GitHub/Cloudflare export
 * Also manages sessionId and health check intervals
 */
export class DeploymentManager extends BaseAgentService<BaseProjectState> implements IDeploymentManager {
    private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
    private currentDeploymentPromise: Promise<PreviewType | null> | null = null;
    private cachedSandboxClient: BaseSandboxService | null = null;
    private lastActivityTimestamp: number = Date.now();

    constructor(
        options: ServiceOptions<BaseProjectState>,
        private maxCommandsHistory: number,
    ) {
        super(options);

        // Ensure state has sessionId
        const state = this.getState();
        if (!state.sessionId) {
            this.setState({
                ...state,
                sessionId: DeploymentManager.generateNewSessionId()
            });
        }
    }

    /**
     * Get current session ID from state
     */
    getSessionId(): string {
        return this.getState().sessionId;
    }

    /**
     * Cache is tied to current sessionId and invalidated on reset
     */
    public getClient(): BaseSandboxService {
        if (!this.cachedSandboxClient) {
            const logger = this.getLog();
            logger.info('Creating sandbox service client', {
                sessionId: this.getSessionId(),
                agentId: this.getAgentId()
            });
            this.cachedSandboxClient = getSandboxService(
                this.getSessionId(),
                this.getAgentId()
            );
        }
        return this.cachedSandboxClient;
    }

    /**
     * Reset session ID (called on timeout or specific errors)
     */
    resetSessionId(): void {
        const logger = this.getLog();
        const state = this.getState();
        const oldSessionId = state.sessionId;
        const newSessionId = DeploymentManager.generateNewSessionId();

        logger.info(`SessionId reset: ${oldSessionId} → ${newSessionId}`);

        // Reset session ID in logger
        logger.setFields({
            sessionId: newSessionId,
        });
        // Invalidate cached sandbox client (tied to old sessionId)
        this.cachedSandboxClient = null;

        // Update state
        this.setState({
            ...state,
            sessionId: newSessionId,
            sandboxInstanceId: undefined  // Clear instance on session reset
        });
    }

    static generateNewSessionId(): string {
        return generateId();
    }

    /**
     * Wait for preview to be ready
     */
    async waitForPreview(): Promise<void> {
        const state = this.getState();
        const logger = this.getLog();

        logger.info("Waiting for preview");

        if (!state.sandboxInstanceId) {
            logger.info("No sandbox instance, will create during next deploy");
        }

        logger.info("Waiting for preview completed");
    }

    /**
     * Execute setup commands (used during redeployment)
     * @param onAfterCommands Optional callback invoked after commands complete (e.g., for syncing package.json)
     */
    async executeSetupCommands(
        sandboxInstanceId: string,
        timeoutMs: number = 60000,
        onAfterCommands?: () => Promise<void>
    ): Promise<void> {
        const { commandsHistory } = this.getState();
        const logger = this.getLog();
        const client = this.getClient();

        if (!commandsHistory || commandsHistory.length === 0) {
            return;
        }

        // CRITICAL: Audit bootstrap commands before execution (safety net)
        const { validCommands, invalidCommands } = validateAndCleanBootstrapCommands(
            commandsHistory,
            this.maxCommandsHistory
        );

        if (invalidCommands.length > 0) {
            logger.warn('[commands] DANGEROUS COMMANDS DETECTED IN BOOTSTRAP - FILTERED OUT', {
                dangerous: invalidCommands,
                dangerousCount: invalidCommands.length,
                validCount: validCommands.length
            });
        }

        if (validCommands.length === 0) {
            logger.warn('[commands] No valid commands to execute after filtering');
            return;
        }

        logger.info(`[commands] Executing ${validCommands.length} validated setup commands on instance ${sandboxInstanceId}`);

        await this.withTimeout(
            client.executeCommands(sandboxInstanceId, validCommands),
            timeoutMs,
            'Command execution timed out'
        );

        logger.info('Setup commands executed successfully');

        // Invoke callback if provided (e.g., for package.json sync)
        if (onAfterCommands) {
            logger.info('Invoking post-command callback');
            await onAfterCommands();
        }
    }

    /**
     * Start health check interval for instance with adaptive timing.
     * Starts fast (3s) for quick failure detection, backs off to 15s after stability.
     */
    private startHealthCheckInterval(instanceId: string): void {
        const logger = this.getLog();

        // Clear any existing interval
        this.clearHealthCheckInterval();

        logger.info(`Starting adaptive health check for instance ${instanceId}`);

        let consecutiveHealthy = 0;
        const STABLE_THRESHOLD = 3; // Switch to slow interval after 3 consecutive healthy checks

        const scheduleCheck = (intervalMs: number) => {
            this.healthCheckInterval = setTimeout(async () => {
                // Stop health checks if idle for too long
                const idleMs = Date.now() - this.lastActivityTimestamp;
                if (idleMs > HEALTH_CHECK_IDLE_TIMEOUT_MS) {
                    logger.info(`Stopping health checks — idle for ${Math.round(idleMs / 60000)}min`);
                    this.clearHealthCheckInterval();
                    return;
                }

                try {
                    const client = this.getClient();
                    const status = await client.getInstanceStatus(instanceId);

                    if (!status.success || !status.isHealthy) {
                        consecutiveHealthy = 0;
                        logger.warn(`Instance ${instanceId} unhealthy, triggering redeploy`);

                        try {
                            await this.deployToSandbox();
                            logger.info('Instance redeployed after health check failure');
                        } catch (redeployError) {
                            logger.error('Failed to redeploy after health check failure:', redeployError);
                        }
                        return; // Don't reschedule — redeploy starts its own health check
                    }

                    consecutiveHealthy++;
                    const nextInterval = consecutiveHealthy >= STABLE_THRESHOLD
                        ? HEALTH_CHECK_STABLE_INTERVAL_MS
                        : HEALTH_CHECK_INITIAL_INTERVAL_MS;
                    scheduleCheck(nextInterval);
                } catch (error) {
                    logger.error('Health check failed:', error);
                    consecutiveHealthy = 0;
                    scheduleCheck(HEALTH_CHECK_INITIAL_INTERVAL_MS);
                }
            }, intervalMs) as unknown as ReturnType<typeof setInterval>;
        };

        scheduleCheck(HEALTH_CHECK_INITIAL_INTERVAL_MS);
    }

    private clearHealthCheckInterval(): void {
        if (this.healthCheckInterval !== null) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Run static analysis (lint + typecheck) on code
     */
    async runStaticAnalysis(files?: string[]): Promise<StaticAnalysisResponse> {
        this.lastActivityTimestamp = Date.now();
        let { sandboxInstanceId } = this.getState();

        // If sandbox isn't ready but a deployment is in progress, wait for it
        if (!sandboxInstanceId && this.currentDeploymentPromise) {
            this.getLog().info('Waiting for in-flight deployment before static analysis...');
            try {
                await this.currentDeploymentPromise;
            } catch {
                // Deployment failed — will fall through to the check below
            }
            sandboxInstanceId = this.getState().sandboxInstanceId;
        }

        if (!sandboxInstanceId) {
            throw new Error('No sandbox instance available for static analysis');
        }

        const logger = this.getLog();
        const client = this.getClient();

        logger.info(`Linting code in sandbox instance ${sandboxInstanceId}`);

        const targetFiles = Array.isArray(files) && files.length > 0
            ? files
            : this.fileManager.getGeneratedFilePaths();

        const analysisResponse = await client.runStaticAnalysisCode(
            sandboxInstanceId,
            targetFiles
        );

        if (!analysisResponse || analysisResponse.error) {
            const errorMsg = `Code linting failed: ${analysisResponse?.error || 'Unknown error'}`;
            logger.error(errorMsg, { fullResponse: analysisResponse });
            throw new Error(errorMsg);
        }

        const { lint, typecheck } = analysisResponse;
        const { issues: lintIssues, summary: lintSummary } = lint;
        const { issues: typeCheckIssues, summary: typeCheckSummary } = typecheck;

        logger.info(`Linting found ${lintIssues.length} issues: ` +
            `${lintSummary?.errorCount || 0} errors, ` +
            `${lintSummary?.warningCount || 0} warnings, ` +
            `${lintSummary?.infoCount || 0} info`);

        logger.info(`Type checking found ${typeCheckIssues.length} issues: ` +
            `${typeCheckSummary?.errorCount || 0} errors, ` +
            `${typeCheckSummary?.warningCount || 0} warnings, ` +
            `${typeCheckSummary?.infoCount || 0} info`);

        return analysisResponse;
    }

    /**
     * Fetch runtime errors from sandbox instance
     */
    async fetchRuntimeErrors(clear: boolean = true): Promise<RuntimeError[]> {
        const { sandboxInstanceId } = this.getState();
        if (!sandboxInstanceId) {
            throw new Error('No sandbox instance available for runtime error fetching');
        }
        const logger = this.getLog();
        const client = this.getClient();

        const resp = await client.getInstanceErrors(sandboxInstanceId, clear);

        if (!resp || !resp.success) {
            throw new Error(`Failed to fetch runtime errors: ${resp?.error || 'Unknown error'}`);
        }

        const errors = resp.errors || [];

        if (errors.length > 0) {
            logger.info(`Found ${errors.length} runtime errors: ${errors.map(e => e.message).join(', ')}`);
        }

        return errors;
    }

    /**
     * Main deployment method
     * Callbacks allow agent to broadcast at the right times
     * All concurrent callers share the same promise and wait together
     * Retries indefinitely until success or master timeout (5 minutes)
     */
    async deployToSandbox(
        files: FileOutputType[] = [],
        redeploy: boolean = false,
        commitMessage?: string,
        clearLogs: boolean = false,
        callbacks?: SandboxDeploymentCallbacks
    ): Promise<PreviewType | null> {
        const logger = this.getLog();

        // All concurrent callers wait on the same promise
        if (this.currentDeploymentPromise) {
            logger.info('Deployment already in progress, waiting for completion');
            return await this.withTimeout(
                this.currentDeploymentPromise,
                MASTER_DEPLOYMENT_TIMEOUT_MS,
                'Deployment failed after 5 minutes'
            ).catch(() => null);  // Convert timeout to null like first caller
        }

        this.lastActivityTimestamp = Date.now();
        logger.info("Deploying to sandbox", { files: files.length, redeploy, commitMessage, sessionId: this.getSessionId() });

        // Create deployment promise
        this.currentDeploymentPromise = this.executeDeploymentWithRetry(
            files,
            redeploy,
            commitMessage,
            clearLogs,
            callbacks
        );

        try {
            // Master timeout: 5 minutes total
            // This doesn't break the underlying operation - it just stops waiting
            const result = await this.withTimeout(
                this.currentDeploymentPromise,
                MASTER_DEPLOYMENT_TIMEOUT_MS,
                'Deployment failed after 5 minutes of retries'
                // No onTimeout callback - don't break the operation
            );
            return result;
        } catch (error) {
            // Master timeout reached - all retries exhausted
            logger.error('Deployment permanently failed after master timeout:', error);
            return null;
        } finally {
            this.currentDeploymentPromise = null;
        }
    }

    /**
     * Execute deployment with infinite retry until success
     * Each attempt has its own timeout
     * Resets sessionId after consecutive failures
     */
    private async executeDeploymentWithRetry(
        files: FileOutputType[],
        redeploy: boolean,
        commitMessage: string | undefined,
        clearLogs: boolean,
        callbacks?: SandboxDeploymentCallbacks
    ): Promise<PreviewType> {
        const logger = this.getLog();
        let attempt = 0;
        const maxAttemptsBeforeSessionReset = 3;

        while (true) {
            attempt++;
            logger.info(`Deployment attempt ${attempt}`, { sessionId: this.getSessionId() });

            try {
                // Callback: deployment starting (only on first attempt)
                callbacks?.onStarted?.({
                    message: "Deploying code to sandbox service",
                    files: files.map(f => ({ filePath: f.filePath }))
                });

                // Core deployment with per-attempt timeout
                const deployPromise = this.deploy({
                    files,
                    redeploy,
                    commitMessage,
                    clearLogs
                });

                const result = await this.withTimeout(
                    deployPromise,
                    PER_ATTEMPT_TIMEOUT_MS,
                    `Deployment attempt ${attempt} timed out`
                    // No onTimeout callback - don't break anything
                );

                // Success! Start health check and return
                if (result.redeployed || this.healthCheckInterval === null) {
                    this.startHealthCheckInterval(result.sandboxInstanceId);
                    // Execute setup commands with callback
                    await this.executeSetupCommands(
                        result.sandboxInstanceId,
                        undefined,
                        callbacks?.onAfterSetupCommands
                    );
                }

                const preview = {
                    runId: result.sandboxInstanceId,
                    previewURL: result.previewURL,
                    tunnelURL: result.tunnelURL
                };

                callbacks?.onCompleted?.({
                    message: "Deployment completed",
                    instanceId: preview.runId,
                    previewURL: preview.previewURL ?? '',
                    tunnelURL: preview.tunnelURL ?? ''
                });

                logger.info('Deployment succeeded', { attempt, sessionId: this.getSessionId() });
                return preview;

            } catch (error) {
                logger.warn(`Deployment attempt ${attempt} failed:`, error);

                const errorMsg = error instanceof Error ? error.message : String(error);

                // Handle specific errors that require session reset
                if (errorMsg.includes('Network connection lost') ||
                    errorMsg.includes('Container service disconnected') ||
                    errorMsg.includes('Internal error in Durable Object storage')) {
                    logger.warn('Session-level error detected, resetting sessionId');
                    this.resetSessionId();
                }

                // After consecutive failures, reset session to get fresh sandbox
                if (attempt % maxAttemptsBeforeSessionReset === 0) {
                    logger.warn(`${attempt} consecutive failures, resetting sessionId for fresh sandbox`);
                    this.resetSessionId();
                }

                // Clear instance ID from state
                this.setState({
                    ...this.getState(),
                    sandboxInstanceId: undefined
                });

                callbacks?.onError?.({
                    error: `Deployment attempt ${attempt} failed: ${errorMsg}`
                });

                // Exponential backoff before retry (capped at 2 seconds)
                const backoffMs = Math.min(500 * Math.pow(2, Math.min(attempt - 1, 2)), 2000);
                logger.info(`Retrying deployment in ${backoffMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));

                // Loop continues - retry indefinitely until master timeout
            }
        }
    }


    /**
     * Deploy files to sandbox instance (core deployment)
     */
    private async deploy(params: DeploymentParams): Promise<DeploymentResult> {
        const { files, redeploy, commitMessage, clearLogs } = params;
        const logger = this.getLog();

        logger.info("Deploying code to sandbox service");

        // Ensure instance exists and is healthy
        const instanceResult = await this.ensureInstance(redeploy);
        const { sandboxInstanceId, previewURL, tunnelURL, redeployed } = instanceResult;

        // Determine which files to deploy
        const filesToWrite = this.getFilesToDeploy(files, redeployed);

        // Write files and clear logs in parallel where possible
        const pendingOps: Promise<void>[] = [];

        if (filesToWrite.length > 0) {
            pendingOps.push((async () => {
                const writeResponse = await this.getClient().writeFiles(
                    sandboxInstanceId,
                    filesToWrite,
                    commitMessage
                );

                if (!writeResponse || !writeResponse.success) {
                    logger.error(`File writing failed. Error: ${writeResponse?.error}`);
                    throw new Error(`File writing failed. Error: ${writeResponse?.error}`);
                }

                logger.info('Files written to sandbox instance', { instanceId: sandboxInstanceId, files: filesToWrite.map(f => f.filePath) });
            })());
        }

        if (clearLogs) {
            pendingOps.push((async () => {
                try {
                    await Promise.all([
                        this.getClient().getLogs(sandboxInstanceId, true),
                        this.getClient().clearInstanceErrors(sandboxInstanceId)
                    ]);
                } catch (error) {
                    logger.error('Failed to clear logs and runtime errors', error);
                }
            })());
        }

        if (pendingOps.length > 0) {
            await Promise.all(pendingOps);
        }

        return {
            sandboxInstanceId,
            previewURL,
            tunnelURL,
            redeployed
        };
    }

    /**
     * Ensure sandbox instance exists and is healthy
     */
    async ensureInstance(redeploy: boolean): Promise<DeploymentResult> {
        if (redeploy) {
            this.resetSessionId();
        }
        const state = this.getState();
        const { sandboxInstanceId } = state;
        const logger = this.getLog();
        const client = this.getClient();

        // Check existing instance
        if (sandboxInstanceId) {
            const status = await client.getInstanceStatus(sandboxInstanceId);
            if (status.success && status.isHealthy) {
                logger.info(`DEPLOYMENT CHECK PASSED: Instance ${sandboxInstanceId} is running`);
                return {
                    sandboxInstanceId,
                    previewURL: status.previewURL,
                    tunnelURL: status.tunnelURL,
                    redeployed: false
                };
            }
            logger.error(`DEPLOYMENT CHECK FAILED: Failed to get status for instance ${sandboxInstanceId}, redeploying...`);
        }

        const results = await this.createNewInstance();
        if (!results || !results.runId || !results.previewURL) {
            throw new Error('Failed to create new deployment');
        }

        // Update state with new instance ID
        this.setState({
            ...this.getState(),
            sandboxInstanceId: results.runId,
        });

        return {
            sandboxInstanceId: results.runId,
            previewURL: results.previewURL,
            tunnelURL: results.tunnelURL,
            redeployed: true
        };
    }


    /**
     * Create new sandbox instance
     */
    private async createNewInstance(): Promise<BootstrapResponse | null> {
        const state = this.getState();
        const projectName = state.projectName;

        // Add AI proxy vars if AI template
        let localEnvVars: Record<string, string> = {};
        if (state.templateName?.includes('agents')) {
            const secret = this.env.AI_PROXY_JWT_SECRET;
            if (typeof secret === 'string' && secret.trim().length > 0) {
                localEnvVars = {
                    "CF_AI_BASE_URL": generateAppProxyUrl(this.env),
                    "CF_AI_API_KEY": await generateAppProxyToken(
                        state.metadata.agentId,
                        state.metadata.userId,
                        this.env
                    )
                };
            }
        }

        // Merge user-defined env vars from state
        if (state.envVars) {
            localEnvVars = { ...localEnvVars, ...state.envVars };
        }

        // Get latest files
        const files = this.fileManager.getAllFiles();

        this.getLog().info('Files to deploy', {
            files: files.map(f => f.filePath)
        });

        // Create instance
        const client = this.getClient();
        const logger = this.getLog();

        const createResponse = await client.createInstance({
            files,
            projectName,
            initCommand: 'bun run dev',
            envVars: localEnvVars
        });

        if (!createResponse || !createResponse.success || !createResponse.runId) {
            throw new Error(`Failed to create sandbox instance: ${createResponse?.error || 'Unknown error'}`);
        }

        logger.info(`Created sandbox instance`, {
            runId: createResponse.runId,
            previewURL: createResponse.previewURL
        });

        if (createResponse.runId && createResponse.previewURL) {
            return createResponse;
        }

        throw new Error(`Failed to create sandbox instance: ${createResponse?.error || 'Unknown error'}`);
    }

    /**
     * Determine which files to deploy
     */
    private getFilesToDeploy(
        requestedFiles: FileOutputType[],
        redeployed: boolean
    ): Array<{ filePath: string; fileContents: string }> {
        const state = this.getState();

        // If no files requested or redeploying, use all generated files from state
        if (!requestedFiles || requestedFiles.length === 0 || redeployed) {
            requestedFiles = Object.values(state.generatedFilesMap);
        }

        return requestedFiles.map(file => ({
            filePath: file.filePath,
            fileContents: file.fileContents
        }));
    }

    /**
     * Deploy to Cloudflare Workers
     * Returns deployment URL and deployment ID for database updates
     */
    async deployToCloudflare(request?: {
        target?: DeploymentTarget;
        callbacks?: CloudflareDeploymentCallbacks;
    }): Promise<{ deploymentUrl: string | null; deploymentId?: string }> {
        const state = this.getState();
        const logger = this.getLog();
        const client = this.getClient();
        const target = request?.target ?? 'platform';
        const callbacks = request?.callbacks;

        await this.waitForPreview();

        callbacks?.onStarted?.({
            message: 'Starting deployment to Cloudflare Workers...',
            instanceId: state.sandboxInstanceId ?? ''
        });

        logger.info('Starting Cloudflare deployment', { target });

        // Check if we have generated files
        if (!state.generatedFilesMap || Object.keys(state.generatedFilesMap).length === 0) {
            logger.error('No generated files available for deployment');
            callbacks?.onError?.({
                message: 'Deployment failed: No generated code available',
                instanceId: state.sandboxInstanceId ?? '',
                error: 'No files have been generated yet'
            });
            return { deploymentUrl: null };
        }

        // Ensure sandbox instance exists - return null to trigger agent orchestration
        if (!state.sandboxInstanceId) {
            logger.info('No sandbox instance ID available');
            return { deploymentUrl: null };
        }

        logger.info('Prerequisites met, initiating deployment', {
            sandboxInstanceId: state.sandboxInstanceId,
            fileCount: Object.keys(state.generatedFilesMap).length
        });

        // Deploy to Cloudflare
        const deploymentResult = await client.deployToCloudflareWorkers(
            state.sandboxInstanceId,
            target
        );

        logger.info('Deployment result:', deploymentResult);

        if (!deploymentResult || !deploymentResult.success) {
            logger.error('Deployment failed', {
                message: deploymentResult?.message,
                error: deploymentResult?.error
            });

            // Check for preview expired error
            if (deploymentResult?.error?.includes('Failed to read instance metadata') ||
                deploymentResult?.error?.includes(`/bin/sh: 1: cd: can't cd to i-`)) {
                logger.error('Deployment sandbox died - preview expired');
                this.deployToSandbox();
            } else {
                callbacks?.onError?.({
                    message: `Deployment failed: ${deploymentResult?.message || 'Unknown error'}`,
                    instanceId: state.sandboxInstanceId ?? '',
                    error: deploymentResult?.error || 'Unknown deployment error'
                });
            }

            return { deploymentUrl: null };
        }

        const deploymentUrl = deploymentResult.deployedUrl;
        const deploymentId = deploymentResult.deploymentId;

        logger.info('Cloudflare deployment completed successfully', {
            deploymentUrl,
            deploymentId,
            message: deploymentResult.message
        });

        callbacks?.onCompleted?.({
            message: deploymentResult.message || 'Successfully deployed to Cloudflare Workers!',
            instanceId: state.sandboxInstanceId ?? '',
            deploymentUrl: deploymentUrl || ''
        });

        return {
            deploymentUrl: deploymentUrl || null,
            deploymentId: deploymentId
        };
    }

}
