// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package knowledgebase

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const KbDefaultSeedsVersion = 1

const KbSeedsMetaFile = ".kb-seeds-meta.json"

type kbSeedEntry struct {
	RelPath      string `json:"relPath"`
	LastSeedHash string `json:"lastSeedHash"`
	DeletedAt    int64  `json:"deletedAt,omitempty"`
}

type kbSeedsMeta struct {
	Version int                    `json:"version"`
	Seeds   map[string]kbSeedEntry `json:"seeds"`
}

type kbSeedDef struct {
	ID      string
	RelPath string
	Content string
	IsDir   bool
}

var defaultSeeds = []kbSeedDef{
	{
		ID:      "welcome",
		RelPath: "Welcome.md",
		Content: `# Welcome to the Knowledge Base

This is your personal knowledge base. Use it to store notes, documentation, and reference materials.

## Getting Started

- Create new files and folders to organize your content
- Use the search feature to quickly find what you need
- Import files from your local filesystem

## Tips

- Markdown files are rendered with full formatting support
- Images can be stored and viewed directly
- Your knowledge base is stored locally and privately
`,
	},
	{
		ID:      "experience",
		RelPath: "经验",
		IsDir:   true,
	},
	{
		ID:      "summary",
		RelPath: "总结",
		IsDir:   true,
	},
}

func seedContentHash(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

func initKbDefaultSeedFiles(root string) error {
	meta, err := readKbSeedsMeta(root)
	if err != nil {
		return err
	}
	needsWrite := false
	if meta.Version < KbDefaultSeedsVersion {
		meta.Version = KbDefaultSeedsVersion
		needsWrite = true
	}
	for _, seed := range defaultSeeds {
		entry, exists := meta.Seeds[seed.ID]
		if exists && entry.DeletedAt > 0 {
			continue
		}
		absPath := filepath.Join(root, seed.RelPath)
		if seed.IsDir {
			if _, statErr := os.Stat(absPath); os.IsNotExist(statErr) {
				if mkdirErr := os.MkdirAll(absPath, 0700); mkdirErr != nil {
					return fmt.Errorf("error creating seed directory %s: %w", seed.RelPath, mkdirErr)
				}
				meta.Seeds[seed.ID] = kbSeedEntry{
					RelPath:      seed.RelPath,
					LastSeedHash: "",
				}
				needsWrite = true
			}
			continue
		}
		currentHash := seedContentHash(seed.Content)
		if exists {
			if _, statErr := os.Stat(absPath); os.IsNotExist(statErr) {
				if entry.DeletedAt > 0 {
					continue
				}
				continue
			} else if statErr != nil {
				continue
			}
			existingData, readErr := os.ReadFile(absPath)
			if readErr != nil {
				continue
			}
			existingHash := seedContentHash(string(existingData))
			if existingHash != entry.LastSeedHash {
				continue
			}
			if existingHash == currentHash {
				if entry.LastSeedHash != currentHash {
					entry.LastSeedHash = currentHash
					meta.Seeds[seed.ID] = entry
					needsWrite = true
				}
				continue
			}
		}
		dir := filepath.Dir(absPath)
		if _, dirErr := os.Stat(dir); os.IsNotExist(dirErr) {
			if mkdirErr := os.MkdirAll(dir, 0700); mkdirErr != nil {
				return fmt.Errorf("error creating seed directory: %w", mkdirErr)
			}
		}
		writeErr := os.WriteFile(absPath, []byte(seed.Content), 0600)
		if writeErr != nil {
			return fmt.Errorf("error writing seed file %s: %w", seed.RelPath, writeErr)
		}
		meta.Seeds[seed.ID] = kbSeedEntry{
			RelPath:      seed.RelPath,
			LastSeedHash: currentHash,
		}
		needsWrite = true
	}
	if needsWrite {
		return writeKbSeedsMeta(root, meta)
	}
	return nil
}

func MarkSeedDeleted(relPath string) error {
	root := GetKbRoot()
	meta, err := readKbSeedsMeta(root)
	if err != nil {
		return err
	}
	for id, entry := range meta.Seeds {
		if entry.RelPath == relPath && entry.DeletedAt == 0 {
			entry.DeletedAt = time.Now().UnixMilli()
			meta.Seeds[id] = entry
			return writeKbSeedsMeta(root, meta)
		}
	}
	return nil
}
