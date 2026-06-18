// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export interface SystemFont {
    family: string;
    postscriptName: string;
    style: string;
}

let cachedMonospaceFonts: SystemFont[] | null = null;
let fontLoadPromise: Promise<SystemFont[]> | null = null;

/**
 * 用 canvas 测量法检测字体是否等宽
 * 原理：渲染不同宽度的字符，检测每个字符的像素宽度是否一致
 */
function isMonospaceFont(family: string): boolean {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const fontSize = 72;
    ctx.font = `${fontSize}px "${family}", monospace`;

    // 测量不同宽度的字符
    const testChars = "MMMMMMMMMMiiiiiiiiii";
    const widths: number[] = [];
    for (let i = 0; i < testChars.length; i++) {
        widths.push(ctx.measureText(testChars[i]).width);
    }

    // 等宽字体所有字符宽度应该一致
    const firstWidth = widths[0];
    if (firstWidth <= 0) return false;
    return widths.every((w) => Math.abs(w - firstWidth) < 0.5);
}

/**
 * 获取系统等宽字体列表（懒加载 + 缓存）
 * 使用 queryLocalFonts() API 枚举系统字体，canvas 测量法过滤等宽字体
 */
async function getSystemMonospaceFonts(): Promise<SystemFont[]> {
    if (cachedMonospaceFonts) {
        return cachedMonospaceFonts;
    }
    if (fontLoadPromise) {
        return fontLoadPromise;
    }

    fontLoadPromise = (async () => {
        try {
            if (typeof window === "undefined" || !("queryLocalFonts" in window)) {
                cachedMonospaceFonts = [];
                return cachedMonospaceFonts;
            }

            const allFonts = await (window as any).queryLocalFonts();

            // 按 family 去重
            const seenFamilies = new Set<string>();
            const uniqueFonts: SystemFont[] = [];

            for (const font of allFonts) {
                const family: string = font.family;
                if (seenFamilies.has(family)) continue;
                seenFamilies.add(family);
                uniqueFonts.push({
                    family,
                    postscriptName: font.postscriptName,
                    style: font.style,
                });
            }

            // canvas 测量法过滤等宽字体
            const monospaceFonts = uniqueFonts.filter((f) => isMonospaceFont(f.family));

            // 按字母排序
            monospaceFonts.sort((a, b) => a.family.localeCompare(b.family));

            cachedMonospaceFonts = monospaceFonts;
            return cachedMonospaceFonts;
        } catch (err) {
            // 用户拒绝授权或其他错误，回退空列表
            console.warn("获取系统字体列表失败:", err);
            cachedMonospaceFonts = [];
            return cachedMonospaceFonts;
        }
    })();

    return fontLoadPromise;
}

/**
 * 检测指定字体是否在系统字体列表中可用
 */
async function isFontAvailable(fontFamily: string): Promise<boolean> {
    const fonts = await getSystemMonospaceFonts();
    return fonts.some((f) => f.family === fontFamily);
}

let isJetBrainsMonoLoaded = false;
let isHackFontLoaded = false;
let isHackNerdFontLoaded = false;
let isInterFontLoaded = false;

function addToFontFaceSet(fontFaceSet: FontFaceSet, fontFace: FontFace) {
    // any cast to work around typing issue
    (fontFaceSet as any).add(fontFace);
}

function loadJetBrainsMonoFont() {
    if (isJetBrainsMonoLoaded) {
        return;
    }
    isJetBrainsMonoLoaded = true;
    const jbmFontNormal = new FontFace("JetBrains Mono", "url('fonts/jetbrains-mono-v13-latin-regular.woff2')", {
        style: "normal",
        weight: "400",
    });
    const jbmFont200 = new FontFace("JetBrains Mono", "url('fonts/jetbrains-mono-v13-latin-200.woff2')", {
        style: "normal",
        weight: "200",
    });
    const jbmFont700 = new FontFace("JetBrains Mono", "url('fonts/jetbrains-mono-v13-latin-700.woff2')", {
        style: "normal",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, jbmFontNormal);
    addToFontFaceSet(document.fonts, jbmFont200);
    addToFontFaceSet(document.fonts, jbmFont700);
    jbmFontNormal.load();
    jbmFont200.load();
    jbmFont700.load();
}

function loadHackNerdFont() {
    if (isHackNerdFontLoaded) {
        return;
    }
    isHackFontLoaded = true;
    const hackRegular = new FontFace("Hack", "url('fonts/hacknerdmono-regular.ttf')", {
        style: "normal",
        weight: "400",
    });
    const hackBold = new FontFace("Hack", "url('fonts/hacknerdmono-bold.ttf')", {
        style: "normal",
        weight: "700",
    });
    const hackItalic = new FontFace("Hack", "url('fonts/hacknerdmono-italic.ttf')", {
        style: "italic",
        weight: "400",
    });
    const hackBoldItalic = new FontFace("Hack", "url('fonts/hacknerdmono-bolditalic.ttf')", {
        style: "italic",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, hackRegular);
    addToFontFaceSet(document.fonts, hackBold);
    addToFontFaceSet(document.fonts, hackItalic);
    addToFontFaceSet(document.fonts, hackBoldItalic);
    hackRegular.load();
    hackBold.load();
    hackItalic.load();
    hackBoldItalic.load();
}

function loadInterFont() {
    if (isInterFontLoaded) {
        return;
    }
    isInterFontLoaded = true;
    const interFont = new FontFace("Inter", "url('fonts/inter-variable.woff2')", {
        style: "normal",
        weight: "100 900",
    });
    addToFontFaceSet(document.fonts, interFont);
    interFont.load();
}

function loadFonts() {
    loadInterFont();
    loadJetBrainsMonoFont();
    loadHackNerdFont();
}

export { loadFonts, getSystemMonospaceFonts, isFontAvailable };
