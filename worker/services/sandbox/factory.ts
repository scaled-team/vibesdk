import { SandboxSdkClient } from "./sandboxSdkClient";
import { RemoteSandboxServiceClient } from "./remoteSandboxService";
import { BaseSandboxService } from "./BaseSandboxService";
import { env } from 'cloudflare:workers'

export function getSandboxService(sessionId: string, agentId: string): BaseSandboxService {
    if (env.SANDBOX_SERVICE_TYPE == 'runner') {
        return new RemoteSandboxServiceClient(sessionId);
    }
    return new SandboxSdkClient(sessionId, agentId);
}