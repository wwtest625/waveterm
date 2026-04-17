// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/skills"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func setupTestSkillsManager(t *testing.T) *skills.SkillsManager {
	t.Helper()
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)

	mgr := skills.NewSkillsManager(tmpDir, builtinDir)
	if err := mgr.Initialize(); err != nil {
		t.Fatalf("failed to initialize test manager: %v", err)
	}

	origManager := globalSkillsManager
	SetGlobalSkillsManagerForTest(mgr)
	t.Cleanup(func() {
		SetGlobalSkillsManagerForTest(origManager)
		mgr.Close()
	})

	return mgr
}

func createTestSkillForTools(t *testing.T, mgr *skills.SkillsManager, name string, description string, content string) {
	t.Helper()
	metadata := skills.SkillMetadata{Name: name, Description: description}
	_, err := mgr.CreateUserSkill(metadata, content)
	if err != nil {
		t.Fatalf("failed to create test skill: %v", err)
	}
}

func TestGetUseSkillToolDefinition_Schema(t *testing.T) {
	tool := GetUseSkillToolDefinition()
	if tool.Name != "waveai_use_skill" {
		t.Fatalf("tool name mismatch: got %s", tool.Name)
	}
	if tool.Strict != true {
		t.Fatalf("tool should be strict")
	}
	schema := tool.InputSchema
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map")
	}
	if _, ok := props["skill_name"]; !ok {
		t.Fatalf("expected skill_name property")
	}
	required, ok := schema["required"].([]string)
	if !ok {
		t.Fatalf("expected required []string")
	}
	if len(required) != 1 || required[0] != "skill_name" {
		t.Fatalf("required should be [skill_name], got %v", required)
	}
}

func TestGetCreateSkillToolDefinition_Schema(t *testing.T) {
	tool := GetCreateSkillToolDefinition()
	if tool.Name != "waveai_create_skill" {
		t.Fatalf("tool name mismatch: got %s", tool.Name)
	}
	schema := tool.InputSchema
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map")
	}
	expectedProps := []string{"name", "description", "content"}
	for _, prop := range expectedProps {
		if _, ok := props[prop]; !ok {
			t.Fatalf("expected %s property", prop)
		}
	}
	required, ok := schema["required"].([]string)
	if !ok {
		t.Fatalf("expected required []string")
	}
	if len(required) != 3 {
		t.Fatalf("expected 3 required fields, got %d", len(required))
	}
}

func TestUseSkillToolCallback_Success(t *testing.T) {
	mgr := setupTestSkillsManager(t)
	createTestSkillForTools(t, mgr, "deploy-docker", "Deploy Docker containers", "## Steps\n1. Pull image\n2. Run container")

	tool := GetUseSkillToolDefinition()
	input := map[string]any{"skill_name": "deploy-docker"}
	output, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("callback failed: %v", err)
	}

	resultBytes, _ := json.Marshal(output)
	var result UseSkillToolOutput
	json.Unmarshal(resultBytes, &result)

	if result.SkillName != "deploy-docker" {
		t.Fatalf("skill name mismatch: got %s", result.SkillName)
	}
	if result.Description != "Deploy Docker containers" {
		t.Fatalf("description mismatch: got %s", result.Description)
	}
	if !strings.Contains(result.Content, "Pull image") {
		t.Fatalf("content should contain skill instructions, got: %s", result.Content)
	}
}

func TestUseSkillToolCallback_NotFound(t *testing.T) {
	setupTestSkillsManager(t)

	tool := GetUseSkillToolDefinition()
	input := map[string]any{"skill_name": "nonexistent"}
	_, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for nonexistent skill")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error should mention not found, got: %v", err)
	}
}

func TestUseSkillToolCallback_Disabled(t *testing.T) {
	mgr := setupTestSkillsManager(t)
	createTestSkillForTools(t, mgr, "disabled-skill", "A disabled skill", "content")
	mgr.SetSkillEnabled("disabled-skill", false)

	tool := GetUseSkillToolDefinition()
	input := map[string]any{"skill_name": "disabled-skill"}
	_, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for disabled skill")
	}
	if !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("error should mention disabled, got: %v", err)
	}
}

func TestUseSkillToolCallback_MissingInput(t *testing.T) {
	setupTestSkillsManager(t)

	tool := GetUseSkillToolDefinition()
	input := map[string]any{}
	_, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for missing skill_name")
	}
}

func TestCreateSkillToolCallback_Success(t *testing.T) {
	setupTestSkillsManager(t)

	tool := GetCreateSkillToolDefinition()
	input := map[string]any{
		"name":        "my-new-skill",
		"description": "A new skill",
		"content":     "## Instructions\nDo the thing.",
	}
	output, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("callback failed: %v", err)
	}

	resultBytes, _ := json.Marshal(output)
	var result CreateSkillToolOutput
	json.Unmarshal(resultBytes, &result)

	if result.SkillName != "my-new-skill" {
		t.Fatalf("skill name mismatch: got %s", result.SkillName)
	}
	if result.Path == "" {
		t.Fatalf("path should not be empty")
	}
}

func TestCreateSkillToolCallback_DuplicateName(t *testing.T) {
	mgr := setupTestSkillsManager(t)
	createTestSkillForTools(t, mgr, "existing-skill", "Already exists", "content")

	tool := GetCreateSkillToolDefinition()
	input := map[string]any{
		"name":        "existing-skill",
		"description": "Duplicate",
		"content":     "content",
	}
	_, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for duplicate skill name")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("error should mention already exists, got: %v", err)
	}
}

func TestCreateSkillToolCallback_MissingFields(t *testing.T) {
	setupTestSkillsManager(t)

	tool := GetCreateSkillToolDefinition()

	_, err := tool.ToolAnyCallback(map[string]any{}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for missing fields")
	}

	_, err = tool.ToolAnyCallback(map[string]any{"name": "test"}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for missing description")
	}

	_, err = tool.ToolAnyCallback(map[string]any{"name": "test", "description": "desc"}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("expected error for missing content")
	}
}

func TestUseSkillToolCallDesc(t *testing.T) {
	tool := GetUseSkillToolDefinition()
	desc := tool.ToolCallDesc(map[string]any{"skill_name": "deploy-docker"}, nil, nil)
	if !strings.Contains(desc, "deploy-docker") {
		t.Fatalf("description should mention skill name, got: %s", desc)
	}
}

func TestCreateSkillToolCallDesc(t *testing.T) {
	tool := GetCreateSkillToolDefinition()
	desc := tool.ToolCallDesc(map[string]any{"name": "my-skill", "description": "desc", "content": "content"}, nil, nil)
	if !strings.Contains(desc, "my-skill") {
		t.Fatalf("description should mention skill name, got: %s", desc)
	}
}

func TestUseSkillToolOutput_IncludesResources(t *testing.T) {
	mgr := setupTestSkillsManager(t)
	metadata := skills.SkillMetadata{Name: "skill-with-res", Description: "Has resources"}
	content := "## Steps\n1. Run setup"
	skill, err := mgr.CreateUserSkill(metadata, content)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	resDir := filepath.Join(skill.Directory, "scripts")
	os.MkdirAll(resDir, 0755)
	os.WriteFile(filepath.Join(resDir, "setup.sh"), []byte("#!/bin/bash\necho hello"), 0644)

	mgr.LoadAllSkills()

	tool := GetUseSkillToolDefinition()
	input := map[string]any{"skill_name": "skill-with-res"}
	output, err := tool.ToolAnyCallback(input, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("callback failed: %v", err)
	}

	resultBytes, _ := json.Marshal(output)
	var result UseSkillToolOutput
	json.Unmarshal(resultBytes, &result)

	if len(result.Resources) == 0 {
		t.Fatalf("expected resources to be included")
	}
	found := false
	for _, res := range result.Resources {
		if res.Name == "scripts/setup.sh" {
			found = true
			if res.Type != skills.SkillResourceScript {
				t.Fatalf("resource type mismatch: got %s", res.Type)
			}
		}
	}
	if !found {
		t.Fatalf("scripts/setup.sh resource not found")
	}
}

func TestGetToolCapabilityPrompt_IncludesSkills(t *testing.T) {
	mgr := setupTestSkillsManager(t)
	createTestSkillForTools(t, mgr, "deploy-docker", "Deploy Docker", "content")

	tools := []uctypes.ToolDefinition{GetUseSkillToolDefinition(), GetCreateSkillToolDefinition()}
	prompt := getToolCapabilityPrompt(tools)
	if !strings.Contains(prompt, "waveai_use_skill") {
		t.Fatalf("prompt should mention waveai_use_skill")
	}
	if !strings.Contains(prompt, "waveai_create_skill") {
		t.Fatalf("prompt should mention waveai_create_skill")
	}
	if !strings.Contains(prompt, "deploy-docker") {
		t.Fatalf("prompt should list available skills including deploy-docker")
	}
}

func TestHasEnabledSkills(t *testing.T) {
	mgr := setupTestSkillsManager(t)

	if hasEnabledSkills() {
		t.Fatalf("should have no enabled skills initially")
	}

	createTestSkillForTools(t, mgr, "test-skill", "Test", "content")

	if !hasEnabledSkills() {
		t.Fatalf("should have enabled skills after creating one")
	}

	mgr.SetSkillEnabled("test-skill", false)

	if hasEnabledSkills() {
		t.Fatalf("should have no enabled skills after disabling all")
	}
}
