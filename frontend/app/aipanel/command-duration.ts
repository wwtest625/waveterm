export function formatCommandDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
        return "0ms";
    }
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}
