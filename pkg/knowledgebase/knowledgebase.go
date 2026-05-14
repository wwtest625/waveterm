// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package knowledgebase

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const KbDirName = "knowledgebase"

var BlockedExtensions = map[string]bool{
	".exe": true, ".dll": true, ".so": true, ".dylib": true, ".bin": true,
	".o": true, ".obj": true, ".class": true, ".pyc": true, ".wasm": true,
	".node": true, ".com": true, ".bat": true, ".cmd": true, ".msi": true,
	".deb": true, ".rpm": true, ".dmg": true, ".pkg": true, ".zip": true,
	".tar": true, ".gz": true, ".tgz": true, ".rar": true, ".7z": true,
	".xz": true, ".bz2": true, ".db": true, ".sqlite": true, ".sqlite3": true,
}

var ImageExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".webp": true, ".bmp": true, ".svg": true,
}

const MaxImportSize int64 = 10 * 1024 * 1024

type KbEntry struct {
	Name    string `json:"name"`
	RelPath string `json:"relPath"`
	Type    string `json:"type"`
	Size    int64  `json:"size,omitempty"`
	MtimeMs int64  `json:"mtimeMs,omitempty"`
}

type KbFileContent struct {
	Content  string `json:"content"`
	MtimeMs  int64  `json:"mtimeMs"`
	IsImage  bool   `json:"isImage"`
	MimeType string `json:"mimeType,omitempty"`
}

type KbSearchResult struct {
	Name    string `json:"name"`
	RelPath string `json:"relPath"`
	Size    int64  `json:"size"`
	MtimeMs int64  `json:"mtimeMs"`
}

func GetKbRoot() string {
	root := filepath.Join(wavebase.GetWaveDataDir(), KbDirName)
	return root
}

func ResolveKbPath(relPath string) (string, error) {
	relPath = filepath.ToSlash(relPath)
	if relPath == "" {
		return GetKbRoot(), nil
	}
	if filepath.IsAbs(relPath) {
		return "", fmt.Errorf("absolute path not allowed: %s", relPath)
	}
	cleaned := filepath.Clean(relPath)
	if strings.HasPrefix(cleaned, "..") {
		return "", fmt.Errorf("path traversal not allowed: %s", relPath)
	}
	absPath := filepath.Join(GetKbRoot(), cleaned)
	absPath = filepath.Clean(absPath)
	kbRoot := filepath.Clean(GetKbRoot())
	if !strings.HasPrefix(absPath, kbRoot+string(os.PathSeparator)) && absPath != kbRoot {
		return "", fmt.Errorf("path escapes kb root: %s", relPath)
	}
	return absPath, nil
}

func isSafeBasename(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return false
	}
	return true
}

func isBlockedExtension(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return BlockedExtensions[ext]
}

func isImageExtension(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ImageExtensions[ext]
}

func mimeTypeForExt(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

func toRelPath(absPath string) string {
	kbRoot := filepath.Clean(GetKbRoot())
	rel := strings.TrimPrefix(absPath, kbRoot+string(os.PathSeparator))
	if rel == absPath {
		rel = strings.TrimPrefix(absPath, kbRoot)
	}
	return filepath.ToSlash(rel)
}

func uniqueName(dir string, name string) (string, error) {
	target := filepath.Join(dir, name)
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return name, nil
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, i, ext)
		target = filepath.Join(dir, candidate)
		if _, err := os.Stat(target); os.IsNotExist(err) {
			return candidate, nil
		}
	}
}

func EnsureRoot() error {
	kbRoot := GetKbRoot()
	log.Printf("[KB-DEBUG] EnsureRoot: kbRoot=%s", kbRoot)
	info, err := os.Stat(kbRoot)
	if os.IsNotExist(err) {
		log.Printf("[KB-DEBUG] EnsureRoot: kbRoot does not exist, creating...")
		err = os.MkdirAll(kbRoot, 0700)
		if err != nil {
			return fmt.Errorf("cannot create kb root: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("error statting kb root: %w", err)
	} else if !info.IsDir() {
		return fmt.Errorf("kb root %q is not a directory", kbRoot)
	}
	return initKbDefaultSeedFiles(kbRoot)
}

func ListDir(relDir string) ([]KbEntry, error) {
	absDir, err := ResolveKbPath(relDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		return nil, fmt.Errorf("error listing directory: %w", err)
	}
	var result []KbEntry
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		entryRelPath := filepath.ToSlash(filepath.Join(relDir, name))
		kbEntry := KbEntry{
			Name:    name,
			RelPath: entryRelPath,
		}
		if entry.IsDir() {
			kbEntry.Type = "dir"
		} else {
			kbEntry.Type = "file"
			kbEntry.Size = info.Size()
			kbEntry.MtimeMs = info.ModTime().UnixMilli()
		}
		result = append(result, kbEntry)
	}
	if result == nil {
		result = []KbEntry{}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Type != result[j].Type {
			return result[i].Type == "dir"
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
}

func ReadFile(relPath string) (*KbFileContent, error) {
	absPath, err := ResolveKbPath(relPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, fmt.Errorf("error reading file: %w", err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("path is a directory: %s", relPath)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("error reading file: %w", err)
	}
	result := &KbFileContent{
		MtimeMs: info.ModTime().UnixMilli(),
	}
	if isImageExtension(relPath) {
		result.IsImage = true
		result.MimeType = mimeTypeForExt(relPath)
		result.Content = base64.StdEncoding.EncodeToString(data)
	} else {
		result.IsImage = false
		result.Content = string(data)
	}
	return result, nil
}

func WriteFile(relPath string, content string) error {
	absPath, err := ResolveKbPath(relPath)
	if err != nil {
		return err
	}
	dir := filepath.Dir(absPath)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("parent directory does not exist: %s", filepath.Dir(relPath))
	}
	err = os.WriteFile(absPath, []byte(content), 0600)
	if err != nil {
		return fmt.Errorf("error writing file: %w", err)
	}
	return nil
}

func CreateFile(relDir string, name string, content string) (string, error) {
	if !isSafeBasename(name) {
		return "", fmt.Errorf("invalid file name: %s", name)
	}
	if isBlockedExtension(name) {
		return "", fmt.Errorf("blocked file extension: %s", filepath.Ext(name))
	}
	absDir, err := ResolveKbPath(relDir)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(absDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("directory does not exist: %s", relDir)
	}
	uniqueNameVal, err := uniqueName(absDir, name)
	if err != nil {
		return "", err
	}
	absPath := filepath.Join(absDir, uniqueNameVal)
	err = os.WriteFile(absPath, []byte(content), 0600)
	if err != nil {
		return "", fmt.Errorf("error creating file: %w", err)
	}
	return filepath.ToSlash(filepath.Join(relDir, uniqueNameVal)), nil
}

func Mkdir(relDir string, name string) (string, error) {
	if !isSafeBasename(name) {
		return "", fmt.Errorf("invalid directory name: %s", name)
	}
	absDir, err := ResolveKbPath(relDir)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(absDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("directory does not exist: %s", relDir)
	}
	uniqueNameVal, err := uniqueName(absDir, name)
	if err != nil {
		return "", err
	}
	absPath := filepath.Join(absDir, uniqueNameVal)
	err = os.MkdirAll(absPath, 0700)
	if err != nil {
		return "", fmt.Errorf("error creating directory: %w", err)
	}
	return filepath.ToSlash(filepath.Join(relDir, uniqueNameVal)), nil
}

func Rename(relPath string, newName string) (string, error) {
	if !isSafeBasename(newName) {
		return "", fmt.Errorf("invalid name: %s", newName)
	}
	absPath, err := ResolveKbPath(relPath)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(absPath); err != nil {
		return "", fmt.Errorf("path does not exist: %s", relPath)
	}
	dir := filepath.Dir(absPath)
	newAbsPath := filepath.Join(dir, newName)
	if _, err := os.Stat(newAbsPath); err == nil {
		return "", fmt.Errorf("name already exists: %s", newName)
	}
	err = os.Rename(absPath, newAbsPath)
	if err != nil {
		return "", fmt.Errorf("error renaming: %w", err)
	}
	parentRel := filepath.Dir(relPath)
	if parentRel == "." {
		parentRel = ""
	}
	return filepath.ToSlash(filepath.Join(parentRel, newName)), nil
}

func Delete(relPath string) error {
	absPath, err := ResolveKbPath(relPath)
	if err != nil {
		return err
	}
	if absPath == filepath.Clean(GetKbRoot()) {
		return fmt.Errorf("cannot delete kb root")
	}
	if _, err := os.Stat(absPath); err != nil {
		return fmt.Errorf("path does not exist: %s", relPath)
	}
	err = os.RemoveAll(absPath)
	if err != nil {
		return fmt.Errorf("error deleting: %w", err)
	}
	return nil
}

func Move(srcRelPath string, dstRelDir string) (string, error) {
	srcAbs, err := ResolveKbPath(srcRelPath)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(srcAbs); err != nil {
		return "", fmt.Errorf("source does not exist: %s", srcRelPath)
	}
	dstAbsDir, err := ResolveKbPath(dstRelDir)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(dstAbsDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("destination directory does not exist: %s", dstRelDir)
	}
	name := filepath.Base(srcAbs)
	dstAbs := filepath.Join(dstAbsDir, name)
	if _, err := os.Stat(dstAbs); err == nil {
		uniqueNameVal, err := uniqueName(dstAbsDir, name)
		if err != nil {
			return "", err
		}
		dstAbs = filepath.Join(dstAbsDir, uniqueNameVal)
		name = uniqueNameVal
	}
	err = os.Rename(srcAbs, dstAbs)
	if err != nil {
		return "", fmt.Errorf("error moving: %w", err)
	}
	return filepath.ToSlash(filepath.Join(dstRelDir, name)), nil
}

func Copy(srcRelPath string, dstRelDir string) (string, error) {
	srcAbs, err := ResolveKbPath(srcRelPath)
	if err != nil {
		return "", err
	}
	srcInfo, err := os.Stat(srcAbs)
	if err != nil {
		return "", fmt.Errorf("source does not exist: %s", srcRelPath)
	}
	dstAbsDir, err := ResolveKbPath(dstRelDir)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(dstAbsDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("destination directory does not exist: %s", dstRelDir)
	}
	name := filepath.Base(srcAbs)
	uniqueNameVal, err := uniqueName(dstAbsDir, name)
	if err != nil {
		return "", err
	}
	dstAbs := filepath.Join(dstAbsDir, uniqueNameVal)
	if srcInfo.IsDir() {
		err = copyDir(srcAbs, dstAbs)
	} else {
		err = copyFile(srcAbs, dstAbs)
	}
	if err != nil {
		return "", fmt.Errorf("error copying: %w", err)
	}
	return filepath.ToSlash(filepath.Join(dstRelDir, uniqueNameVal)), nil
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0600)
}

func copyDir(src, dst string) error {
	err := os.MkdirAll(dst, 0700)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			err = copyDir(srcPath, dstPath)
		} else {
			err = copyFile(srcPath, dstPath)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func ImportFile(srcAbsPath string, dstRelDir string) (string, error) {
	srcInfo, err := os.Stat(srcAbsPath)
	if err != nil {
		return "", fmt.Errorf("source file does not exist: %s", srcAbsPath)
	}
	if srcInfo.IsDir() {
		return "", fmt.Errorf("source path is a directory, use ImportFolder instead: %s", srcAbsPath)
	}
	if srcInfo.Size() > MaxImportSize {
		return "", fmt.Errorf("file exceeds maximum import size of %d bytes: %s", MaxImportSize, srcAbsPath)
	}
	name := filepath.Base(srcAbsPath)
	if !isSafeBasename(name) {
		return "", fmt.Errorf("invalid file name: %s", name)
	}
	if isBlockedExtension(name) {
		return "", fmt.Errorf("blocked file extension: %s", filepath.Ext(name))
	}
	dstAbsDir, err := ResolveKbPath(dstRelDir)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(dstAbsDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("destination directory does not exist: %s", dstRelDir)
	}
	uniqueNameVal, err := uniqueName(dstAbsDir, name)
	if err != nil {
		return "", err
	}
	dstAbs := filepath.Join(dstAbsDir, uniqueNameVal)
	data, err := os.ReadFile(srcAbsPath)
	if err != nil {
		return "", fmt.Errorf("error reading source file: %w", err)
	}
	err = os.WriteFile(dstAbs, data, 0600)
	if err != nil {
		return "", fmt.Errorf("error writing imported file: %w", err)
	}
	return filepath.ToSlash(filepath.Join(dstRelDir, uniqueNameVal)), nil
}

func ImportFolder(srcAbsPath string, dstRelDir string) (string, error) {
	srcInfo, err := os.Stat(srcAbsPath)
	if err != nil {
		return "", fmt.Errorf("source folder does not exist: %s", srcAbsPath)
	}
	if !srcInfo.IsDir() {
		return "", fmt.Errorf("source path is not a directory, use ImportFile instead: %s", srcAbsPath)
	}
	name := filepath.Base(srcAbsPath)
	if !isSafeBasename(name) {
		return "", fmt.Errorf("invalid folder name: %s", name)
	}
	dstAbsDir, err := ResolveKbPath(dstRelDir)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(dstAbsDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("destination directory does not exist: %s", dstRelDir)
	}
	uniqueNameVal, err := uniqueName(dstAbsDir, name)
	if err != nil {
		return "", err
	}
	dstAbs := filepath.Join(dstAbsDir, uniqueNameVal)
	err = copyDir(srcAbsPath, dstAbs)
	if err != nil {
		return "", fmt.Errorf("error importing folder: %w", err)
	}
	return filepath.ToSlash(filepath.Join(dstRelDir, uniqueNameVal)), nil
}

func Search(query string) ([]KbSearchResult, error) {
	kbRoot := GetKbRoot()
	log.Printf("[KB-DEBUG] knowledgebase.Search: kbRoot=%s, query=%q", kbRoot, query)
	kbRootInfo, statErr := os.Stat(kbRoot)
	if statErr != nil {
		log.Printf("[KB-DEBUG] knowledgebase.Search: kbRoot stat error: %v", statErr)
	} else {
		log.Printf("[KB-DEBUG] knowledgebase.Search: kbRoot isDir=%v", kbRootInfo.IsDir())
	}
	lowerQuery := strings.ToLower(query)
	matchAll := lowerQuery == "" || lowerQuery == "*"
	var results []KbSearchResult
	err := filepath.WalkDir(kbRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			log.Printf("[KB-DEBUG] knowledgebase.Search: walkdir error at %q: %v", path, err)
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			if matchAll || strings.Contains(strings.ToLower(name), lowerQuery) {
				info, infoErr := d.Info()
				if infoErr != nil {
					return nil
				}
				relPath := toRelPath(path)
				results = append(results, KbSearchResult{
					Name:    name,
					RelPath: relPath,
					Size:    info.Size(),
					MtimeMs: info.ModTime().UnixMilli(),
				})
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("error searching: %w", err)
	}
	log.Printf("[KB-DEBUG] knowledgebase.Search: found %d results", len(results))
	if results == nil {
		results = []KbSearchResult{}
	}
	sort.SliceStable(results, func(i, j int) bool {
		return strings.ToLower(results[i].Name) < strings.ToLower(results[j].Name)
	})
	return results, nil
}

func readKbSeedsMeta(root string) (*kbSeedsMeta, error) {
	metaPath := filepath.Join(root, KbSeedsMetaFile)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &kbSeedsMeta{Version: 0, Seeds: map[string]kbSeedEntry{}}, nil
		}
		return nil, fmt.Errorf("error reading seeds meta: %w", err)
	}
	var meta kbSeedsMeta
	err = json.Unmarshal(data, &meta)
	if err != nil {
		return nil, fmt.Errorf("error parsing seeds meta: %w", err)
	}
	if meta.Seeds == nil {
		meta.Seeds = map[string]kbSeedEntry{}
	}
	return &meta, nil
}

func writeKbSeedsMeta(root string, meta *kbSeedsMeta) error {
	metaPath := filepath.Join(root, KbSeedsMetaFile)
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshaling seeds meta: %w", err)
	}
	err = os.WriteFile(metaPath, data, 0600)
	if err != nil {
		return fmt.Errorf("error writing seeds meta: %w", err)
	}
	return nil
}
