import { callBackendService } from "./wos"
import type { KbEntry, KbFileContent, KbSearchResult } from "./kb-model"

const ServiceName = "knowledgebase"

export async function kbEnsureRoot(): Promise<void> {
    return callBackendService(ServiceName, "EnsureRoot", [])
}

export async function kbListDir(relDir: string): Promise<KbEntry[]> {
    return callBackendService(ServiceName, "ListDir", [relDir])
}

export async function kbReadFile(relPath: string): Promise<KbFileContent> {
    return callBackendService(ServiceName, "ReadFile", [relPath])
}

export async function kbWriteFile(relPath: string, content: string): Promise<void> {
    return callBackendService(ServiceName, "WriteFile", [relPath, content])
}

export async function kbCreateFile(relDir: string, name: string, content: string): Promise<string> {
    return callBackendService(ServiceName, "CreateFile", [relDir, name, content])
}

export async function kbMkdir(relDir: string, name: string): Promise<string> {
    return callBackendService(ServiceName, "Mkdir", [relDir, name])
}

export async function kbRename(relPath: string, newName: string): Promise<string> {
    return callBackendService(ServiceName, "Rename", [relPath, newName])
}

export async function kbDelete(relPath: string): Promise<void> {
    return callBackendService(ServiceName, "Delete", [relPath])
}

export async function kbMove(srcRelPath: string, dstRelDir: string): Promise<string> {
    return callBackendService(ServiceName, "Move", [srcRelPath, dstRelDir])
}

export async function kbCopy(srcRelPath: string, dstRelDir: string): Promise<string> {
    return callBackendService(ServiceName, "Copy", [srcRelPath, dstRelDir])
}

export async function kbImportFile(srcAbsPath: string, dstRelDir: string): Promise<string> {
    return callBackendService(ServiceName, "ImportFile", [srcAbsPath, dstRelDir])
}

export async function kbImportFolder(srcAbsPath: string, dstRelDir: string): Promise<string> {
    return callBackendService(ServiceName, "ImportFolder", [srcAbsPath, dstRelDir])
}

export async function kbSearch(query: string): Promise<KbSearchResult[]> {
    return callBackendService(ServiceName, "Search", [query])
}
