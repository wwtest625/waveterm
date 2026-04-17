package aiusechat

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestAskUserToolDefinition(t *testing.T) {
	def := GetAskUserToolDefinition()
	if def.Name != "waveai_ask_user" {
		t.Fatalf("expected tool name waveai_ask_user, got %q", def.Name)
	}
	if def.InputSchema == nil {
		t.Fatal("expected InputSchema to be set")
	}
	props, ok := def.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties in schema")
	}
	if _, hasKind := props["kind"]; !hasKind {
		t.Fatal("expected kind property in schema")
	}
	if _, hasPrompt := props["prompt"]; !hasPrompt {
		t.Fatal("expected prompt property in schema")
	}
	required, ok := def.InputSchema["required"].([]string)
	if !ok {
		t.Fatal("expected required array in schema")
	}
	hasKind := false
	hasPrompt := false
	for _, r := range required {
		if r == "kind" {
			hasKind = true
		}
		if r == "prompt" {
			hasPrompt = true
		}
	}
	if !hasKind || !hasPrompt {
		t.Fatalf("expected kind and prompt to be required, got %v", required)
	}
}

func TestParseAskUserInput_Freeform(t *testing.T) {
	m := map[string]any{
		"kind":   "freeform",
		"prompt": "请提供数据库连接字符串",
	}
	input, err := parseAskUserInput(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input.Kind != "freeform" {
		t.Fatalf("expected freeform, got %q", input.Kind)
	}
	if input.Prompt != "请提供数据库连接字符串" {
		t.Fatalf("unexpected prompt: %q", input.Prompt)
	}
	if !input.Required {
		t.Fatal("expected required=true by default")
	}
}

func TestParseAskUserInput_Select(t *testing.T) {
	m := map[string]any{
		"kind":   "select",
		"prompt": "选择部署环境",
		"options": []any{
			map[string]any{"id": "dev", "label": "开发环境", "value": "development"},
			map[string]any{"id": "prod", "label": "生产环境", "value": "production"},
		},
	}
	input, err := parseAskUserInput(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input.Kind != "select" {
		t.Fatalf("expected select, got %q", input.Kind)
	}
	if len(input.Options) != 2 {
		t.Fatalf("expected 2 options, got %d", len(input.Options))
	}
	if input.Options[0].ID != "dev" || input.Options[0].Label != "开发环境" {
		t.Fatalf("unexpected first option: %#v", input.Options[0])
	}
}

func TestParseAskUserInput_SelectWithRecommended(t *testing.T) {
	m := map[string]any{
		"kind":   "select",
		"prompt": "选择部署环境",
		"options": []any{
			map[string]any{"id": "dev", "label": "开发环境", "value": "development", "recommended": true},
			map[string]any{"id": "prod", "label": "生产环境", "value": "production"},
		},
	}
	input, err := parseAskUserInput(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !input.Options[0].Recommended {
		t.Fatal("expected first option to be recommended")
	}
	if input.Options[1].Recommended {
		t.Fatal("expected second option to NOT be recommended")
	}
}

func TestParseAskUserInput_SelectWithoutOptions(t *testing.T) {
	m := map[string]any{
		"kind":   "select",
		"prompt": "选择部署环境",
	}
	_, err := parseAskUserInput(m)
	if err == nil {
		t.Fatal("expected error for select without options")
	}
	if !strings.Contains(err.Error(), "options are required") {
		t.Fatalf("expected options required error, got %v", err)
	}
}

func TestParseAskUserInput_Confirm(t *testing.T) {
	m := map[string]any{
		"kind":    "confirm",
		"prompt":  "确认要删除生产数据库吗？",
		"default": "no",
	}
	input, err := parseAskUserInput(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input.Kind != "confirm" {
		t.Fatalf("expected confirm, got %q", input.Kind)
	}
	if input.Default != "no" {
		t.Fatalf("expected default=no, got %q", input.Default)
	}
}

func TestParseAskUserInput_InvalidKind(t *testing.T) {
	m := map[string]any{
		"kind":   "invalid",
		"prompt": "test",
	}
	_, err := parseAskUserInput(m)
	if err == nil {
		t.Fatal("expected error for invalid kind")
	}
}

func TestParseAskUserInput_MissingPrompt(t *testing.T) {
	m := map[string]any{
		"kind": "freeform",
	}
	_, err := parseAskUserInput(m)
	if err == nil {
		t.Fatal("expected error for missing prompt")
	}
}

func TestParseAskUserInput_EmptyPrompt(t *testing.T) {
	m := map[string]any{
		"kind":   "freeform",
		"prompt": "",
	}
	_, err := parseAskUserInput(m)
	if err == nil {
		t.Fatal("expected error for empty prompt")
	}
}

func TestParseAskUserInput_Multiselect(t *testing.T) {
	m := map[string]any{
		"kind":    "multiselect",
		"prompt":  "选择需要安装的组件",
		"options": []any{
			map[string]any{"id": "mysql", "label": "MySQL"},
			map[string]any{"id": "redis", "label": "Redis"},
			map[string]any{"id": "nginx", "label": "Nginx"},
		},
		"required": false,
	}
	input, err := parseAskUserInput(m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input.Kind != "multiselect" {
		t.Fatalf("expected multiselect, got %q", input.Kind)
	}
	if len(input.Options) != 3 {
		t.Fatalf("expected 3 options, got %d", len(input.Options))
	}
	if input.Required {
		t.Fatal("expected required=false")
	}
}

func TestSystemPromptMentionsAskUser(t *testing.T) {
	if !strings.Contains(SystemPromptText_ExecutionPolicyAddOn, "waveai_ask_user") {
		t.Fatalf("expected execution policy prompt to mention waveai_ask_user")
	}
	if !strings.Contains(SystemPromptText_ExecutionPolicyAddOn, "Do NOT ask questions in plain text") {
		t.Fatalf("expected execution policy prompt to forbid plain text questions")
	}
}

func TestTruncateStr(t *testing.T) {
	tests := []struct {
		input  string
		maxLen int
		want   string
	}{
		{"hello", 10, "hello"},
		{"hello world", 8, "hello..."},
		{"hello", 5, "hello"},
		{"hello", 3, "hel"},
		{"ab", 2, "ab"},
		{"你好世界测试", 4, "你..."},
		{"你好世界测试", 6, "你好世界测试"},
		{"你好世界测试", 7, "你好世界测试"},
	}
	for _, tt := range tests {
		got := truncateStr(tt.input, tt.maxLen)
		if got != tt.want {
			t.Errorf("truncateStr(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
		}
	}
}

func TestUnblockTaskState_NoSession(t *testing.T) {
	unblockTaskState("nonexistent-chat-id", uctypes.AIOptsType{}, uctypes.TaskProgressStatusActive, nil)
}

func TestGetToolCapabilityPromptMentionsAskUser(t *testing.T) {
	tools := []uctypes.ToolDefinition{
		{Name: "waveai_ask_user"},
	}
	prompt := getToolCapabilityPrompt(tools)
	if !strings.Contains(prompt, "waveai_ask_user") {
		t.Fatalf("expected tool capability prompt to mention waveai_ask_user")
	}
	if !strings.Contains(prompt, "clarification question") {
		t.Fatalf("expected tool capability prompt to describe clarification question")
	}
}
