// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func createTestSkill(t *testing.T, dir string, name string, description string, content string) string {
	t.Helper()
	skillDir := filepath.Join(dir, name)
	os.MkdirAll(skillDir, 0755)

	skillContent := "---\nname: " + name + "\ndescription: " + description + "\n---\n\n" + content
	skillPath := filepath.Join(skillDir, SkillFileName)
	if err := os.WriteFile(skillPath, []byte(skillContent), 0644); err != nil {
		t.Fatalf("failed to create test skill: %v", err)
	}
	return skillPath
}

func createTestSkillWithResource(t *testing.T, dir string, name string, description string, content string, resourceName string, resourceContent string) string {
	t.Helper()
	skillDir := filepath.Join(dir, name)
	os.MkdirAll(skillDir, 0755)

	skillContent := "---\nname: " + name + "\ndescription: " + description + "\n---\n\n" + content
	skillPath := filepath.Join(skillDir, SkillFileName)
	if err := os.WriteFile(skillPath, []byte(skillContent), 0644); err != nil {
		t.Fatalf("failed to create test skill: %v", err)
	}

	if resourceName != "" {
		resDir := filepath.Join(skillDir, filepath.Dir(resourceName))
		os.MkdirAll(resDir, 0755)
		resPath := filepath.Join(skillDir, resourceName)
		if err := os.WriteFile(resPath, []byte(resourceContent), 0644); err != nil {
			t.Fatalf("failed to create test resource: %v", err)
		}
	}

	return skillPath
}

func TestSkillsManager_ParseSkillFile(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "test-skill", "A test skill", "## Steps\n1. Do something\n2. Do another thing\n")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	result := mgr.ParseSkillFile(filepath.Join(tmpDir, "test-skill", SkillFileName))

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.Skill.Metadata.Name != "test-skill" {
		t.Fatalf("name mismatch: got %s", result.Skill.Metadata.Name)
	}
	if result.Skill.Metadata.Description != "A test skill" {
		t.Fatalf("description mismatch: got %s", result.Skill.Metadata.Description)
	}
	if !strings.Contains(result.Skill.Content, "Do something") {
		t.Fatalf("content should contain 'Do something', got: %s", result.Skill.Content)
	}
}

func TestSkillsManager_ParseSkillFile_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	result := mgr.ParseSkillFile(filepath.Join(tmpDir, "nonexistent", SkillFileName))

	if result.Success {
		t.Fatalf("expected failure for nonexistent file")
	}
	if !strings.Contains(result.Error, "File not found") {
		t.Fatalf("error should mention 'File not found', got: %s", result.Error)
	}
}

func TestSkillsManager_ParseSkillFile_NoFrontmatter(t *testing.T) {
	tmpDir := t.TempDir()
	skillDir := filepath.Join(tmpDir, "no-frontmatter")
	os.MkdirAll(skillDir, 0755)

	content := "# my-skill\n\nThis is a skill without frontmatter.\n\n## Steps\n1. Step one\n"
	skillPath := filepath.Join(skillDir, SkillFileName)
	os.WriteFile(skillPath, []byte(content), 0644)

	mgr := NewSkillsManager(tmpDir, tmpDir)
	result := mgr.ParseSkillFile(skillPath)

	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.Skill.Metadata.Name != "my-skill" {
		t.Fatalf("name should be extracted from heading, got: %s", result.Skill.Metadata.Name)
	}
}

func TestSkillsManager_ParseSkillFile_InvalidMetadata(t *testing.T) {
	tmpDir := t.TempDir()
	skillDir := filepath.Join(tmpDir, "invalid")
	os.MkdirAll(skillDir, 0755)

	content := "---\nname: \"\"\n---\n\nSome content"
	skillPath := filepath.Join(skillDir, SkillFileName)
	os.WriteFile(skillPath, []byte(content), 0644)

	mgr := NewSkillsManager(tmpDir, tmpDir)
	result := mgr.ParseSkillFile(skillPath)

	if result.Success {
		t.Fatalf("expected failure for invalid metadata")
	}
	if !strings.Contains(result.Error, "Invalid skill metadata") {
		t.Fatalf("error should mention invalid metadata, got: %s", result.Error)
	}
}

func TestSkillsManager_InitializeAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)

	createTestSkill(t, builtinDir, "builtin-skill", "A built-in skill", "Builtin content")
	createTestSkill(t, builtinDir, "another-skill", "Another built-in skill", "More content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	err := mgr.Initialize()
	if err != nil {
		t.Fatalf("initialize failed: %v", err)
	}
	defer mgr.Close()

	allSkills := mgr.GetAllSkills()
	if len(allSkills) != 2 {
		t.Fatalf("expected 2 skills, got %d", len(allSkills))
	}

	skill := mgr.GetSkill("builtin-skill")
	if skill == nil {
		t.Fatalf("builtin-skill should exist")
	}
	if skill.Metadata.Description != "A built-in skill" {
		t.Fatalf("description mismatch: got %s", skill.Metadata.Description)
	}
}

func TestSkillsManager_EnableDisable(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	if err := mgr.SetSkillEnabled("test-skill", false); err != nil {
		t.Fatalf("failed to disable skill: %v", err)
	}

	skill := mgr.GetSkill("test-skill")
	if skill == nil {
		t.Fatalf("skill should exist")
	}
	if skill.Enabled {
		t.Fatalf("skill should be disabled")
	}

	enabled := mgr.GetEnabledSkills()
	if len(enabled) != 0 {
		t.Fatalf("expected 0 enabled skills, got %d", len(enabled))
	}

	if err := mgr.SetSkillEnabled("test-skill", true); err != nil {
		t.Fatalf("failed to enable skill: %v", err)
	}

	skill = mgr.GetSkill("test-skill")
	if !skill.Enabled {
		t.Fatalf("skill should be enabled")
	}
}

func TestSkillsManager_EnableDisable_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	err := mgr.SetSkillEnabled("nonexistent", true)
	if err == nil {
		t.Fatalf("expected error for nonexistent skill")
	}
}

func TestSkillsManager_CreateUserSkill(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	metadata := SkillMetadata{
		Name:        "my-skill",
		Description: "My custom skill",
	}
	content := "## Instructions\nDo the thing."

	skill, err := mgr.CreateUserSkill(metadata, content)
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}
	if skill.Metadata.Name != "my-skill" {
		t.Fatalf("name mismatch: got %s", skill.Metadata.Name)
	}
	if !skill.Enabled {
		t.Fatalf("new skill should be enabled by default")
	}

	retrieved := mgr.GetSkill("my-skill")
	if retrieved == nil {
		t.Fatalf("skill should exist after creation")
	}

	skillPath := filepath.Join(tmpDir, SkillsDirName, "my-skill", SkillFileName)
	if !fileExists(skillPath) {
		t.Fatalf("skill file should exist at %s", skillPath)
	}
}

func TestSkillsManager_DeleteUserSkill(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	metadata := SkillMetadata{Name: "my-skill", Description: "My custom skill"}
	mgr.CreateUserSkill(metadata, "content")

	err := mgr.DeleteUserSkill("my-skill")
	if err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	if mgr.GetSkill("my-skill") != nil {
		t.Fatalf("skill should be deleted")
	}
}

func TestSkillsManager_DeleteBuiltInSkill(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "builtin-skill", "Builtin", "content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	mgr.Initialize()
	defer mgr.Close()

	err := mgr.DeleteUserSkill("builtin-skill")
	if err == nil {
		t.Fatalf("expected error when deleting built-in skill")
	}
	if !strings.Contains(err.Error(), "cannot delete built-in skill") {
		t.Fatalf("error should mention built-in skill, got: %v", err)
	}
}

func TestSkillsManager_UpdateUserSkill(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	metadata := SkillMetadata{Name: "my-skill", Description: "Original desc"}
	mgr.CreateUserSkill(metadata, "original content")

	newMetadata := SkillMetadata{Name: "my-skill", Description: "Updated desc"}
	err := mgr.UpdateUserSkill("my-skill", newMetadata, "updated content")
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}

	skill := mgr.GetSkill("my-skill")
	if skill.Metadata.Description != "Updated desc" {
		t.Fatalf("description should be updated, got: %s", skill.Metadata.Description)
	}
	if skill.Content != "updated content" {
		t.Fatalf("content should be updated, got: %s", skill.Content)
	}
}

func TestSkillsManager_UpdateBuiltInSkill(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "builtin-skill", "Builtin", "content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	mgr.Initialize()
	defer mgr.Close()

	newMetadata := SkillMetadata{Name: "builtin-skill", Description: "Updated"}
	err := mgr.UpdateUserSkill("builtin-skill", newMetadata, "updated content")
	if err == nil {
		t.Fatalf("expected error when updating built-in skill")
	}
}

func TestSkillsManager_BuildSkillsPrompt(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "deploy-docker", "Deploy Docker containers", "content")
	createTestSkill(t, builtinDir, "setup-nginx", "Setup Nginx", "content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	mgr.Initialize()
	defer mgr.Close()

	prompt := mgr.BuildSkillsPrompt()
	if !strings.Contains(prompt, "AVAILABLE SKILLS") {
		t.Fatalf("prompt should contain AVAILABLE SKILLS")
	}
	if !strings.Contains(prompt, "deploy-docker") {
		t.Fatalf("prompt should contain deploy-docker")
	}
	if !strings.Contains(prompt, "setup-nginx") {
		t.Fatalf("prompt should contain setup-nginx")
	}
	if !strings.Contains(prompt, "waveai_use_skill") {
		t.Fatalf("prompt should mention waveai_use_skill tool")
	}
}

func TestSkillsManager_BuildSkillsPrompt_Empty(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	prompt := mgr.BuildSkillsPrompt()
	if prompt != "" {
		t.Fatalf("prompt should be empty when no skills, got: %s", prompt)
	}
}

func TestSkillsManager_BuildSkillsPrompt_DisabledSkill(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	mgr.SetSkillEnabled("test-skill", false)

	prompt := mgr.BuildSkillsPrompt()
	if prompt != "" {
		t.Fatalf("prompt should be empty when all skills disabled, got: %s", prompt)
	}
}

func TestSkillsManager_ResourcesScanning(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkillWithResource(t, tmpDir, "skill-with-resources", "Has resources", "content",
		"scripts/setup.sh", "#!/bin/bash\necho hello")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	skill := mgr.GetSkill("skill-with-resources")
	if skill == nil {
		t.Fatalf("skill should exist")
	}
	if len(skill.Resources) != 1 {
		t.Fatalf("expected 1 resource, got %d", len(skill.Resources))
	}
	if skill.Resources[0].Name != "scripts/setup.sh" {
		t.Fatalf("resource name mismatch: got %s", skill.Resources[0].Name)
	}
	if skill.Resources[0].Type != SkillResourceScript {
		t.Fatalf("resource type mismatch: got %s", skill.Resources[0].Type)
	}
	if skill.Resources[0].Content != "#!/bin/bash\necho hello" {
		t.Fatalf("resource content mismatch: got %s", skill.Resources[0].Content)
	}
}

func TestSkillsManager_GetSkillResourceContent(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkillWithResource(t, tmpDir, "skill-with-resources", "Has resources", "content",
		"config.yaml", "key: value")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	content, err := mgr.GetSkillResourceContent("skill-with-resources", "config.yaml")
	if err != nil {
		t.Fatalf("failed to get resource content: %v", err)
	}
	if content != "key: value" {
		t.Fatalf("resource content mismatch: got %s", content)
	}
}

func TestSkillsManager_GetSkillResourceContent_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	_, err := mgr.GetSkillResourceContent("test-skill", "nonexistent.txt")
	if err == nil {
		t.Fatalf("expected error for nonexistent resource")
	}
}

func TestSkillsManager_IsUserSkill(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "builtin-skill", "Builtin", "content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	mgr.Initialize()
	defer mgr.Close()

	mgr.CreateUserSkill(SkillMetadata{Name: "user-skill", Description: "User"}, "content")

	if mgr.IsUserSkill("builtin-skill") {
		t.Fatalf("builtin-skill should not be a user skill")
	}
	if !mgr.IsUserSkill("user-skill") {
		t.Fatalf("user-skill should be a user skill")
	}
	if mgr.IsUserSkill("nonexistent") {
		t.Fatalf("nonexistent should not be a user skill")
	}
}

func TestSkillsManager_ImportSkillZip(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	zipDir := t.TempDir()
	skillDir := filepath.Join(zipDir, "imported-skill")
	os.MkdirAll(skillDir, 0755)
	skillContent := "---\nname: imported-skill\ndescription: An imported skill\n---\n\nImported content"
	os.WriteFile(filepath.Join(skillDir, SkillFileName), []byte(skillContent), 0644)
	os.WriteFile(filepath.Join(skillDir, "setup.sh"), []byte("#!/bin/bash\necho imported"), 0644)

	zipPath := filepath.Join(t.TempDir(), "skill.zip")
	zipFile, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("failed to create zip: %v", err)
	}
	w := zip.NewWriter(zipFile)
	addFileToZip(t, w, filepath.Join(skillDir, SkillFileName), "imported-skill/"+SkillFileName)
	addFileToZip(t, w, filepath.Join(skillDir, "setup.sh"), "imported-skill/setup.sh")
	w.Close()
	zipFile.Close()

	result := mgr.ImportSkillZip(zipPath, false)
	if !result.Success {
		t.Fatalf("import failed: %s (code: %s)", result.Error, result.ErrorCode)
	}
	if result.SkillName != "imported-skill" {
		t.Fatalf("skill name mismatch: got %s", result.SkillName)
	}

	skill := mgr.GetSkill("imported-skill")
	if skill == nil {
		t.Fatalf("imported skill should exist")
	}
	if skill.Metadata.Description != "An imported skill" {
		t.Fatalf("description mismatch: got %s", skill.Metadata.Description)
	}
}

func TestSkillsManager_ImportSkillZip_NoSkillMd(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	zipPath := filepath.Join(t.TempDir(), "empty.zip")
	zipFile, _ := os.Create(zipPath)
	w := zip.NewWriter(zipFile)
	w.Close()
	zipFile.Close()

	result := mgr.ImportSkillZip(zipPath, false)
	if result.Success {
		t.Fatalf("import should fail without SKILL.md")
	}
	if result.ErrorCode != SkillImportErrorNoSkillMd {
		t.Fatalf("error code should be NO_SKILL_MD, got %s", result.ErrorCode)
	}
}

func TestSkillsManager_ImportSkillZip_DirExists(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	mgr.CreateUserSkill(SkillMetadata{Name: "existing-skill", Description: "Existing"}, "content")

	zipDir := t.TempDir()
	skillDir := filepath.Join(zipDir, "existing-skill")
	os.MkdirAll(skillDir, 0755)
	skillContent := "---\nname: existing-skill\ndescription: New version\n---\n\nNew content"
	os.WriteFile(filepath.Join(skillDir, SkillFileName), []byte(skillContent), 0644)

	zipPath := filepath.Join(t.TempDir(), "skill.zip")
	zipFile, _ := os.Create(zipPath)
	w := zip.NewWriter(zipFile)
	addFileToZip(t, w, filepath.Join(skillDir, SkillFileName), "existing-skill/"+SkillFileName)
	w.Close()
	zipFile.Close()

	result := mgr.ImportSkillZip(zipPath, false)
	if result.Success {
		t.Fatalf("import should fail when directory exists without overwrite")
	}
	if result.ErrorCode != SkillImportErrorDirExists {
		t.Fatalf("error code should be DIR_EXISTS, got %s", result.ErrorCode)
	}

	result = mgr.ImportSkillZip(zipPath, true)
	if !result.Success {
		t.Fatalf("import should succeed with overwrite, got: %s", result.Error)
	}
}

func TestSkillsManager_ValidateMetadata(t *testing.T) {
	mgr := NewSkillsManager(t.TempDir(), t.TempDir())

	valid := mgr.ValidateMetadata(SkillMetadata{Name: "test", Description: "A test"})
	if !valid.Valid {
		t.Fatalf("should be valid")
	}

	noName := mgr.ValidateMetadata(SkillMetadata{Name: "", Description: "A test"})
	if noName.Valid {
		t.Fatalf("should be invalid without name")
	}

	noDesc := mgr.ValidateMetadata(SkillMetadata{Name: "test", Description: ""})
	if noDesc.Valid {
		t.Fatalf("should be invalid without description")
	}
}

func TestSkillsManager_MultipleDirectories(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "builtin-skill", "Builtin", "content")

	userDir := tmpDir
	createTestSkill(t, filepath.Join(userDir, SkillsDirName), "user-skill", "User", "user content")

	mgr := NewSkillsManager(userDir, builtinDir)
	mgr.Initialize()
	defer mgr.Close()

	allSkills := mgr.GetAllSkills()
	if len(allSkills) != 2 {
		t.Fatalf("expected 2 skills, got %d", len(allSkills))
	}

	builtin := mgr.GetSkill("builtin-skill")
	if builtin == nil {
		t.Fatalf("builtin-skill should exist")
	}

	user := mgr.GetSkill("user-skill")
	if user == nil {
		t.Fatalf("user-skill should exist")
	}
}

func TestSkillsManager_UserSkillNameSanitization(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	metadata := SkillMetadata{Name: "My Cool Skill!!!", Description: "Test"}
	skill, err := mgr.CreateUserSkill(metadata, "content")
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	expectedDir := filepath.Join(tmpDir, SkillsDirName, "my-cool-skill")
	if skill.Directory != expectedDir {
		t.Fatalf("directory should be sanitized, got: %s", skill.Directory)
	}
}

func addFileToZip(t *testing.T, w *zip.Writer, filePath string, zipPath string) {
	t.Helper()
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed to read file for zip: %v", err)
	}
	f, err := w.Create(zipPath)
	if err != nil {
		t.Fatalf("failed to create zip entry: %v", err)
	}
	f.Write(data)
}
