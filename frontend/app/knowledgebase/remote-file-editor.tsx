import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, fireAndForget, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as MonacoTypes from "monaco-editor";
import "./remote-file-editor.scss";

interface RemoteFileEditorProps {
    filePath: string;
    connection: string;
}

const DEFAULT_EDITOR_OPTIONS: MonacoTypes.editor.IStandaloneCodeEditorOptions = {
    scrollBeyondLastLine: false,
    fontSize: 13,
    fontFamily: "Hack",
    smoothScrolling: true,
    scrollbar: {
        useShadows: false,
        verticalScrollbarSize: 5,
        horizontalScrollbarSize: 5,
    },
    minimap: { enabled: false },
    stickyScroll: { enabled: false },
    wordWrap: "on",
    copyWithSyntaxHighlighting: false,
};

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".xml": "xml",
    ".toml": "ini",
    ".ini": "ini",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".lua": "lua",
    ".r": "r",
    ".dart": "dart",
};

function detectLanguage(filePath: string): string | undefined {
    const lastDot = filePath.lastIndexOf(".");
    if (lastDot === -1) return undefined;
    const ext = filePath.slice(lastDot).toLowerCase();
    const baseName = filePath.split("/").pop()?.toLowerCase() ?? "";
    if (baseName === "dockerfile") return "dockerfile";
    if (baseName === "makefile") return "makefile";
    return EXTENSION_LANGUAGE_MAP[ext];
}

const RemoteFileEditorInner = memo(({ filePath, connection }: RemoteFileEditorProps) => {
    const [content, setContent] = useState("");
    const [savedContent, setSavedContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [readonly, setReadonly] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const monacoRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);

    const remotePath = useMemo(() => formatRemoteUri(filePath, connection), [filePath, connection]);
    const language = useMemo(() => detectLanguage(filePath), [filePath]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        RpcApi.FileReadCommand(TabRpcClient, { info: { path: remotePath } }, null)
            .then((result) => {
                if (cancelled) return;
                const text = base64ToString(result.data64);
                setContent(text);
                setSavedContent(text);
                setDirty(false);
                setLoading(false);
            })
            .catch((err: Error) => {
                if (cancelled) return;
                setError(err.message || "Failed to load file");
                setLoading(false);
            });

        RpcApi.FileInfoCommand(TabRpcClient, { info: { path: remotePath } }, null)
            .then((info) => {
                if (cancelled) return;
                setReadonly(info?.readonly ?? false);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [remotePath]);

    const handleSave = useCallback(async () => {
        if (readonly || !dirty) return;
        setSaving(true);
        try {
            const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            await RpcApi.FileWriteCommand(
                TabRpcClient,
                {
                    info: { path: remotePath },
                    data64: stringToBase64(normalizedContent),
                },
                null
            );
            setSavedContent(normalizedContent);
            setDirty(false);
        } catch (err: any) {
            console.error("[remote-file-editor] save failed:", err);
        } finally {
            setSaving(false);
        }
    }, [content, dirty, readonly, remotePath]);

    const handleChange = useCallback(
        (newContent: string) => {
            setContent(newContent);
            setDirty(newContent !== savedContent);
        },
        [savedContent]
    );

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                fireAndForget(handleSave);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [handleSave]);

    const editorOptions = useMemo(
        () => ({
            ...DEFAULT_EDITOR_OPTIONS,
            readOnly: readonly,
        }),
        [readonly]
    );

    if (loading) {
        return (
            <div className="remote-file-editor remote-file-editor-loading">
                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                <span>Loading...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="remote-file-editor remote-file-editor-error">
                <i className="fa-sharp fa-solid fa-circle-exclamation" />
                <span>{error}</span>
            </div>
        );
    }

    return (
        <div className="remote-file-editor">
            {dirty && (
                <div className="remote-file-editor-status">
                    <span className="remote-file-editor-dirty">Modified</span>
                    {saving && <span className="remote-file-editor-saving">Saving...</span>}
                    <button className="remote-file-editor-save-btn" onClick={() => fireAndForget(handleSave)} title="Save (Ctrl+S)">
                        <i className="fa-sharp fa-solid fa-floppy-disk" />
                    </button>
                </div>
            )}
            <div className="remote-file-editor-content">
                <MonacoCodeEditor
                    text={content}
                    readonly={readonly}
                    language={language}
                    onChange={handleChange}
                    path={remotePath}
                    options={editorOptions}
                />
            </div>
        </div>
    );
});

RemoteFileEditorInner.displayName = "RemoteFileEditorInner";

function RemoteFileEditor(props: RemoteFileEditorProps) {
    return <RemoteFileEditorInner {...props} />;
}

RemoteFileEditor.displayName = "RemoteFileEditor";

export { RemoteFileEditor };
