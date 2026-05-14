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
