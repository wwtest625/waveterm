import { t } from "./aipanel-i18n";
import { WaveAIModel } from "./waveai-model";
import { memo, useEffect } from "react";
import { useAtomValue } from "jotai";

export const AIBlockMask = memo(() => {
    return (
        <div
            key="block-mask"
            className="absolute top-0 left-0 right-0 bottom-0 border-1 border-transparent pointer-events-auto select-none p-0.5"
            style={{
                borderRadius: "var(--block-border-radius)",
                zIndex: "var(--zindex-block-mask-inner)",
            }}
        >
            <div
                className="w-full mt-[44px] h-[calc(100%-44px)] flex items-center justify-center"
                style={{
                    backgroundColor: "rgb(from var(--block-bg-color) r g b / 50%)",
                }}
            >
                <div className="font-bold opacity-70 mt-[-25%] text-[60px]">0</div>
            </div>
        </div>
    );
});

AIBlockMask.displayName = "AIBlockMask";

export const AIDragOverlay = memo(() => {
    return (
        <div
            key="drag-overlay"
            className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10 p-4"
        >
            <div className="text-accent text-center">
                <i className="fa fa-upload text-3xl mb-2"></i>
                <div className="text-lg font-semibold">{t.dragDrop.dropFilesHere}</div>
                <div className="text-sm">{t.dragDrop.supportedTypes}</div>
            </div>
        </div>
    );
});

AIDragOverlay.displayName = "AIDragOverlay";

export const AIWelcomeMessage = memo(() => {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <p className="text-sm font-medium text-zinc-200">{t.aipanel.welcome}</p>
        </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

export const AIErrorMessage = memo(() => {
    const model = WaveAIModel.getInstance();
    const errorMessage = useAtomValue(model.errorMessage);

    if (!errorMessage) {
        return null;
    }

    return (
        <div className="mx-3 mb-2 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-3 py-2 relative">
            <button
                onClick={() => model.clearError()}
                className="absolute top-2 right-2 text-red-400/60 hover:text-red-300 cursor-pointer z-10"
                aria-label={t.aipanel.close}
            >
                <i className="fa fa-times text-xs"></i>
            </button>
            <div className="text-xs pr-6 max-h-[80px] overflow-y-auto text-red-200/80">
                {errorMessage}
                <button
                    onClick={() => model.clearChat()}
                    className="ml-2 text-[10px] text-red-300/50 hover:text-red-200 cursor-pointer underline"
                >
                    New Chat
                </button>
            </div>
        </div>
    );
});

AIErrorMessage.displayName = "AIErrorMessage";

export const ConfigChangeModeFixer = memo(() => {
    const model = WaveAIModel.getInstance();
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);

    useEffect(() => {
        model.fixModeAfterConfigChange();
    }, [aiModeConfigs, model]);

    return null;
});

ConfigChangeModeFixer.displayName = "ConfigChangeModeFixer";
