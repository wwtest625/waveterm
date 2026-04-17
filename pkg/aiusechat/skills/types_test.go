// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"encoding/json"
	"testing"
)

func TestSkillMetadata_Serialize(t *testing.T) {
	meta := SkillMetadata{
		Name:        "deploy-docker",
		Description: "Deploy a Docker container with best practices",
	}
	data, err := json.Marshal(meta)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded SkillMetadata
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.Name != "deploy-docker" {
		t.Fatalf("name mismatch: got %s", decoded.Name)
	}
	if decoded.Description != "Deploy a Docker container with best practices" {
		t.Fatalf("description mismatch: got %s", decoded.Description)
	}
}

func TestSkillResource_Serialize(t *testing.T) {
	res := SkillResource{
		Name:    "scripts/setup.sh",
		Path:    "/path/to/skills/deploy-docker/scripts/setup.sh",
		Type:    SkillResourceScript,
		Content: "#!/bin/bash\necho hello",
		Size:    24,
	}
	data, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded SkillResource
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.Type != SkillResourceScript {
		t.Fatalf("type mismatch: got %s", decoded.Type)
	}
	if decoded.Name != "scripts/setup.sh" {
		t.Fatalf("name mismatch: got %s", decoded.Name)
	}
	if decoded.Content != "#!/bin/bash\necho hello" {
		t.Fatalf("content mismatch: got %s", decoded.Content)
	}
}

func TestSkillResource_OmitEmptyContent(t *testing.T) {
	res := SkillResource{
		Name: "large-file.bin",
		Path: "/path/to/large-file.bin",
		Type: SkillResourceOther,
		Size: 1024 * 1024,
	}
	data, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal to map failed: %v", err)
	}
	if _, hasContent := raw["content"]; hasContent {
		t.Fatalf("content should be omitted when empty")
	}
}

func TestSkill_FullSerialize(t *testing.T) {
	skill := Skill{
		Metadata: SkillMetadata{
			Name:        "deploy-docker",
			Description: "Deploy a Docker container",
		},
		Content:   "## Steps\n1. Pull image\n2. Run container",
		Path:      "/path/to/skills/deploy-docker/SKILL.md",
		Directory: "/path/to/skills/deploy-docker",
		Enabled:   true,
		Resources: []SkillResource{
			{Name: "docker-compose.yml", Path: "/path/to/skills/deploy-docker/docker-compose.yml", Type: SkillResourceConfig, Size: 512},
		},
	}
	data, err := json.Marshal(skill)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded Skill
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if !decoded.Enabled {
		t.Fatalf("enabled should be true")
	}
	if decoded.Metadata.Name != "deploy-docker" {
		t.Fatalf("name mismatch: got %s", decoded.Metadata.Name)
	}
	if len(decoded.Resources) != 1 {
		t.Fatalf("resources count mismatch: got %d", len(decoded.Resources))
	}
	if decoded.Resources[0].Type != SkillResourceConfig {
		t.Fatalf("resource type mismatch: got %s", decoded.Resources[0].Type)
	}
}

func TestSkillState_Serialize(t *testing.T) {
	state := SkillState{
		SkillId:  "deploy-docker",
		Enabled:  false,
		LastUsed: 1713200000000,
		Config:   map[string]interface{}{"timeout": 30},
	}
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded SkillState
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.Enabled {
		t.Fatalf("enabled should be false")
	}
	if decoded.SkillId != "deploy-docker" {
		t.Fatalf("skillId mismatch: got %s", decoded.SkillId)
	}
	if decoded.Config["timeout"].(float64) != 30 {
		t.Fatalf("config timeout mismatch: got %v", decoded.Config["timeout"])
	}
}

func TestSkillParseResult_Success(t *testing.T) {
	result := SkillParseResult{
		Success: true,
		Skill: &Skill{
			Metadata: SkillMetadata{Name: "test", Description: "test skill"},
			Content:  "content",
		},
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded SkillParseResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if !decoded.Success {
		t.Fatalf("success should be true")
	}
	if decoded.Skill == nil {
		t.Fatalf("skill should not be nil")
	}
}

func TestSkillParseResult_Error(t *testing.T) {
	result := SkillParseResult{
		Success: false,
		Error:   "File not found: /path/to/SKILL.md",
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded SkillParseResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if decoded.Success {
		t.Fatalf("success should be false")
	}
	if decoded.Skill != nil {
		t.Fatalf("skill should be nil on error")
	}
	if decoded.Error != "File not found: /path/to/SKILL.md" {
		t.Fatalf("error mismatch: got %s", decoded.Error)
	}
}

func TestSkillImportResult_AllCodes(t *testing.T) {
	codes := []SkillImportErrorCode{
		SkillImportErrorInvalidZip,
		SkillImportErrorNoSkillMd,
		SkillImportErrorInvalidMetadata,
		SkillImportErrorDirExists,
		SkillImportErrorExtractFailed,
		SkillImportErrorUnknown,
	}
	for _, code := range codes {
		result := SkillImportResult{
			Success:   false,
			Error:     "test error",
			ErrorCode: code,
		}
		data, err := json.Marshal(result)
		if err != nil {
			t.Fatalf("marshal failed for code %s: %v", code, err)
		}
		var decoded SkillImportResult
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("unmarshal failed for code %s: %v", code, err)
		}
		if decoded.ErrorCode != code {
			t.Fatalf("errorCode mismatch: got %s, want %s", decoded.ErrorCode, code)
		}
	}
}

func TestSkillValidationResult(t *testing.T) {
	valid := SkillValidationResult{Valid: true, Errors: nil, Warnings: nil}
	data, _ := json.Marshal(valid)
	var decoded SkillValidationResult
	json.Unmarshal(data, &decoded)
	if !decoded.Valid {
		t.Fatalf("should be valid")
	}

	invalid := SkillValidationResult{
		Valid:  false,
		Errors: []string{"Missing required field: name"},
	}
	data, _ = json.Marshal(invalid)
	json.Unmarshal(data, &decoded)
	if decoded.Valid {
		t.Fatalf("should be invalid")
	}
	if len(decoded.Errors) != 1 {
		t.Fatalf("errors count mismatch: got %d", len(decoded.Errors))
	}
}

func TestSkillDirectory(t *testing.T) {
	dir := SkillDirectory{Path: "/some/path", Exists: true}
	data, _ := json.Marshal(dir)
	var decoded SkillDirectory
	json.Unmarshal(data, &decoded)
	if decoded.Path != "/some/path" {
		t.Fatalf("path mismatch: got %s", decoded.Path)
	}
	if !decoded.Exists {
		t.Fatalf("exists should be true")
	}
}

func TestResourceTypeMap_Extensions(t *testing.T) {
	tests := map[string]SkillResourceType{
		".sh":    SkillResourceScript,
		".py":    SkillResourceScript,
		".tmpl":  SkillResourceTemplate,
		".json":  SkillResourceConfig,
		".yaml":  SkillResourceConfig,
		".csv":   SkillResourceData,
		".xml":   SkillResourceData,
		".bin":   SkillResourceOther,
		".exe":   SkillResourceOther,
	}
	for ext, expected := range tests {
		got, ok := ResourceTypeMap[ext]
		if ext == ".bin" || ext == ".exe" {
			if ok {
				t.Fatalf("extension %s should not be in ResourceTypeMap", ext)
			}
			continue
		}
		if !ok {
			t.Fatalf("extension %s should be in ResourceTypeMap", ext)
		}
		if got != expected {
			t.Fatalf("ResourceTypeMap[%s] = %s, want %s", ext, got, expected)
		}
	}
}
