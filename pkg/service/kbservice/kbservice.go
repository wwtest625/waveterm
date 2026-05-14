// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package kbservice

import "github.com/wavetermdev/waveterm/pkg/knowledgebase"

type KnowledgeBaseService struct{}

func (kbs *KnowledgeBaseService) EnsureRoot() error {
	return knowledgebase.EnsureRoot()
}

func (kbs *KnowledgeBaseService) ListDir(relDir string) ([]knowledgebase.KbEntry, error) {
	if err := knowledgebase.EnsureRoot(); err != nil {
		return nil, err
	}
	return knowledgebase.ListDir(relDir)
}

func (kbs *KnowledgeBaseService) ReadFile(relPath string) (*knowledgebase.KbFileContent, error) {
	if err := knowledgebase.EnsureRoot(); err != nil {
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
		return nil, err
	}
	return knowledgebase.Search(query)
}
