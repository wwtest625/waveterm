import { atom } from "jotai"
import { globalStore } from "./jotaiStore"

export interface KbEntry {
    name: string
    relPath: string
    type: "file" | "dir"
    size?: number
    mtimeMs?: number
}

export interface KbFileContent {
    content: string
    mtimeMs: number
    isImage: boolean
    mimeType?: string
}

export interface KbSearchResult {
    name: string
    relPath: string
    size: number
    mtimeMs: number
}

export const kbTreeDataAtom = atom<KbEntry[]>([])
export const kbSelectedPathAtom = atom<string>("")
export const kbExpandedPathsAtom = atom<string[]>([])
export const kbSearchQueryAtom = atom<string>("")
export const kbActiveFileAtom = atom<KbFileContent | null>(null)
export const kbActiveFilePathAtom = atom<string>("")
export const kbIsLoadingAtom = atom<boolean>(false)
export const kbSidebarVisibleAtom = atom<boolean>(false)

export interface FloatingFileState {
    filePath: string
    connection: string
}

export const floatingVisibleAtom = atom<boolean>(false)
export const floatingMinimizedAtom = atom<boolean>(false)
export const floatingPositionAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 })
export const floatingSizeAtom = atom<{ w: number; h: number }>({ w: 560, h: 460 })
export const floatingFileStateAtom = atom<FloatingFileState>({
    filePath: "",
    connection: "",
})
export const floatingBlockIdAtom = atom<string>("")

export function openFloatingWindow(filePath: string, connection: string, blockId?: string) {
    globalStore.set(floatingFileStateAtom, { filePath, connection })
    globalStore.set(floatingBlockIdAtom, blockId ?? "")
    globalStore.set(floatingVisibleAtom, true)
    globalStore.set(floatingMinimizedAtom, false)
}

export function closeFloatingWindow() {
    globalStore.set(floatingVisibleAtom, false)
    globalStore.set(floatingMinimizedAtom, false)
    globalStore.set(floatingBlockIdAtom, "")
}

export function minimizeFloatingWindow() {
    globalStore.set(floatingMinimizedAtom, true)
}

export function restoreFloatingWindow() {
    globalStore.set(floatingMinimizedAtom, false)
}

export function toggleFloatingWindow(filePath?: string, connection?: string) {
    const visible = globalStore.get(floatingVisibleAtom)
    const minimized = globalStore.get(floatingMinimizedAtom)
    if (!visible) {
        openFloatingWindow(filePath ?? "", connection ?? "")
    } else if (minimized) {
        restoreFloatingWindow()
    } else {
        minimizeFloatingWindow()
    }
}
