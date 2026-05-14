// Copyright 2025, Command Plane Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { kbReadFile, kbWriteFile } from "@/app/store/kb-api";
import type { KbFileContent } from "@/app/store/kb-model";
import type * as MonacoTypes from "monaco-editor";
import { debounce } from "throttle-debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./kb-editor.scss";

interface KbEditorProps {
    relPath: string;
    mode?: "editor" | "preview";
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    ".md": "markdown",
    ".markdown": "markdown",
    ".mdx": "markdown",
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
    ".less": "less",
    ".html": "html",
    ".xml": "xml",
    ".toml": "ini",
    ".ini": "ini",
    ".cfg": "ini",
    ".conf": "ini",
    ".dockerfile": "dockerfile",
    ".makefile": "makefile",
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

function getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1) return "";
    return filename.slice(lastDot).toLowerCase();
}

function isImageFile(relPath: string): boolean {
    return IMAGE_EXTENSIONS.has(getFileExtension(relPath));
}

function isMarkdownFile(relPath: string): boolean {
    return MARKDOWN_EXTENSIONS.has(getFileExtension(relPath));
}

function detectLanguage(relPath: string): string | undefined {
    const ext = getFileExtension(relPath);
    const baseName = relPath.split("/").pop()?.toLowerCase() ?? "";
    if (baseName === "dockerfile") return "dockerfile";
    if (baseName === "makefile") return "makefile";
    return EXTENSION_LANGUAGE_MAP[ext];
}

function getMimeTypeForImage(relPath: string): string {
    const ext = getFileExtension(relPath);
    const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
    };
    return mimeMap[ext] ?? "image/png";
}

function resolveKbImagePath(currentRelPath: string, imgSrc: string): string {
    if (!imgSrc || imgSrc.startsWith("http://") || imgSrc.startsWith("https://") || imgSrc.startsWith("data:")) {
        return imgSrc;
    }
    const dir = currentRelPath.includes("/") ? currentRelPath.substring(0, currentRelPath.lastIndexOf("/")) : "";
    const resolved = dir ? `${dir}/${imgSrc}` : imgSrc;
    return resolved.replace(/\/+/g, "/");
}

const DEFAULT_EDITOR_OPTIONS: MonacoTypes.editor.IEditorOptions = {
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

const kbImgCache = new Map<string, string>();

interface KbMarkdownImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    relPath: string;
}

function KbMarkdownImg({ src, alt, relPath, ...rest }: KbMarkdownImgProps) {
    const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

    useEffect(() => {
        if (!src || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
            setResolvedSrc(src ?? null);
            return;
        }
        const resolved = resolveKbImagePath(relPath, src);
        if (kbImgCache.has(resolved)) {
            setResolvedSrc(kbImgCache.get(resolved)!);
            return;
        }
        let cancelled = false;
        kbReadFile(resolved)
            .then((result: KbFileContent) => {
                if (cancelled) return;
                if (result.isImage && result.content) {
                    const mime = getMimeTypeForImage(resolved);
                    const dataUrl = `data:${mime};base64,${result.content}`;
                    kbImgCache.set(resolved, dataUrl);
                    setResolvedSrc(dataUrl);
                } else {
                    setResolvedSrc(src);
                }
            })
            .catch(() => {
                if (!cancelled) setResolvedSrc(src);
            });
        return () => {
            cancelled = true;
        };
    }, [src, relPath]);

    if (!resolvedSrc) {
        return <span className="text-secondary text-sm">[loading image...]</span>;
    }
    return <img src={resolvedSrc} alt={alt} {...rest} className="max-w-full rounded" />;
}

function KbMarkdownPreview({ content, relPath }: { content: string; relPath: string }) {
    const components = useMemo(
        () => ({
            img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
                <KbMarkdownImg {...props} relPath={relPath} />
            ),
        }),
        [relPath]
    );

    return (
        <div className="kb-markdown-preview">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={components as any}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

function KbImagePreview({ imageDataUrl }: { imageDataUrl: string }) {
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const panStartRef = useRef({ x: 0, y: 0 });

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        setScale((prev) => {
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            return Math.min(Math.max(prev + delta, 0.1), 10);
        });
    }, []);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (scale <= 1) return;
        e.preventDefault();
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        panStartRef.current = { ...pan };
    }, [scale, pan]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        setPan({ x: panStartRef.current.x + dx, y: panStartRef.current.y + dy });
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const zoomIn = useCallback(() => setScale((prev) => Math.min(prev + 0.25, 10)), []);
    const zoomOut = useCallback(() => setScale((prev) => Math.max(prev - 0.25, 0.1)), []);
    const resetZoom = useCallback(() => {
        setScale(1);
        setPan({ x: 0, y: 0 });
    }, []);

    return (
        <div
            className="kb-image-container"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <div className="kb-image-viewport">
                <img
                    src={imageDataUrl}
                    alt="preview"
                    className="kb-image"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                        transformOrigin: "center center",
                        cursor: isDragging ? "grabbing" : scale > 1 ? "grab" : "default",
                    }}
                    draggable={false}
                />
            </div>
            <div className="kb-image-controls">
                <button onClick={zoomOut} title="Zoom Out">
                    <i className="fa-sharp fa-solid fa-minus" />
                </button>
                <span className="kb-image-zoom-label">{Math.round(scale * 100)}%</span>
                <button onClick={zoomIn} title="Zoom In">
                    <i className="fa-sharp fa-solid fa-plus" />
                </button>
                <button onClick={resetZoom} title="Reset Zoom">
                    <i className="fa-sharp fa-solid fa-expand" />
                </button>
            </div>
        </div>
    );
}

export function KbEditor({ relPath, mode: initialMode }: KbEditorProps) {
    const [content, setContent] = useState("");
    const [savedContent, setSavedContent] = useState("");
    const [isMarkdown, setIsMarkdown] = useState(false);
    const [isImage, setIsImage] = useState(false);
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [language, setLanguage] = useState<string | undefined>(undefined);
    const [activeMode, setActiveMode] = useState<"editor" | "preview">(initialMode ?? "editor");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const saveTimerRef = useRef<((...args: any[]) => any) & { cancel: () => void } | null>(null);
    const relPathRef = useRef(relPath);

    const hasUnsavedChanges = content !== savedContent;

    useEffect(() => {
        setIsMarkdown(isMarkdownFile(relPath));
        setIsImage(isImageFile(relPath));
        setLanguage(detectLanguage(relPath));
    }, [relPath]);

    useEffect(() => {
        if (isMarkdown && initialMode === undefined) {
            setActiveMode("preview");
        }
    }, [isMarkdown, initialMode]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        kbReadFile(relPath)
            .then((result: KbFileContent) => {
                if (cancelled) return;
                if (result.isImage) {
                    const mime = getMimeTypeForImage(relPath);
                    setImageDataUrl(`data:${mime};base64,${result.content}`);
                    setContent("");
                    setSavedContent("");
                } else {
                    setContent(result.content);
                    setSavedContent(result.content);
                    setImageDataUrl(null);
                }
                setLoading(false);
            })
            .catch((err: Error) => {
                if (cancelled) return;
                setError(err.message || "Failed to load file");
                setLoading(false);
            });

        relPathRef.current = relPath;
        return () => {
            cancelled = true;
        };
    }, [relPath]);

    useEffect(() => {
        if (saveTimerRef.current) {
            saveTimerRef.current.cancel();
        }
        saveTimerRef.current = debounce(1200, (newContent: string) => {
            const currentRelPath = relPathRef.current;
            kbWriteFile(currentRelPath, newContent).catch((err: Error) => {
                console.error("[kb-editor] auto-save failed:", err);
            });
            setSavedContent(newContent);
        });

        return () => {
            if (saveTimerRef.current) {
                saveTimerRef.current.cancel();
            }
        };
    }, []);

    const handleEditorChange = useCallback((newContent: string) => {
        setContent(newContent);
        if (saveTimerRef.current) {
            saveTimerRef.current(newContent);
        }
    }, []);

    const toggleMode = useCallback(() => {
        setActiveMode((prev) => (prev === "editor" ? "preview" : "editor"));
    }, []);

    const editorOptions = useMemo(() => DEFAULT_EDITOR_OPTIONS, []);

    if (loading) {
        return (
            <div className="kb-editor kb-editor-loading">
                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                <span>Loading...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="kb-editor kb-editor-error">
                <i className="fa-sharp fa-solid fa-circle-exclamation" />
                <span>{error}</span>
            </div>
        );
    }

    if (isImage && imageDataUrl) {
        return (
            <div className="kb-editor">
                <KbImagePreview imageDataUrl={imageDataUrl} />
            </div>
        );
    }

    return (
        <div className="kb-editor">
            {isMarkdown && (
                <div className="kb-editor-toolbar">
                    <button
                        className={`kb-mode-btn ${activeMode === "editor" ? "active" : ""}`}
                        onClick={toggleMode}
                        title={activeMode === "editor" ? "Switch to Preview" : "Switch to Editor"}
                    >
                        <i className={`fa-sharp fa-solid ${activeMode === "editor" ? "fa-eye" : "fa-pen"}`} />
                    </button>
                    {hasUnsavedChanges && (
                        <span className="kb-unsaved-indicator" title="Unsaved changes">
                            ●
                        </span>
                    )}
                </div>
            )}
            <div className="kb-editor-content">
                {activeMode === "preview" && isMarkdown ? (
                    <KbMarkdownPreview content={content} relPath={relPath} />
                ) : (
                    <MonacoCodeEditor
                        text={content}
                        readonly={false}
                        language={language}
                        onChange={handleEditorChange}
                        path={`kb://${relPath}`}
                        options={editorOptions}
                    />
                )}
            </div>
        </div>
    );
}
