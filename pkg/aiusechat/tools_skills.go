// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/skills"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wconfig/defaultconfig"
)

var (
	globalSkillsManager     *skills.SkillsManager
	globalSkillsManagerOnce sync.Once
)

func GetGlobalSkillsManager() *skills.SkillsManager {
	globalSkillsManagerOnce.Do(func() {
		configDir := wavebase.GetWaveConfigDir()
		mgr := skills.NewSkillsManager(configDir, "")
		mgr.SetBuiltinFS(defaultconfig.ConfigFS, "skills")
		if err := mgr.Initialize(); err != nil {
			log.Printf("[SkillsManager] Failed to initialize: %v", err)
		}
		globalSkillsManager = mgr
	})
	return globalSkillsManager
}

func SetGlobalSkillsManagerForTest(mgr *skills.SkillsManager) {
	globalSkillsManager = mgr
}

func getSkillsManager() *skills.SkillsManager {
	if globalSkillsManager != nil {
		return globalSkillsManager
	}
	return GetGlobalSkillsManager()
}

func hasEnabledSkills() bool {
	mgr := getSkillsManager()
	if mgr == nil {
		return false
	}
	if len(mgr.GetEnabledSkills()) == 0 {
		return false
	}
	configDir := wavebase.GetWaveConfigDir()
	if configDir != "" {
		fullConfig := wconfig.GetWatcher().GetFullConfig()
		if !fullConfig.Settings.SkillsEnabled {
			return false
		}
	}
	return true
}

type UseSkillToolInput struct {
	SkillName string `json:"skill_name"`
}

type UseSkillToolOutput struct {
	SkillName    string                  `json:"skill_name"`
	Description  string                  `json:"description"`
	Content      string                  `json:"content"`
	Resources    []skills.SkillResource  `json:"resources,omitempty"`
}

type CreateSkillToolInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
}

type CreateSkillToolOutput struct {
	SkillName   string `json:"skill_name"`
	Description string `json:"description"`
	Path        string `json:"path"`
}

func parseUseSkillToolInput(input any) (*UseSkillToolInput, error) {
	result := &UseSkillToolInput{}
	if input == nil {
		return nil, fmt.Errorf("skill_name is required")
	}
	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}
	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}
	if result.SkillName == "" {
		return nil, fmt.Errorf("skill_name is required")
	}
	return result, nil
}

func parseCreateSkillToolInput(input any) (*CreateSkillToolInput, error) {
	result := &CreateSkillToolInput{}
	if input == nil {
		return nil, fmt.Errorf("name and description are required")
	}
	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}
	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}
	if result.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if result.Description == "" {
		return nil, fmt.Errorf("description is required")
	}
	if result.Content == "" {
		return nil, fmt.Errorf("content is required")
	}
	return result, nil
}

func GetUseSkillToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_use_skill",
		DisplayName: "Use Skill",
		Description: "Activate a skill to get its full instructions and resources. Use this when the user's request matches an available skill's purpose. Returns the skill's complete content and any associated resource files (scripts, configs, templates).",
		ToolLogName: "wave:useskill",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"skill_name": map[string]any{
					"type":        "string",
					"description": "Name of the skill to activate (must match an available skill name)",
				},
			},
			"required":             []string{"skill_name"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseUseSkillToolInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("activating skill %q", parsed.SkillName)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseUseSkillToolInput(input)
			if err != nil {
				return nil, err
			}

			mgr := getSkillsManager()
			skill := mgr.GetSkill(parsed.SkillName)
			if skill == nil {
				available := mgr.GetEnabledSkills()
				var names []string
				for _, s := range available {
					names = append(names, s.Metadata.Name)
				}
				return nil, fmt.Errorf("skill %q not found. Available skills: %s", parsed.SkillName, strings.Join(names, ", "))
			}

			if !skill.Enabled {
				return nil, fmt.Errorf("skill %q is currently disabled", parsed.SkillName)
			}

			output := UseSkillToolOutput{
				SkillName:   skill.Metadata.Name,
				Description: skill.Metadata.Description,
				Content:     skill.Content,
				Resources:   skill.Resources,
			}

			return output, nil
		},
	}
}

func GetCreateSkillToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_create_skill",
		DisplayName: "Create Skill",
		Description: "Create a new skill that can be reused in future conversations. Skills are persistent instruction sets stored as SKILL.md files. Use this when the user asks to save a workflow, create a reusable procedure, or define a new capability. The skill will be available for future use via waveai_use_skill.",
		ToolLogName: "wave:createskill",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Short, kebab-case name for the skill (e.g., 'deploy-docker', 'setup-nginx')",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "One-line description of what the skill does and when to use it",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "Full skill instructions in Markdown format. Include step-by-step procedures, code examples, and any context needed to execute the skill.",
				},
			},
			"required":             []string{"name", "description", "content"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseCreateSkillToolInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("creating skill %q", parsed.Name)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseCreateSkillToolInput(input)
			if err != nil {
				return nil, err
			}

			mgr := getSkillsManager()

			existing := mgr.GetSkill(parsed.Name)
			if existing != nil {
				return nil, fmt.Errorf("skill %q already exists. Use a different name or ask the user if they want to update it", parsed.Name)
			}

			metadata := skills.SkillMetadata{
				Name:        parsed.Name,
				Description: parsed.Description,
			}

			skill, err := mgr.CreateUserSkill(metadata, parsed.Content)
			if err != nil {
				return nil, fmt.Errorf("failed to create skill: %w", err)
			}

			output := CreateSkillToolOutput{
				SkillName:   skill.Metadata.Name,
				Description: skill.Metadata.Description,
				Path:        skill.Path,
			}

			return output, nil
		},
	}
}
