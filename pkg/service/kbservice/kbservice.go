// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package kbservice

import (
	"log"

	"github.com/wavetermdev/waveterm/pkg/knowledgebase"
)

type KnowledgeBaseService struct{}

func (kbs *KnowledgeBaseService) EnsureRoot() error {
	log.Printf("[KB-DEBUG] kbservice.EnsureRoot: kbRoot=%s", knowledgebase.GetKbRoot())
	return knowledgebase.EnsureRoot()
}

func (kbs *KnowledgeBaseService) ListDir(relDir string) ([]knowledgebase.KbEntry, error) {
	if err := knowledgebase.EnsureRoot(); err != nil {
		log.Printf("[KB-DEBUG] kbservice.ListDir: EnsureRoot failed: %v", err)
		return nil, err
	}
	entries, err := knowledgebase.ListDir(relDir)
	if err != nil {
		log.Printf("[KB-DEBUG] kbservice.ListDir: error: %v", err)
		return nil, err
	}
	log.Printf("[KB-DEBUG] kbservice.ListDir: relDir=%q, found %d entries", relDir, len(entries))
	return entries, nil
}

func (kbs *KnowledgeBaseService) ReadFile(relPath string) (*knowledgebase.KbFileContent, error) {
	if err := knowledgebase.EnsureRoot(); err != nil {
		log.Printf("[KB-DEBUG] kbservice.ReadFile: EnsureRoot failed: %v", err)
		return nil, err
	}
	return knowledgebase.ReadFile(relPath)
}

func (kbs *KnowledgeBaseService) WriteFile(relPath string, content string) error {
	return knowledgebase.WriteFile(relPath, content)
}

func (kbs *KnowledgeBaseService) CreateFile(relDir string, name string, content string) (string, error) {
	return knowledgebase.CreateFile(relDir, name, content)
}

func (kbs *KnowledgeBaseService) Mkdir(relDir string, name string) (string, error) {
	return knowledgebase.Mkdir(relDir, name)
}

func (kbs *KnowledgeBaseService) Rename(relPath string, newName string) (string, error) {
	return knowledgebase.Rename(relPath, newName)
}

func (kbs *KnowledgeBaseService) Delete(relPath string) error {
	return knowledgebase.Delete(relPath)
}

func (kbs *KnowledgeBaseService) Move(srcRelPath string, dstRelDir string) (string, error) {
	return knowledgebase.Move(srcRelPath, dstRelDir)
}

func (kbs *KnowledgeBaseService) Copy(srcRelPath string, dstRelDir string) (string, error) {
	return knowledgebase.Copy(srcRelPath, dstRelDir)
}

func (kbs *KnowledgeBaseService) ImportFile(srcAbsPath string, dstRelDir string) (string, error) {
	return knowledgebase.ImportFile(srcAbsPath, dstRelDir)
}

func (kbs *KnowledgeBaseService) ImportFolder(srcAbsPath string, dstRelDir string) (string, error) {
	return knowledgebase.ImportFolder(srcAbsPath, dstRelDir)
}

func (kbs *KnowledgeBaseService) Search(query string) ([]knowledgebase.KbSearchResult, error) {
	if err := knowledgebase.EnsureRoot(); err != nil {
		log.Printf("[KB-DEBUG] kbservice.Search: EnsureRoot failed: %v", err)
		return nil, err
	}
	results, err := knowledgebase.Search(query)
	if err != nil {
		log.Printf("[KB-DEBUG] kbservice.Search: error: %v", err)
		return nil, err
	}
	log.Printf("[KB-DEBUG] kbservice.Search: query=%q, found %d results", query, len(results))
	return results, nil
}
