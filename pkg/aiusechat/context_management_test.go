// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestDeriveSessionCheatsheetFromMessages(t *testing.T) {
	messages := []uctypes.UIMessage{
		{
			ID:   "user-1",
			Role: "user",
			Parts: []uctypes.UIMessagePart{
				{Type: "text", Text: "帮我修复远端 pip 安装失败的问题"},
			},
		},
		{
			ID:   "assistant-1",
			Role: "assistant",
			Parts: []uctypes.UIMessagePart{
				{
					Type: "data-tooluse",
					Data: uctypes.UIMessageDataToolUse{
						ToolCallId:   "tool-1",
						ToolName:     "wave_get_command_result",
						ToolDesc:     "检查 pip 安装输出",
						Status:       "error",
						ErrorMessage: "Could not find a version that satisfies the requirement",
					},
				},
			},
		},
	}

	cheatsheet := deriveSessionCheatsheet(messages, "failed")
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.CurrentWork == "" {
		t.Fatalf("expected current work to be populated, got %#v", cheatsheet)
	}
	if cheatsheet.BlockedBy == "" {
		t.Fatalf("expected blocked by to be populated, got %#v", cheatsheet)
	}
	if cheatsheet.NextStep == "" {
		t.Fatalf("expected next step to be populated, got %#v", cheatsheet)
	}
}

func TestDeriveSessionCheatsheetUsesInteractionPrompt(t *testing.T) {
	messages := []uctypes.UIMessage{
		{
			ID:   "user-1",
			Role: "user",
			Parts: []uctypes.UIMessagePart{
				{Type: "text", Text: "继续执行远端部署"},
			},
		},
		{
			ID:   "assistant-1",
			Role: "assistant",
			Parts: []uctypes.UIMessagePart{
				{
					Type: "data-tooluse",
					Data: uctypes.UIMessageDataToolUse{
						ToolCallId:    "tool-1",
						ToolName:      "wave_get_command_result",
						ToolDesc:      "等待远端输入密码",
						Status:        "running",
						AwaitingInput: true,
						PromptHint:    "Password:",
					},
				},
			},
		},
	}

	cheatsheet := deriveSessionCheatsheet(messages, "executing")
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.BlockedBy == "" {
		t.Fatalf("expected interaction prompt to be captured, got %#v", cheatsheet)
	}
	if cheatsheet.NextStep != "先补充当前交互输入" {
		t.Fatalf("expected interaction next step, got %#v", cheatsheet)
	}
}

func TestComposeSystemPromptWithCheatsheet(t *testing.T) {
	basePrompt := []string{"Base prompt"}
	meta := &uctypes.UIChatSessionMeta{
		Cheatsheet: &uctypes.SessionCheatsheet{
			CurrentWork: "修复远端安装失败",
			Completed:   "已确认包源可访问",
			BlockedBy:   "当前卡在版本不存在",
			NextStep:    "切换正确版本后重试",
		},
	}

	composed := composeSystemPromptWithCheatsheet(basePrompt, meta)
	if len(composed) != 2 {
		t.Fatalf("expected one extra cheatsheet prompt, got %d prompts", len(composed))
	}
	if composed[0] != "Base prompt" {
		t.Fatalf("expected base prompt to be preserved, got %#v", composed)
	}
	if composed[1] == "" {
		t.Fatalf("expected cheatsheet prompt, got %#v", composed)
	}
}

func TestComposeSystemPromptWithCheatsheetSkipsEmptyCheatsheet(t *testing.T) {
	basePrompt := []string{"Base prompt"}
	meta := &uctypes.UIChatSessionMeta{
		Cheatsheet: &uctypes.SessionCheatsheet{},
	}

	composed := composeSystemPromptWithCheatsheet(basePrompt, meta)
	if len(composed) != 1 {
		t.Fatalf("expected empty cheatsheet to be ignored, got %#v", composed)
	}
}

func TestParseSessionCheatsheetText(t *testing.T) {
	text := "现在在做什么：修复远端安装失败\n已经完成什么：已确认源地址可访问\n当前卡点：版本号不存在\n下一步：切换正确版本后重试"
	cheatsheet := parseSessionCheatsheetText(text)
	if cheatsheet == nil {
		t.Fatal("expected parsed cheatsheet")
	}
	if cheatsheet.CurrentWork != "修复远端安装失败" {
		t.Fatalf("unexpected current work: %#v", cheatsheet)
	}
	if cheatsheet.NextStep != "切换正确版本后重试" {
		t.Fatalf("unexpected next step: %#v", cheatsheet)
	}
}

func TestParseSessionCheatsheetTextReturnsNilForGarbage(t *testing.T) {
	if cheatsheet := parseSessionCheatsheetText("随便一段不成格式的话"); cheatsheet != nil {
		t.Fatalf("expected nil cheatsheet for garbage text, got %#v", cheatsheet)
	}
}
