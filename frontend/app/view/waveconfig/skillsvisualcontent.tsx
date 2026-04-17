import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";

interface ToggleSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

const ToggleSwitch = memo(({ checked, onChange, disabled }: ToggleSwitchProps) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-zinc-900",
                checked ? "bg-accent-600" : "bg-zinc-600",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            <span
                className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                    checked ? "translate-x-4" : "translate-x-0"
                )}
            />
        </button>
    );
});
ToggleSwitch.displayName = "ToggleSwitch";

interface ErrorDisplayProps {
    message: string;
    onDismiss?: () => void;
}

const ErrorDisplay = memo(({ message, onDismiss }: ErrorDisplayProps) => {
    return (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg">
            <i className="fa-sharp fa-solid fa-circle-exclamation" />
            <span className="flex-1 text-sm">{message}</span>
            {onDismiss && (
                <button onClick={onDismiss} className="hover:bg-red-500/20 rounded p-1 cursor-pointer transition-colors">
                    <i className="fa-sharp fa-solid fa-xmark text-sm" />
                </button>
            )}
        </div>
    );
});
ErrorDisplay.displayName = "ErrorDisplay";

interface SuccessDisplayProps {
    message: string;
    onDismiss?: () => void;
}

const SuccessDisplay = memo(({ message, onDismiss }: SuccessDisplayProps) => {
    return (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg">
            <i className="fa-sharp fa-solid fa-circle-check" />
            <span className="flex-1 text-sm">{message}</span>
            {onDismiss && (
                <button onClick={onDismiss} className="hover:bg-green-500/20 rounded p-1 cursor-pointer transition-colors">
                    <i className="fa-sharp fa-solid fa-xmark text-sm" />
                </button>
            )}
        </div>
    );
});
SuccessDisplay.displayName = "SuccessDisplay";

interface SkillCardProps {
    skill: SkillInfo;
    onToggle: (name: string, enabled: boolean) => void;
    onEdit: (skill: SkillInfo) => void;
    onDelete: (skill: SkillInfo) => void;
    onReadContent: (name: string) => void;
    isToggling: boolean;
}

const SkillCard = memo(({ skill, onToggle, onEdit, onDelete, onReadContent, isToggling }: SkillCardProps) => {
    return (
        <div
            className={cn(
                "rounded-xl border border-zinc-700/60 px-4 py-4 transition-colors",
                skill.enabled ? "bg-zinc-800/30" : "bg-zinc-900/50 opacity-70"
            )}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-lg">
                            <i className="fa-sharp fa-solid fa-wand-magic-sparkles text-accent-500" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-zinc-100">{skill.name}</span>
                                {skill.isbuiltin && (
                                    <span className="text-xs px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded shrink-0">
                                        Built-in
                                    </span>
                                )}
                                {skill.isuser && !skill.isbuiltin && (
                                    <span className="text-xs px-1.5 py-0.5 bg-accent-600/30 text-accent-400 rounded shrink-0">
                                        User
                                    </span>
                                )}
                            </div>
                            <div className="truncate text-xs text-zinc-500 mt-0.5">
                                {skill.description || "No description"}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <ToggleSwitch
                        checked={skill.enabled}
                        onChange={(enabled) => onToggle(skill.name, enabled)}
                        disabled={isToggling}
                    />
                </div>
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                    onClick={() => onReadContent(skill.name)}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                    <i className="fa-sharp fa-solid fa-eye mr-1" />
                    View
                </button>
                {skill.isuser && !skill.isbuiltin && (
                    <>
                        <button
                            onClick={() => onEdit(skill)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-accent-500 hover:text-accent-400"
                        >
                            <i className="fa-sharp fa-solid fa-pen mr-1" />
                            Edit
                        </button>
                        <button
                            onClick={() => onDelete(skill)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-red-500 hover:text-red-400"
                        >
                            <i className="fa-sharp fa-solid fa-trash mr-1" />
                            Delete
                        </button>
                    </>
                )}
            </div>
        </div>
    );
});
SkillCard.displayName = "SkillCard";

interface CreateSkillFormProps {
    onSubmit: (name: string, description: string, content: string) => void;
    onCancel: () => void;
    isSubmitting: boolean;
}

const CreateSkillForm = memo(({ onSubmit, onCancel, isSubmitting }: CreateSkillFormProps) => {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [content, setContent] = useState("");

    const handleSubmit = () => {
        if (!name.trim()) return;
        onSubmit(name.trim(), description.trim(), content);
    };

    return (
        <div className="flex flex-col gap-4 p-6 bg-zinc-800/50 rounded-lg border border-zinc-700/60">
            <h3 className="text-lg font-semibold text-zinc-200">Create New Skill</h3>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-300">Skill Name</label>
                <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-skill"
                    disabled={isSubmitting}
                />
                <span className="text-xs text-zinc-500">Lowercase letters, numbers, and hyphens</span>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-300">Description</label>
                <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A brief description of what this skill does"
                    disabled={isSubmitting}
                />
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-300">Content (Markdown)</label>
                <textarea
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500 font-mono resize-none"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={"## Overview\n\nDescribe the skill and how to use it...\n\n## Steps\n\n1. Step one\n2. Step two"}
                    disabled={isSubmitting}
                    rows={10}
                />
            </div>
            <div className="flex gap-2 justify-end">
                <button
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    Cancel
                </button>
                <button
                    className="px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    onClick={handleSubmit}
                    disabled={isSubmitting || !name.trim()}
                >
                    {isSubmitting ? (
                        <>
                            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            Creating...
                        </>
                    ) : (
                        "Create Skill"
                    )}
                </button>
            </div>
        </div>
    );
});
CreateSkillForm.displayName = "CreateSkillForm";

interface EditSkillFormProps {
    skill: SkillInfo;
    initialContent: string;
    onSubmit: (name: string, description: string, content: string) => void;
    onCancel: () => void;
    isSubmitting: boolean;
}

const EditSkillForm = memo(({ skill, initialContent, onSubmit, onCancel, isSubmitting }: EditSkillFormProps) => {
    const [description, setDescription] = useState(skill.description || "");
    const [content, setContent] = useState(initialContent);

    const handleSubmit = () => {
        onSubmit(skill.name, description.trim(), content);
    };

    return (
        <div className="flex flex-col gap-4 p-6 bg-zinc-800/50 rounded-lg border border-zinc-700/60">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-pen text-accent-500" />
                <h3 className="text-lg font-semibold text-zinc-200">Edit Skill: {skill.name}</h3>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-300">Description</label>
                <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A brief description of what this skill does"
                    disabled={isSubmitting}
                />
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-300">Content (Markdown)</label>
                <textarea
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500 font-mono resize-none"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={isSubmitting}
                    rows={12}
                />
            </div>
            <div className="flex gap-2 justify-end">
                <button
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    Cancel
                </button>
                <button
                    className="px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <>
                            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            Saving...
                        </>
                    ) : (
                        "Save Changes"
                    )}
                </button>
            </div>
        </div>
    );
});
EditSkillForm.displayName = "EditSkillForm";

interface SkillContentViewProps {
    skillName: string;
    content: SkillContent;
    onClose: () => void;
    onEdit?: () => void;
    canEdit: boolean;
}

const SkillContentView = memo(({ skillName, content, onClose, onEdit, canEdit }: SkillContentViewProps) => {
    return (
        <div className="flex flex-col gap-4 p-6 bg-zinc-800/50 rounded-lg border border-zinc-700/60">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <i className="fa-sharp fa-solid fa-wand-magic-sparkles text-accent-500" />
                    <h3 className="text-lg font-semibold text-zinc-200">{skillName}</h3>
                </div>
                <div className="flex items-center gap-2">
                    {canEdit && onEdit && (
                        <button
                            onClick={onEdit}
                            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-accent-500 hover:text-accent-400"
                        >
                            <i className="fa-sharp fa-solid fa-pen mr-1" />
                            Edit
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                        <i className="fa-sharp fa-solid fa-xmark mr-1" />
                        Close
                    </button>
                </div>
            </div>
            {content.description && (
                <div className="text-sm text-zinc-400">{content.description}</div>
            )}
            <div className="bg-black/20 rounded-lg p-4 overflow-auto max-h-96">
                <pre className="text-sm text-zinc-300 font-mono whitespace-pre-wrap break-words">{content.content}</pre>
            </div>
        </div>
    );
});
SkillContentView.displayName = "SkillContentView";

interface DeleteConfirmProps {
    skillName: string;
    onConfirm: () => void;
    onCancel: () => void;
    isDeleting: boolean;
}

const DeleteConfirm = memo(({ skillName, onConfirm, onCancel, isDeleting }: DeleteConfirmProps) => {
    return (
        <div className="flex flex-col gap-4 p-6 bg-zinc-800/50 rounded-lg border border-red-500/30">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-triangle-exclamation text-red-400" />
                <h3 className="text-lg font-semibold text-zinc-200">Delete Skill</h3>
            </div>
            <p className="text-sm text-zinc-400">
                Are you sure you want to delete the skill <span className="text-zinc-200 font-mono">{skillName}</span>?
                This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
                <button
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={onCancel}
                    disabled={isDeleting}
                >
                    Cancel
                </button>
                <button
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    onClick={onConfirm}
                    disabled={isDeleting}
                >
                    {isDeleting ? (
                        <>
                            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            Deleting...
                        </>
                    ) : (
                        <>
                            <i className="fa-sharp fa-solid fa-trash" />
                            Delete
                        </>
                    )}
                </button>
            </div>
        </div>
    );
});
DeleteConfirm.displayName = "DeleteConfirm";

interface EmptyStateProps {
    onCreateSkill: () => void;
    onOpenFolder: () => void;
}

const EmptyState = memo(({ onCreateSkill, onOpenFolder }: EmptyStateProps) => {
    return (
        <div className="flex flex-col items-center justify-center gap-4 py-12 bg-zinc-800/50 rounded-lg">
            <i className="fa-sharp fa-solid fa-wand-magic-sparkles text-4xl text-zinc-600" />
            <h3 className="text-lg font-semibold text-zinc-400">No Skills Installed</h3>
            <p className="text-zinc-500 text-center max-w-md">
                Skills are AI-powered modules that help the assistant perform specialized tasks.
                Create your own or import from a ZIP file.
            </p>
            <div className="flex gap-3">
                <button
                    className="flex items-center gap-2 px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded cursor-pointer transition-colors"
                    onClick={onCreateSkill}
                >
                    <i className="fa-sharp fa-solid fa-plus" />
                    <span className="font-medium text-sm">Create Skill</span>
                </button>
                <button
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer transition-colors"
                    onClick={onOpenFolder}
                >
                    <i className="fa-sharp fa-solid fa-folder-open" />
                    <span className="font-medium text-sm">Open Folder</span>
                </button>
            </div>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

type PanelView = "list" | "create" | "edit" | "view" | "delete";

interface SkillsVisualContentProps {
    model: WaveConfigViewModel;
}

export const SkillsVisualContent = memo(({ model }: SkillsVisualContentProps) => {
    const isLoading = useAtomValue(model.isLoadingAtom);
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [loadingSkills, setLoadingSkills] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [panelView, setPanelView] = useState<PanelView>("list");
    const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
    const [deletingSkill, setDeletingSkill] = useState<SkillInfo | null>(null);
    const [viewingSkill, setViewingSkill] = useState<SkillContent | null>(null);
    const [viewingSkillName, setViewingSkillName] = useState<string>("");
    const [editContent, setEditContent] = useState("");
    const [actionLoading, setActionLoading] = useState(false);
    const [togglingSkill, setTogglingSkill] = useState<string | null>(null);

    const loadSkills = useCallback(async () => {
        setLoadingSkills(true);
        setError(null);
        try {
            const result = await RpcApi.GetSkillsCommand(TabRpcClient);
            setSkills(result || []);
        } catch (err) {
            setError(`Failed to load skills: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setLoadingSkills(false);
        }
    }, []);

    useEffect(() => {
        loadSkills();
    }, [loadSkills]);

    const handleToggle = useCallback(async (name: string, enabled: boolean) => {
        setTogglingSkill(name);
        setError(null);
        try {
            await RpcApi.SetSkillEnabledCommand(TabRpcClient, { name, enabled });
            setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
            setSuccess(`Skill "${name}" ${enabled ? "enabled" : "disabled"}`);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(`Failed to toggle skill: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setTogglingSkill(null);
        }
    }, []);

    const handleCreate = useCallback(async (name: string, description: string, content: string) => {
        setActionLoading(true);
        setError(null);
        try {
            await RpcApi.CreateSkillCommand(TabRpcClient, { name, description, content });
            setSuccess(`Skill "${name}" created successfully`);
            setPanelView("list");
            await loadSkills();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(`Failed to create skill: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    }, [loadSkills]);

    const handleEdit = useCallback(async (skill: SkillInfo) => {
        setActionLoading(true);
        setError(null);
        try {
            const content = await RpcApi.ReadSkillContentCommand(TabRpcClient, { name: skill.name });
            setEditingSkill(skill);
            setEditContent(content.content || "");
            setPanelView("edit");
        } catch (err) {
            setError(`Failed to load skill content: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    }, []);

    const handleUpdate = useCallback(async (name: string, description: string, content: string) => {
        setActionLoading(true);
        setError(null);
        try {
            await RpcApi.UpdateSkillCommand(TabRpcClient, { name, description, content });
            setSuccess(`Skill "${name}" updated successfully`);
            setPanelView("list");
            setEditingSkill(null);
            await loadSkills();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(`Failed to update skill: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    }, [loadSkills]);

    const handleDelete = useCallback(async () => {
        if (!deletingSkill) return;
        setActionLoading(true);
        setError(null);
        try {
            await RpcApi.DeleteSkillCommand(TabRpcClient, { name: deletingSkill.name });
            setSuccess(`Skill "${deletingSkill.name}" deleted successfully`);
            setPanelView("list");
            setDeletingSkill(null);
            await loadSkills();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(`Failed to delete skill: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    }, [deletingSkill, loadSkills]);

    const handleViewContent = useCallback(async (name: string) => {
        setActionLoading(true);
        setError(null);
        try {
            const content = await RpcApi.ReadSkillContentCommand(TabRpcClient, { name });
            setViewingSkill(content);
            setViewingSkillName(name);
            setPanelView("view");
        } catch (err) {
            setError(`Failed to load skill content: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setActionLoading(false);
        }
    }, []);

    const handleOpenFolder = useCallback(async () => {
        setError(null);
        try {
            await RpcApi.OpenSkillsFolderCommand(TabRpcClient);
        } catch (err) {
            setError(`Failed to open skills folder: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, []);

    const handleReload = useCallback(async () => {
        setError(null);
        try {
            await RpcApi.ReloadSkillsCommand(TabRpcClient);
            await loadSkills();
            setSuccess("Skills reloaded successfully");
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(`Failed to reload skills: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [loadSkills]);

    const handleImportZip = useCallback(async () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            setActionLoading(true);
            setError(null);
            try {
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                let binary = "";
                for (let i = 0; i < uint8Array.length; i++) {
                    binary += String.fromCharCode(uint8Array[i]);
                }
                const base64 = btoa(binary);
                const tempPath = await RpcApi.WriteTempFileCommand(TabRpcClient, {
                    filename: "skill-import.zip",
                    data64: base64,
                });
                const result = await RpcApi.ImportSkillZipCommand(TabRpcClient, {
                    zippath: tempPath,
                    overwrite: false,
                });
                if (result.success) {
                    setSuccess(`Skill "${result.skillname}" imported successfully`);
                    await loadSkills();
                } else {
                    setError(`Import failed: ${result.error || "Unknown error"}`);
                }
                setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
                setError(`Failed to import skill: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                setActionLoading(false);
            }
        };
        input.click();
    }, [loadSkills]);

    const enabledCount = skills.filter((s) => s.enabled).length;

    const renderPanelContent = () => {
        switch (panelView) {
            case "create":
                return (
                    <CreateSkillForm
                        onSubmit={handleCreate}
                        onCancel={() => setPanelView("list")}
                        isSubmitting={actionLoading}
                    />
                );
            case "edit":
                if (!editingSkill) return null;
                return (
                    <EditSkillForm
                        skill={editingSkill}
                        initialContent={editContent}
                        onSubmit={handleUpdate}
                        onCancel={() => {
                            setPanelView("list");
                            setEditingSkill(null);
                        }}
                        isSubmitting={actionLoading}
                    />
                );
            case "view":
                if (!viewingSkill) return null;
                return (
                    <SkillContentView
                        skillName={viewingSkillName}
                        content={viewingSkill}
                        onClose={() => {
                            setPanelView("list");
                            setViewingSkill(null);
                        }}
                        onEdit={
                            skills.find((s) => s.name === viewingSkillName)?.isuser &&
                            !skills.find((s) => s.name === viewingSkillName)?.isbuiltin
                                ? () => {
                                    const skillInfo = skills.find((s) => s.name === viewingSkillName);
                                    if (skillInfo) {
                                        setEditContent(viewingSkill.content || "");
                                        setEditingSkill(skillInfo);
                                        setPanelView("edit");
                                    }
                                }
                                : undefined
                        }
                        canEdit={skills.find((s) => s.name === viewingSkillName)?.isuser === true &&
                            skills.find((s) => s.name === viewingSkillName)?.isbuiltin !== true}
                    />
                );
            case "delete":
                if (!deletingSkill) return null;
                return (
                    <DeleteConfirm
                        skillName={deletingSkill.name}
                        onConfirm={handleDelete}
                        onCancel={() => {
                            setPanelView("list");
                            setDeletingSkill(null);
                        }}
                        isDeleting={actionLoading}
                    />
                );
            default:
                if (skills.length === 0) {
                    return <EmptyState onCreateSkill={() => setPanelView("create")} onOpenFolder={handleOpenFolder} />;
                }
                return (
                    <div className="space-y-3">
                        {skills.map((skill) => (
                            <SkillCard
                                key={skill.name}
                                skill={skill}
                                onToggle={handleToggle}
                                onEdit={handleEdit}
                                onDelete={(s) => {
                                    setDeletingSkill(s);
                                    setPanelView("delete");
                                }}
                                onReadContent={handleViewContent}
                                isToggling={togglingSkill === skill.name}
                            />
                        ))}
                    </div>
                );
        }
    };

    if (loadingSkills && skills.length === 0) {
        return (
            <div className="h-full overflow-y-auto bg-zinc-900 p-6">
                <div className="flex flex-col items-center justify-center gap-3 py-12">
                    <i className="fa-sharp fa-solid fa-spinner fa-spin text-2xl text-zinc-400" />
                    <span className="text-zinc-400">Loading skills...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-zinc-900 p-6">
            <div className="mx-auto max-w-4xl space-y-4">
                <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                        <h2 className="text-lg font-semibold text-zinc-200">AI Skills</h2>
                        <p className="mt-1 text-sm text-zinc-500">
                            Manage AI skill modules that enhance the assistant's capabilities.
                            {skills.length > 0 && (
                                <span className="text-zinc-400"> {enabledCount} of {skills.length} enabled</span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={handleOpenFolder}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors cursor-pointer"
                            title="Open skills folder in file manager"
                        >
                            <i className="fa-sharp fa-solid fa-folder-open" />
                            <span className="@max-w500:hidden">Open Folder</span>
                        </button>
                        <button
                            onClick={handleReload}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors cursor-pointer"
                            title="Reload skills from disk"
                        >
                            <i className="fa-sharp fa-solid fa-arrows-rotate" />
                            <span className="@max-w500:hidden">Reload</span>
                        </button>
                        <button
                            onClick={handleImportZip}
                            disabled={actionLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Import skill from ZIP file"
                        >
                            <i className="fa-sharp fa-solid fa-file-import" />
                            <span className="@max-w500:hidden">Import ZIP</span>
                        </button>
                        <button
                            onClick={() => setPanelView("create")}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-600 hover:bg-accent-500 rounded text-xs font-medium text-white transition-colors cursor-pointer"
                        >
                            <i className="fa-sharp fa-solid fa-plus" />
                            <span className="@max-w500:hidden">Create</span>
                        </button>
                    </div>
                </div>

                {error && <ErrorDisplay message={error} onDismiss={() => setError(null)} />}
                {success && <SuccessDisplay message={success} onDismiss={() => setSuccess(null)} />}

                {renderPanelContent()}
            </div>
        </div>
    );
});

SkillsVisualContent.displayName = "SkillsVisualContent";
