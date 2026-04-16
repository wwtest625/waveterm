package aiusechat

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestSystemPromptMentionsTodoTools(t *testing.T) {
	if !strings.Contains(SystemPromptText_OpenAI, "waveai_todo_write") {
		t.Fatalf("expected system prompt to mention waveai_todo_write")
	}
	if strings.Contains(SystemPromptText_OpenAI, "waveai_create_plan") {
		t.Fatalf("old tool name waveai_create_plan should be removed from prompt")
	}
	if strings.Contains(SystemPromptText_OpenAI, "waveai_advance_plan") {
		t.Fatalf("old tool name waveai_advance_plan should be removed from prompt")
	}
}

func TestToolCapabilityPromptMentionsTodoRead(t *testing.T) {
	tools := []uctypes.ToolDefinition{
		{Name: "waveai_todo_read"},
	}
	prompt := getToolCapabilityPrompt(tools)
	if !strings.Contains(prompt, "waveai_todo_read") {
		t.Fatalf("expected tool capability prompt to mention waveai_todo_read")
	}
}

func TestSystemPromptContainsSecurityRule(t *testing.T) {
	if !strings.Contains(SystemPromptText_OpenAI, "SECURITY RULE") {
		t.Fatalf("expected system prompt to contain SECURITY RULE")
	}
	if !strings.Contains(SystemPromptText_OpenAI, "命令被安全机制阻止") {
		t.Fatalf("expected system prompt to mention Chinese security block message")
	}
	if !strings.Contains(SystemPromptText_OpenAI, "command_blocked") {
		t.Fatalf("expected system prompt to mention command_blocked")
	}
}

func TestSystemPromptContainsOutputHygiene(t *testing.T) {
	if !strings.Contains(SystemPromptText_OpenAI, "OUTPUT HYGIENE") {
		t.Fatalf("expected system prompt to contain OUTPUT HYGIENE")
	}
}

func TestSystemPromptContainsTodoManagementPrinciples(t *testing.T) {
	if !strings.Contains(SystemPromptText_OpenAI, "Todo Management Principles") {
		t.Fatalf("expected system prompt to contain Todo Management Principles")
	}
	if !strings.Contains(SystemPromptText_OpenAI, "pending → in_progress → completed") {
		t.Fatalf("expected system prompt to mention state flow")
	}
	if !strings.Contains(SystemPromptText_OpenAI, "≥3 concrete steps") {
		t.Fatalf("expected system prompt to mention ≥3 steps threshold")
	}
}

func TestGetToolCapabilityPrompt(t *testing.T) {
	tools := []uctypes.ToolDefinition{
		{Name: "wave_run_command"},
		{Name: "waveai_todo_write"},
		{Name: "waveai_todo_read"},
		{Name: "read_text_file"},
	}
	prompt := getToolCapabilityPrompt(tools)
	if !strings.Contains(prompt, "waveai_todo_write") {
		t.Fatalf("expected tool capability prompt to mention waveai_todo_write")
	}
	if !strings.Contains(prompt, "waveai_todo_read") {
		t.Fatalf("expected tool capability prompt to mention waveai_todo_read")
	}
	if !strings.Contains(prompt, "focus chain state") {
		t.Fatalf("expected tool capability prompt to mention focus chain state for todo_read")
	}
	if !strings.Contains(prompt, "wave_run_command") {
		t.Fatalf("expected tool capability prompt to mention wave_run_command")
	}
}

func TestGetToolCapabilityPromptEmpty(t *testing.T) {
	prompt := getToolCapabilityPrompt(nil)
	if prompt != "" {
		t.Fatalf("expected empty prompt for no tools, got: %s", prompt)
	}
}
