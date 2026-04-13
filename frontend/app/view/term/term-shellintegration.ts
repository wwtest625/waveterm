import type { ShellIntegrationStatus } from "./osc-handlers";

type ShellIntegrationRuntimeState = {
    integrationKnown: boolean;
    integrationStatus: ShellIntegrationStatus | null;
};

function resolveShellIntegrationRuntimeState(rtInfo: Record<string, unknown> | null | undefined): ShellIntegrationRuntimeState {
    if (rtInfo == null) {
        return {
            // Runtime info request finished but payload is empty: treat as
            // known unavailable so quick-input send is never blocked forever.
            integrationKnown: true,
            integrationStatus: null,
        };
    }

    // Older runtimes may omit shell:integration entirely. Once runtime info exists,
    // treat that as "known unavailable" instead of waiting forever.
    const hasIntegrationField = Object.prototype.hasOwnProperty.call(rtInfo, "shell:integration");
    if (!hasIntegrationField) {
        return {
            integrationKnown: true,
            integrationStatus: null,
        };
    }

    const integrationEnabled = Boolean(rtInfo["shell:integration"]);
    return {
        integrationKnown: true,
        integrationStatus: integrationEnabled ? ((rtInfo["shell:state"] as ShellIntegrationStatus) || null) : null,
    };
}

export { resolveShellIntegrationRuntimeState };
