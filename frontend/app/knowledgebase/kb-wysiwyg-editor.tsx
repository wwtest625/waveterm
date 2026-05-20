import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { indent } from "@milkdown/kit/plugin/indent";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { prism, prismConfig } from "@milkdown/plugin-prism";
import { nord } from "@milkdown/theme-nord";
import { kbReadFile, kbWriteFile } from "@/app/store/kb-api";
import type { KbFileContent } from "@/app/store/kb-model";
import { debounce } from "throttle-debounce";
import { useCallback, useEffect, useRef, useState } from "react";
import "@milkdown/theme-nord/style.css";
import "./kb-wysiwyg-editor.scss";

interface KbWysiwygEditorProps {
    relPath: string;
}

function KbWysiwygEditorInner({ relPath }: KbWysiwygEditorProps) {
    const [content, setContent] = useState("");
    const [savedContent, setSavedContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const saveTimerRef = useRef<((...args: any[]) => any) & { cancel: () => void } | null>(null);
    const relPathRef = useRef(relPath);
    const contentRef = useRef(content);

    contentRef.current = content;

    useEffect(() => {
        relPathRef.current = relPath;
    }, [relPath]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        kbReadFile(relPath)
            .then((result: KbFileContent) => {
                if (cancelled) return;
                setContent(result.content);
                setSavedContent(result.content);
                setLoading(false);
            })
            .catch((err: Error) => {
                if (cancelled) return;
                setError(err.message || "Failed to load file");
                setLoading(false);
            });

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
                console.error("[kb-wysiwyg] auto-save failed:", err);
            });
            setSavedContent(newContent);
        });

        return () => {
            if (saveTimerRef.current) {
                saveTimerRef.current.cancel();
            }
        };
    }, []);

    const handleMarkdownChange = useCallback((markdown: string) => {
        setContent(markdown);
        if (saveTimerRef.current) {
            saveTimerRef.current(markdown);
        }
    }, []);

    const { loading: editorLoading } = useEditor((root) => {
        const currentContent = contentRef.current;

        return Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, root);
                ctx.set(defaultValueCtx, currentContent);
                const listenerManager = ctx.get(listenerCtx);
                listenerManager.markdownUpdated((_ctx, markdown) => {
                    handleMarkdownChange(markdown);
                });
            })
            .config((ctx) => {
                ctx.set(editorViewOptionsCtx, {
                    handleDOMEvents: {
                        mousedown: (_view, event) => {
                            const target = event.target as HTMLElement;
                            const pre = target.closest("pre") as HTMLElement | null;
                            if (!pre) return false;

                            const rect = pre.getBoundingClientRect();
                            const inCopyZone = event.clientX > rect.right - 40 && event.clientY < rect.top + 26;
                            if (!inCopyZone) return false;

                            event.preventDefault();
                            pre.classList.add("kb-code-copied");
                            const text = pre.textContent || "";
                            navigator.clipboard.writeText(text).catch(() => {});
                            setTimeout(() => {
                                pre.classList.remove("kb-code-copied");
                            }, 1500);
                            return true;
                        },
                    },
                });
            })
            .config(nord)
            .config((ctx) => {
                ctx.set(prismConfig.key, {
                    configureRefractor: (r) => r,
                });
            })
            .use(commonmark)
            .use(gfm)
            .use(listener)
            .use(prism)
            .use(history)
            .use(clipboard)
            .use(cursor)
            .use(indent)
            .use(trailing);
    }, [relPath]);

    const [instanceLoading, getInstance] = useInstance();

    useEffect(() => {
        if (instanceLoading) return;
        const editor = getInstance();
        if (!editor) return;
        const rootEl = editor.ctx.get(rootCtx) as HTMLElement;
        if (rootEl) {
            rootEl.setAttribute("spellcheck", "false");
        }
        const prosemirrorEl = rootEl?.querySelector(".ProseMirror") as HTMLElement | null;
        if (prosemirrorEl) {
            prosemirrorEl.setAttribute("spellcheck", "false");
            prosemirrorEl.setAttribute("autocorrect", "off");
            prosemirrorEl.setAttribute("autocomplete", "off");
            prosemirrorEl.setAttribute("data-gramm", "false");
        }
    }, [instanceLoading, getInstance]);

    if (loading) {
        return (
            <div className="kb-wysiwyg kb-wysiwyg-loading">
                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                <span>Loading...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="kb-wysiwyg kb-wysiwyg-error">
                <i className="fa-sharp fa-solid fa-circle-exclamation" />
                <span>{error}</span>
            </div>
        );
    }

    return (
        <div className="kb-wysiwyg">
            <Milkdown />
        </div>
    );
}

export function KbWysiwygEditor({ relPath }: KbWysiwygEditorProps) {
    return (
        <MilkdownProvider>
            <KbWysiwygEditorInner relPath={relPath} />
        </MilkdownProvider>
    );
}
