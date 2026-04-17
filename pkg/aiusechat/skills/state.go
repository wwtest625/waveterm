// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

const SkillStatesFile = "skills_state.json"

func (m *SkillsManager) loadSkillStates() error {
	statePath := filepath.Join(m.configDir, SkillStatesFile)
	if !fileExists(statePath) {
		return nil
	}

	data, err := os.ReadFile(statePath)
	if err != nil {
		return fmt.Errorf("failed to read skill states: %w", err)
	}

	var states map[string]*SkillState
	if err := json.Unmarshal(data, &states); err != nil {
		return fmt.Errorf("failed to parse skill states: %w", err)
	}

	m.skillStates = states
	return nil
}

func (m *SkillsManager) saveSkillStates() error {
	statePath := filepath.Join(m.configDir, SkillStatesFile)
	data, err := json.MarshalIndent(m.skillStates, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal skill states: %w", err)
	}

	os.MkdirAll(filepath.Dir(statePath), 0755)
	return os.WriteFile(statePath, data, 0644)
}

func (m *SkillsManager) saveSkillState(skillId string, state *SkillState) {
	m.skillStates[skillId] = state
	if err := m.saveSkillStates(); err != nil {
		log.Printf("[SkillsManager] Warning: failed to save skill state: %v", err)
	}
}

func (m *SkillsManager) deleteSkillState(skillId string) {
	delete(m.skillStates, skillId)
	if err := m.saveSkillStates(); err != nil {
		log.Printf("[SkillsManager] Warning: failed to save skill states after delete: %v", err)
	}
}

func (m *SkillsManager) GetSkillState(skillId string) *SkillState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.skillStates[skillId]
}

func (m *SkillsManager) GetAllSkillStates() map[string]*SkillState {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make(map[string]*SkillState, len(m.skillStates))
	for k, v := range m.skillStates {
		result[k] = v
	}
	return result
}
