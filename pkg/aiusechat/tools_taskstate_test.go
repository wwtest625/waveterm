package aiusechat

import (
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestGetTodoWriteToolDefinition_UsesOpenAICompatibleStrictSchema(t *testing.T) {
	tool := GetTodoWriteToolDefinition("chat-1", &uctypes.AIOptsType{})
	properties, ok := tool.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map, got %#v", tool.InputSchema["properties"])
	}
	required, ok := tool.InputSchema["required"].([]string)
	if !ok {
		t.Fatalf("expected required []string, got %#v", tool.InputSchema["required"])
	}
	requiredSet := make(map[string]bool, len(required))
	for _, key := range required {
		requiredSet[key] = true
	}
	for _, key := range []string{"todos"} {
		if !requiredSet[key] {
			t.Fatalf("expected required field %q missing, got %#v", key, required)
		}
	}
	if _, exists := properties["todos"]; !exists {
		t.Fatalf("expected 'todos' property in schema")
	}
	todosSchema, ok := properties["todos"].(map[string]any)
	if !ok {
		t.Fatalf("expected todos schema map, got %#v", properties["todos"])
	}
	itemsSchema, ok := todosSchema["items"].(map[string]any)
	if !ok {
		t.Fatalf("expected todos items schema map, got %#v", todosSchema["items"])
	}
	todoRequired, ok := itemsSchema["required"].([]string)
	if !ok {
		t.Fatalf("expected todo item required []string, got %#v", itemsSchema["required"])
	}
	if !slices.Contains(todoRequired, "description") {
		t.Fatalf("expected todo description to be required, got %#v", todoRequired)
	}
	todoProperties, ok := itemsSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected todo item properties map, got %#v", itemsSchema["properties"])
	}
	subtasksSchema, ok := todoProperties["subtasks"].(map[string]any)
	if !ok {
		t.Fatalf("expected subtasks schema map, got %#v", todoProperties["subtasks"])
	}
	subtaskItemsSchema, ok := subtasksSchema["items"].(map[string]any)
	if !ok {
		t.Fatalf("expected subtask items schema map, got %#v", subtasksSchema["items"])
	}
	subtaskRequired, ok := subtaskItemsSchema["required"].([]string)
	if !ok {
		t.Fatalf("expected subtask required []string, got %#v", subtaskItemsSchema["required"])
	}
	if !slices.Contains(subtaskRequired, "description") {
		t.Fatalf("expected subtask description to be required, got %#v", subtaskRequired)
	}
	if _, exists := properties["auto_focus"]; !exists {
		t.Fatalf("expected 'auto_focus' property in schema")
	}
	if tool.InputSchema["additionalProperties"] != false {
		t.Fatalf("expected additionalProperties=false for strict schema")
	}
}

func TestGetTodoReadToolDefinition_UsesOpenAICompatibleStrictSchema(t *testing.T) {
	tool := GetTodoReadToolDefinition("chat-1", &uctypes.AIOptsType{})
	properties, ok := tool.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map, got %#v", tool.InputSchema["properties"])
	}
	if _, exists := properties["include_details"]; !exists {
		t.Fatalf("expected 'include_details' property in schema")
	}
	if tool.InputSchema["additionalProperties"] != false {
		t.Fatalf("expected additionalProperties=false for strict schema")
	}
}

func TestTodoWriteTool_CreatesFullTaskList(t *testing.T) {
	input := map[string]any{
		"todos": []any{
			map[string]any{"id": "t1", "content": "安装 MySQL", "description": "使用 apt 安装 MySQL 8.0", "status": "pending", "priority": "high"},
			map[string]any{"id": "t2", "content": "配置 my.cnf", "description": "调整 innodb_buffer_pool_size", "status": "pending", "priority": "high"},
			map[string]any{"id": "t3", "content": "启动并验证", "description": "systemctl start mysql && mysql -e 'SELECT 1'", "status": "pending", "priority": "medium"},
		},
		"auto_focus": true,
	}
	parsed, err := parseTodoWriteInput(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	state := buildTodoTaskState(parsed)
	if len(state.Tasks) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(state.Tasks))
	}
	if state.Tasks[0].Description != "使用 apt 安装 MySQL 8.0" {
		t.Fatalf("description not preserved, got %q", state.Tasks[0].Description)
	}
	if state.Tasks[0].Priority != uctypes.TaskItemPriorityHigh {
		t.Fatalf("priority not preserved, got %q", state.Tasks[0].Priority)
	}
	if !state.Tasks[0].IsFocused {
		t.Fatalf("first task should be auto-focused")
	}
	if state.Tasks[0].Status != uctypes.TaskItemStatusInProgress {
		t.Fatalf("first task should be in_progress after auto-focus, got %q", state.Tasks[0].Status)
	}
	if state.Tasks[0].CreatedTs == 0 {
		t.Fatalf("createdts should be set")
	}
	if state.Tasks[0].UpdatedTs == 0 {
		t.Fatalf("updatedts should be set")
	}
	if state.FocusChain == nil {
		t.Fatalf("focuschain should be set")
	}
	if state.FocusChain.FocusedTodoId != "t1" {
		t.Fatalf("focuschain focusedtodoid should be t1, got %q", state.FocusChain.FocusedTodoId)
	}
}

func TestTodoWriteTool_AutoFocusSetsFirstPending(t *testing.T) {
	input := map[string]any{
		"todos": []any{
			map[string]any{"id": "t1", "content": "Task 1", "status": "completed", "priority": "high"},
			map[string]any{"id": "t2", "content": "Task 2", "status": "pending", "priority": "medium"},
			map[string]any{"id": "t3", "content": "Task 3", "status": "pending", "priority": "low"},
		},
		"auto_focus": true,
	}
	parsed, _ := parseTodoWriteInput(input)
	state := buildTodoTaskState(parsed)
	if state.Tasks[0].IsFocused {
		t.Fatalf("completed task should not be focused")
	}
	if !state.Tasks[1].IsFocused {
		t.Fatalf("first pending task should be auto-focused")
	}
	if state.Tasks[1].Status != uctypes.TaskItemStatusInProgress {
		t.Fatalf("first pending task should be promoted to in_progress")
	}
}

func TestTodoWriteTool_ExplicitInProgressGetsFocus(t *testing.T) {
	input := map[string]any{
		"todos": []any{
			map[string]any{"id": "t1", "content": "Task 1", "status": "pending", "priority": "high"},
			map[string]any{"id": "t2", "content": "Task 2", "status": "in_progress", "priority": "medium"},
			map[string]any{"id": "t3", "content": "Task 3", "status": "pending", "priority": "low"},
		},
	}
	parsed, _ := parseTodoWriteInput(input)
	state := buildTodoTaskState(parsed)
	if state.Tasks[0].IsFocused {
		t.Fatalf("pending task should not be focused")
	}
	if !state.Tasks[1].IsFocused {
		t.Fatalf("in_progress task should be focused")
	}
	if state.CurrentTaskId != "t2" {
		t.Fatalf("currenttaskid should be t2, got %q", state.CurrentTaskId)
	}
}

func TestTodoWriteTool_AllPendingReminder(t *testing.T) {
	input := map[string]any{
		"todos": []any{
			map[string]any{"id": "t1", "content": "安装 MySQL", "status": "pending", "priority": "high"},
			map[string]any{"id": "t2", "content": "配置 my.cnf", "status": "pending", "priority": "high"},
			map[string]any{"id": "t3", "content": "启动并验证", "status": "pending", "priority": "medium"},
		},
	}
	parsed, _ := parseTodoWriteInput(input)
	state := buildTodoTaskState(parsed)
	reminder := buildTodoWriteReminder(state, parsed)
	if reminder == "" {
		t.Fatalf("expected reminder for all-pending tasks with ≥3 items")
	}
}

func TestHasChineseContent(t *testing.T) {
	if !hasChineseContent("安装 MySQL") {
		t.Fatalf("should detect Chinese")
	}
	if hasChineseContent("Install MySQL") {
		t.Fatalf("should not detect Chinese in English text")
	}
}

func TestGenerateTabStateAndTools_IncludesTodoTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(nil, "", false, &uctypes.WaveChatOpts{
		ChatId: "chat-1",
		Config: uctypes.AIOptsType{APIType: uctypes.APIType_OpenAIResponses, Model: "gpt-5-mini"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	if !slices.Contains(names, "waveai_todo_write") {
		t.Fatalf("expected waveai_todo_write in tool list, got %#v", names)
	}
	if !slices.Contains(names, "waveai_todo_read") {
		t.Fatalf("expected waveai_todo_read in tool list, got %#v", names)
	}
	if slices.Contains(names, "waveai_create_plan") {
		t.Fatalf("old waveai_create_plan should be removed, got %#v", names)
	}
	if slices.Contains(names, "waveai_advance_plan") {
		t.Fatalf("old waveai_advance_plan should be removed, got %#v", names)
	}
}
