// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { cn, useAtomValueSafe } from "@/util/util";
import { createBundledHighlighter, createSingletonShorthands } from "@shikijs/core";
import type { Atom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { Streamdown } from "streamdown";
import { throttle } from "throttle-debounce";

const ShikiTheme = "github-dark-high-contrast";

const shikiLanguageLoaders = {
    bash: () => import("@shikijs/langs/bash"),
    go: () => import("@shikijs/langs/go"),
    html: () => import("@shikijs/langs/html"),
    javascript: () => import("@shikijs/langs/javascript"),
    json: () => import("@shikijs/langs/json"),
    markdown: () => import("@shikijs/langs/markdown"),
    powershell: () => import("@shikijs/langs/powershell"),
    python: () => import("@shikijs/langs/python"),
    sh: () => import("@shikijs/langs/sh"),
    tsx: () => import("@shikijs/langs/tsx"),
    typescript: () => import("@shikijs/langs/typescript"),
    yaml: () => import("@shikijs/langs/yaml"),
} as const;

type ShikiLanguage = keyof typeof shikiLanguageLoaders;

const shikiLanguageAliases: Record<string, ShikiLanguage> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    md: "markdown",
    yml: "yaml",
};

const shiki = createSingletonShorthands(
    createBundledHighlighter({
        langs: shikiLanguageLoaders,
        themes: {
            "github-dark-high-contrast": () => import("@shikijs/themes/github-dark-high-contrast"),
        },
        engine: () => createJavaScriptRegexEngine({ forgiving: true }),
    })
);

function normalizeShikiLanguage(lang: string): ShikiLanguage | null {
    const normalized = shikiLanguageAliases[lang.toLowerCase()] ?? lang.toLowerCase();
    return normalized in shikiLanguageLoaders ? (normalized as ShikiLanguage) : null;
}

function extractText(node: React.ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractText).join("");
    // @ts-expect-error props exists on ReactElement
    if (typeof node === "object" && node.props) return extractText(node.props.children);
    return "";
}

function CodePlain({ className = "", isCodeBlock, text }: { className?: string; isCodeBlock: boolean; text: string }) {
    if (isCodeBlock) {
        return <code className={cn("font-mono text-[12px]", className)}>{text}</code>;
    }

    return (
        <code className={cn("text-secondary font-mono text-[12px] rounded-sm bg-zinc-800/80 px-1.5 py-0.5", className)}>
            {text}
        </code>
    );
}

function CodeHighlight({ className = "", lang, text }: { className?: string; lang: ShikiLanguage; text: string }) {
    const [html, setHtml] = useState<string>("");
    const [hasError, setHasError] = useState(false);
    const codeRef = useRef<HTMLElement>(null);
    const seqRef = useRef(0);

    const highlightCode = useCallback(
        async (textToHighlight: string, language: string, disposedRef: { current: boolean }, seq: number) => {
            try {
                const full = await shiki.codeToHtml(textToHighlight, { lang: language as ShikiLanguage, theme: ShikiTheme });
                const start = full.indexOf("<code");
                const open = full.indexOf(">", start);
                const end = full.lastIndexOf("</code>");
                const inner = start !== -1 && open !== -1 && end !== -1 ? full.slice(open + 1, end) : "";
                if (!disposedRef.current && seq === seqRef.current) {
                    setHtml(inner);
                    setHasError(false);
                }
            } catch (e) {
                if (!disposedRef.current && seq === seqRef.current) {
                    setHasError(true);
                }
                console.warn(`Shiki highlight failed for ${language}`, e);
            }
        },
        []
    );

    const throttledHighlight = useMemo(() => throttle(300, highlightCode, { noLeading: false }), [highlightCode]);

    useEffect(() => {
        const disposedRef = { current: false };

        if (!text) {
            setHtml("");
            return;
        }

        seqRef.current++;
        const currentSeq = seqRef.current;
        throttledHighlight(text, lang, disposedRef, currentSeq);

        return () => {
            disposedRef.current = true;
        };
    }, [text, lang, throttledHighlight]);

    if (hasError) {
        return (
            <code ref={codeRef} className={cn("font-mono text-[12px]", className)}>
                {text}
            </code>
        );
    }

    if (!html && text) {
        return (
            <code ref={codeRef} className={cn("font-mono text-[12px] text-transparent", className)}>
                {text}
            </code>
        );
    }

    return (
        <code
            ref={codeRef}
            className={cn("font-mono text-[12px]", className)}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

export function Code({ className = "", children }: { className?: string; children: React.ReactNode }) {
    const m = className?.match(/language-([\w+-]+)/i);
    const isCodeBlock = !!m;
    const lang = m?.[1] || "text";
    const text = extractText(children);

    const shikiLang = normalizeShikiLanguage(lang);

    if (isCodeBlock && shikiLang) {
        return <CodeHighlight className={className} lang={shikiLang} text={text} />;
    }

    return <CodePlain className={className} isCodeBlock={isCodeBlock} text={text} />;
}

type CodeBlockProps = {
    children: React.ReactNode;
    codeBlockMaxWidthAtom?: Atom<number>;
    hideCodeBlockLanguageLabel?: boolean;
};

const CodeBlock = ({ children, codeBlockMaxWidthAtom, hideCodeBlockLanguageLabel }: CodeBlockProps) => {
    const codeBlockMaxWidth = useAtomValueSafe(codeBlockMaxWidthAtom);
    const getLanguage = (children: any): string => {
        if (children?.props?.className) {
            const match = children.props.className.match(/language-([\w+-]+)/i);
            if (match) return match[1];
        }
        return "text";
    };

    const handleCopy = async (e: React.MouseEvent) => {
        const textToCopy = extractText(children).replace(/\n$/, "");
        await navigator.clipboard.writeText(textToCopy);
    };

    const language = getLanguage(children);

    return (
        <div
            className={cn("rounded-lg overflow-hidden bg-black my-4", codeBlockMaxWidth && "max-w-full")}
            style={
                codeBlockMaxWidth
                    ? { maxWidth: codeBlockMaxWidth, minWidth: Math.min(400, codeBlockMaxWidth) }
                    : undefined
            }
        >
            {hideCodeBlockLanguageLabel ? (
                <div className="relative">
                    <div className="absolute right-2 top-1.5 z-10 flex items-center gap-2">
                        <CopyButton onClick={handleCopy} title="Copy" />
                    </div>
                    <pre className="px-4 py-2 overflow-x-auto m-0 text-secondary max-w-full">{children}</pre>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between pl-3 pr-2 pt-2 pb-1.5">
                        <span className="text-[11px] text-white/50">{language}</span>
                        <div className="ml-auto flex items-center gap-2">
                            <CopyButton onClick={handleCopy} title="Copy" />
                        </div>
                    </div>
                    <pre className="px-4 pb-2 pt-0 overflow-x-auto m-0 text-secondary max-w-full">{children}</pre>
                </>
            )}
        </div>
    );
};

function Collapsible({ title, children, defaultOpen = false }) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="my-3">
            <button
                className="flex items-center gap-2 cursor-pointer bg-transparent border-0 p-0 font-medium text-secondary hover:text-primary"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="text-[0.65rem] text-primary transition-transform duration-200 inline-block w-3">
                    {isOpen ? "\u25BC" : "\u25B6"} {/* ▼ ▶ */}
                </span>
                <span>{title}</span>
            </button>
            {isOpen && <div className="mt-2 ml-1 pl-3.5 border-l-2 border-border text-secondary">{children}</div>}
        </div>
    );
}

interface WaveStreamdownProps {
    text: string;
    parseIncompleteMarkdown?: boolean;
    className?: string;
    codeBlockMaxWidthAtom?: Atom<number>;
    hideCodeBlockLanguageLabel?: boolean;
}

export const WaveStreamdown = ({
    text,
    parseIncompleteMarkdown,
    className,
    codeBlockMaxWidthAtom,
    hideCodeBlockLanguageLabel,
}: WaveStreamdownProps) => {
    const components = useMemo(
        () => ({
            code: Code,
            pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
                <CodeBlock
                    children={props.children}
                    codeBlockMaxWidthAtom={codeBlockMaxWidthAtom}
                    hideCodeBlockLanguageLabel={hideCodeBlockLanguageLabel}
                />
            ),
            p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props} className="text-secondary" />,
            h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <h1 {...props} className="text-2xl font-bold text-primary mt-6 mb-3" />
            ),
            h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <h2 {...props} className="text-xl font-bold text-primary mt-5 mb-2" />
            ),
            h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <h3 {...props} className="text-lg font-bold text-primary mt-4 mb-2" />
            ),
            h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <h4 {...props} className="text-base font-semibold text-primary mt-3 mb-1" />
            ),
            h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <h5 {...props} className="text-sm font-semibold text-primary mt-2 mb-1" />
            ),
            h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <h6 {...props} className="text-sm text-primary mt-2 mb-1" />
            ),
            table: (props: React.HTMLAttributes<HTMLTableElement>) => (
                <table {...props} className="w-full border-collapse my-4" />
            ),
            thead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
                <thead {...props} className="border-b border-border" />
            ),
            tbody: (props: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />,
            tr: (props: React.HTMLAttributes<HTMLTableRowElement>) => (
                <tr {...props} className="border-b border-border/50 last:border-0" />
            ),
            th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
                <th {...props} className="text-left font-semibold px-2 py-1.5 text-sm text-primary" />
            ),
            td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
                <td {...props} className="px-2 py-1.5 text-sm text-secondary" />
            ),
            ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
                <ul
                    {...props}
                    className="list-disc list-outside pl-6 mt-1 mb-2 text-secondary [&_ul]:my-1 [&_ol]:my-1"
                />
            ),
            ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
                <ol
                    {...props}
                    className="list-decimal list-outside pl-6 mt-1 mb-2 text-secondary [&_ul]:my-1 [&_ol]:my-1"
                />
            ),
            li: (props: React.HTMLAttributes<HTMLLIElement>) => (
                <li {...props} className="text-secondary leading-snug" />
            ),
            blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
                <blockquote {...props} className="border-l-2 border-border pl-4 my-2 text-secondary italic" />
            ),
            details: ({ children, ...props }) => {
                const childArray = Array.isArray(children) ? children : [children];

                // Extract summary text and content
                const summary = childArray.find((c) => c?.props?.node?.tagName === "summary");
                const summaryText = summary?.props?.children || "Details";
                const content = childArray.filter((c) => c?.props?.node?.tagName !== "summary");

                return (
                    <Collapsible title={summaryText} defaultOpen={props.open}>
                        {content}
                    </Collapsible>
                );
            },
            summary: () => null, // Don't render summary separately
            a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
                <a {...props} className="text-accent hover:underline" />
            ),
            strong: (props: React.HTMLAttributes<HTMLElement>) => (
                <strong {...props} className="font-semibold text-secondary" />
            ),
            em: (props: React.HTMLAttributes<HTMLElement>) => <em {...props} className="italic text-secondary" />,
        }),
        [codeBlockMaxWidthAtom, hideCodeBlockLanguageLabel]
    );

    return (
        <Streamdown
            parseIncompleteMarkdown={parseIncompleteMarkdown}
            className={cn(
                "wave-streamdown text-secondary [&>*:first-child]:mt-0 [&>*:first-child>*:first-child]:mt-0 space-y-2",
                className
            )}
            shikiTheme={[ShikiTheme, ShikiTheme]}
            controls={{
                code: false,
                table: false,
                mermaid: true,
            }}
            mermaidConfig={{
                theme: "dark",
                darkMode: true,
            }}
            defaultOrigin="http://localhost"
            components={components}
        >
            {text}
        </Streamdown>
    );
};
