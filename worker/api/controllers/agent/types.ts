import type { PreviewType } from "../../../services/sandbox/sandboxTypes";
import type { ImageAttachment } from '../../../types/image-attachment';
import type { BehaviorType, ProjectType } from '../../../agents/core/types';
import type { CredentialsPayload } from '../../../agents/inferutils/config.types';

export const MAX_AGENT_QUERY_LENGTH = 20_000;

export interface CodeGenArgs {
    query: string;
    /** Optional workspace context from Delegate (markdown-formatted) */
    context?: string;
    language?: string;
    frameworks?: string[];
    selectedTemplate?: string;
    behaviorType?: BehaviorType;
    projectType?: ProjectType;
    images?: ImageAttachment[];
    workspaceId?: string;
    projectId?: string;

    /** Optional ephemeral credentials (BYOK / gateway override) for sdk */
    credentials?: CredentialsPayload;
}

/**
 * Data structure for connectToExistingAgent response
 */
export interface AgentConnectionData {
    websocketUrl: string;
    agentId: string;
}

export type AgentPreviewResponse = PreviewType;
