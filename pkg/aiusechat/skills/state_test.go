// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSkillsManager_StatePersistence(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	mgr.Initialize()

	mgr.SetSkillEnabled("test-skill", false)

	disabledSkill := mgr.GetSkill("test-skill")
	if disabledSkill == nil || disabledSkill.Enabled {
		t.Fatalf("skill should be disabled before reload")
	}

	mgr.Close()

	mgr2 := NewSkillsManager(tmpDir, builtinDir)
	mgr2.Initialize()
	defer mgr2.Close()

	skill := mgr2.GetSkill("test-skill")
	if skill == nil {
		t.Fatalf("skill should exist after reload")
	}
	if skill.Enabled {
		t.Fatalf("skill should be disabled after state reload")
	}
}

func TestSkillsManager_StatePersistence_EnableAfterDisable(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()

	mgr.SetSkillEnabled("test-skill", false)
	mgr.SetSkillEnabled("test-skill", true)

	mgr.Close()

	mgr2 := NewSkillsManager(tmpDir, tmpDir)
	mgr2.Initialize()
	defer mgr2.Close()

	skill := mgr2.GetSkill("test-skill")
	if skill == nil {
		t.Fatalf("skill should exist after reload")
	}
	if !skill.Enabled {
		t.Fatalf("skill should be enabled after toggle back")
	}
}

func TestSkillsManager_StatePersistence_MultipleSkills(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "skill-a", "Skill A", "content a")
	createTestSkill(t, builtinDir, "skill-b", "Skill B", "content b")
	createTestSkill(t, builtinDir, "skill-c", "Skill C", "content c")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	mgr.Initialize()

	mgr.SetSkillEnabled("skill-a", false)
	mgr.SetSkillEnabled("skill-c", false)

	mgr.Close()

	mgr2 := NewSkillsManager(tmpDir, builtinDir)
	mgr2.Initialize()
	defer mgr2.Close()

	if mgr2.GetSkill("skill-a").Enabled {
		t.Fatalf("skill-a should be disabled")
	}
	if !mgr2.GetSkill("skill-b").Enabled {
		t.Fatalf("skill-b should be enabled")
	}
	if mgr2.GetSkill("skill-c").Enabled {
		t.Fatalf("skill-c should be disabled")
	}

	enabled := mgr2.GetEnabledSkills()
	if len(enabled) != 1 || enabled[0].Metadata.Name != "skill-b" {
		t.Fatalf("only skill-b should be enabled, got %d skills", len(enabled))
	}
}

func TestSkillsManager_StatePersistence_DeleteRemovesState(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()

	mgr.CreateUserSkill(SkillMetadata{Name: "temp-skill", Description: "Temp"}, "content")
	mgr.SetSkillEnabled("temp-skill", false)

	state := mgr.GetSkillState("temp-skill")
	if state == nil {
		t.Fatalf("state should exist for temp-skill")
	}
	if state.Enabled {
		t.Fatalf("state should show disabled")
	}

	mgr.DeleteUserSkill("temp-skill")

	state = mgr.GetSkillState("temp-skill")
	if state != nil {
		t.Fatalf("state should be removed after skill deletion")
	}
}

func TestSkillsManager_StatePersistence_NoStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, builtinDir)
	err := mgr.Initialize()
	if err != nil {
		t.Fatalf("initialize should succeed without state file: %v", err)
	}
	defer mgr.Close()

	skill := mgr.GetSkill("test-skill")
	if skill == nil {
		t.Fatalf("skill should exist")
	}
	if !skill.Enabled {
		t.Fatalf("skill should be enabled by default when no state file exists")
	}
}

func TestSkillsManager_StatePersistence_CorruptedStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	builtinDir := filepath.Join(tmpDir, "builtin")
	os.MkdirAll(builtinDir, 0755)
	createTestSkill(t, builtinDir, "test-skill", "Test", "content")

	statePath := filepath.Join(tmpDir, SkillStatesFile)
	os.WriteFile(statePath, []byte("{invalid json}"), 0644)

	mgr := NewSkillsManager(tmpDir, builtinDir)
	err := mgr.Initialize()
	if err != nil {
		t.Fatalf("initialize should handle corrupted state file gracefully: %v", err)
	}
	defer mgr.Close()

	skill := mgr.GetSkill("test-skill")
	if skill == nil {
		t.Fatalf("skill should still load even with corrupted state")
	}
}

func TestSkillsManager_GetAllSkillStates(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "skill-a", "Skill A", "content a")
	createTestSkill(t, tmpDir, "skill-b", "Skill B", "content b")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	defer mgr.Close()

	mgr.SetSkillEnabled("skill-a", false)

	states := mgr.GetAllSkillStates()
	if len(states) != 1 {
		t.Fatalf("expected 1 state entry, got %d", len(states))
	}
	if states["skill-a"] == nil {
		t.Fatalf("state for skill-a should exist")
	}
	if states["skill-a"].Enabled {
		t.Fatalf("skill-a state should show disabled")
	}
}

func TestSkillsManager_StateFileFormat(t *testing.T) {
	tmpDir := t.TempDir()
	createTestSkill(t, tmpDir, "test-skill", "Test", "content")

	mgr := NewSkillsManager(tmpDir, tmpDir)
	mgr.Initialize()
	mgr.SetSkillEnabled("test-skill", false)
	mgr.Close()

	statePath := filepath.Join(tmpDir, SkillStatesFile)
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("failed to read state file: %v", err)
	}

	content := string(data)
	if !containsSubstring(content, `"skillId"`) {
		t.Fatalf("state file should contain skillId field")
	}
	if !containsSubstring(content, `"enabled"`) {
		t.Fatalf("state file should contain enabled field")
	}
}

func containsSubstring(s string, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
