import { WaveAIModel } from "./waveai-model";

export async function loadInitialChatForPanel(
    model: Pick<WaveAIModel, "uiLoadInitialChat" | "setError">,
    onReady: () => void
): Promise<void> {
    try {
        await model.uiLoadInitialChat();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to load initial AI chat:", error);
        model.setError(message || "Failed to load initial AI chat");
    } finally {
        onReady();
    }
}
