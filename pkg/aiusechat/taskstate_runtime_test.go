// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestBuildTaskStateFromToolCalls_InitializesOrderedProgress(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{
		{ID: "tool-1", Name: "read_text_file", ToolUseData: &uctypes.UIMessageDataToolUse{ToolDesc: "Read config"}},
		{ID: "tool-2", Name: "wave_run_command", ToolUseData: &uctypes.UIMessageDataToolUse{ToolDesc: "Run tests"}},
	})
	if state == nil {
		t.Fatal("expected task state")
	}
	if state.CurrentTaskId != "tool-1" {
		t.Fatalf("expected first task to be active, got %q", state.CurrentTaskId)
	}
	if len(state.Tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(state.Tasks))
	}
	if state.Tasks[0].Status != uctypes.TaskItemStatusInProgress {
		t.Fatalf("expected first task in progress, got %q", state.Tasks[0].Status)
	}
	if state.Tasks[1].Status != uctypes.TaskItemStatusPending {
		t.Fatalf("expected second task pending, got %q", state.Tasks[1].Status)
	}
}

func TestBuildTaskStateFromToolCalls_UsesHumanReadableFallbackTitles(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{
		{ID: "tool-1", Name: "wave_run_command", Input: map[string]any{"command": "cd /app && pwd"}},
		{ID: "tool-2", Name: "write_text_file", Input: map[string]any{"filename": "/app/sample.txt"}},
	})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run wave_run_command" {
		t.Fatalf("expected human-readable fallback title, got %q", got)
	}
	if got := state.Tasks[1].Title; got == "Run write_text_file" {
		t.Fatalf("expected human-readable file title, got %q", got)
	}
}

func TestMergeToolTaskStatePrefersExistingSemanticPlan(t *testing.T) {
	existing := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{{
			ID:     "plan-task-1",
			Title:  "创建 Python 脚本",
			Status: uctypes.TaskItemStatusInProgress,
		}},
	}
	fallback := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-1", Name: "wave_run_command"}})
	merged := mergeTaskStateForToolCalls(existing, fallback)
	if merged == nil {
		t.Fatal("expected merged task state")
	}
	if got := merged.Tasks[0].Title; got != "创建 Python 脚本" {
		t.Fatalf("expected semantic task title to win, got %q", got)
	}
}

func TestMergeToolTaskStateUsesFallbackWhenNoSemanticPlanExists(t *testing.T) {
	fallback := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-1", Name: "wave_run_command"}})
	merged := mergeTaskStateForToolCalls(nil, fallback)
	if merged == nil {
		t.Fatal("expected fallback task state")
	}
	if len(merged.Tasks) != 1 {
		t.Fatalf("expected one fallback task, got %d", len(merged.Tasks))
	}
}

func TestAdvanceTaskStateForToolResult_DoesNotOverrideSemanticTitle(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{{
			ID:          "plan-task-1",
			Title:       "创建 Python 脚本",
			Status:      uctypes.TaskItemStatusInProgress,
			ToolCallIds: []string{"tool-1"},
		}},
	}
	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-1"})
	if got := state.Tasks[0].Title; got != "创建 Python 脚本" {
		t.Fatalf("expected semantic title to remain unchanged, got %q", got)
	}
}

func TestAdvanceTaskStateForToolResult_BlocksSemanticTaskWithoutRenamingIt(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{{
			ID:          "plan-task-1",
			Title:       "运行并验证输出",
			Status:      uctypes.TaskItemStatusInProgress,
			ToolCallIds: []string{"tool-9"},
		}},
	}
	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-9", ErrorText: "command failed"})
	if got := state.Tasks[0].Title; got != "运行并验证输出" {
		t.Fatalf("expected semantic title to remain when blocked, got %q", got)
	}
	if state.Tasks[0].Status != uctypes.TaskItemStatusBlocked {
		t.Fatalf("expected blocked task status, got %q", state.Tasks[0].Status)
	}
}

func TestBuildTaskStateFromToolCalls_PrefersToolDescriptionWhenAvailable(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:          "tool-1",
		Name:        "wave_run_command",
		ToolUseData: &uctypes.UIMessageDataToolUse{ToolDesc: "运行并验证输出"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got != "运行并验证输出" {
		t.Fatalf("expected tool description title, got %q", got)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableCommandFallbackInsteadOfToolName(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "wave_run_command",
		Input: map[string]any{"command": "python text_processor.py sample.txt"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run wave_run_command" || got == "wave_run_command" {
		t.Fatalf("expected readable command fallback title, got %q", got)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableFileFallbackInsteadOfToolName(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "write_text_file",
		Input: map[string]any{"filename": "/app/text_processor.py"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run write_text_file" || got == "write_text_file" {
		t.Fatalf("expected readable file fallback title, got %q", got)
	}
}

func TestMergeToolTaskStatePreservesCurrentSemanticPlanAcrossToolBursts(t *testing.T) {
	existing := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-2",
		Tasks: []uctypes.UITaskItem{
			{ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusCompleted},
			{ID: "plan-task-2", Title: "创建测试文件", Status: uctypes.TaskItemStatusInProgress},
		},
	}
	fallback := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-2", Name: "write_text_file", Input: map[string]any{"filename": "/app/sample.txt"}}})
	merged := mergeTaskStateForToolCalls(existing, fallback)
	if merged == nil {
		t.Fatal("expected merged state")
	}
	if got := merged.CurrentTaskId; got != "plan-task-2" {
		t.Fatalf("expected semantic current task to remain, got %q", got)
	}
}

func TestAdvanceTaskStateForToolResult_AdvancesSemanticPlanByBoundToolId(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{
			{ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusInProgress, ToolCallIds: []string{"tool-a"}},
			{ID: "plan-task-2", Title: "创建测试文件", Status: uctypes.TaskItemStatusPending, ToolCallIds: []string{"tool-b"}},
		},
	}
	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-a"})
	if got := state.Tasks[0].Status; got != uctypes.TaskItemStatusCompleted {
		t.Fatalf("expected first semantic task completed, got %q", got)
	}
	if got := state.Tasks[1].Status; got != uctypes.TaskItemStatusInProgress {
		t.Fatalf("expected second semantic task active, got %q", got)
	}
}

func TestBuildTaskStateFromToolCalls_SkipsFallbackForEmptyToolList(t *testing.T) {
	state := buildTaskStateFromToolCalls(nil)
	if state != nil {
		t.Fatalf("expected nil state for empty tool list, got %#v", state)
	}
}

func TestMergeToolTaskStateUsesExistingNonEmptyPlanEvenWhenFallbackPresent(t *testing.T) {
	existing := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Tasks: []uctypes.UITaskItem{{ID: "plan-task-1", Title: "运行并验证输出", Status: uctypes.TaskItemStatusInProgress}},
	}
	fallback := &uctypes.UITaskProgressState{
		PlanId: "fallback-1",
		Source: "system-updated",
		Tasks: []uctypes.UITaskItem{{ID: "tool-1", Title: "执行命令", Status: uctypes.TaskItemStatusInProgress}},
	}
	merged := mergeTaskStateForToolCalls(existing, fallback)
	if merged.PlanId != "plan-1" {
		t.Fatalf("expected existing semantic plan to remain, got %q", merged.PlanId)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableReadFileFallback(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "read_text_file",
		Input: map[string]any{"filename": "/app/sample.txt"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run read_text_file" || got == "read_text_file" {
		t.Fatalf("expected readable read-file title, got %q", got)
	}
}

func TestAdvanceTaskStateForToolResult_DoesNothingWhenToolIdIsUnknown(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{{ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusInProgress, ToolCallIds: []string{"tool-a"}}},
	}
	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "unknown-tool"})
	if got := state.Tasks[0].Status; got != uctypes.TaskItemStatusInProgress {
		t.Fatalf("expected unchanged task status, got %q", got)
	}
}

func TestMergeToolTaskStateReturnsNilWhenBothStatesMissing(t *testing.T) {
	if merged := mergeTaskStateForToolCalls(nil, nil); merged != nil {
		t.Fatalf("expected nil merged state, got %#v", merged)
	}
}

func TestBuildTaskStateFromToolCalls_PrefersReadableDefaultForUnknownTools(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-1", Name: "mystery_tool"}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run mystery_tool" {
		t.Fatalf("expected generic readable fallback, got %q", got)
	}
}

func TestAdvanceTaskStateForToolResult_CompletesPlanWhenLastSemanticTaskFinishes(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{{ID: "plan-task-1", Title: "运行并验证输出", Status: uctypes.TaskItemStatusInProgress, ToolCallIds: []string{"tool-a"}}},
	}
	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-a"})
	if got := state.Status; got != uctypes.TaskProgressStatusCompleted {
		t.Fatalf("expected completed plan status, got %q", got)
	}
}

func TestMergeToolTaskStateKeepsSemanticTitlesEvenIfFallbackHasDifferentTitles(t *testing.T) {
	existing := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Tasks: []uctypes.UITaskItem{{ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusInProgress}},
	}
	fallback := &uctypes.UITaskProgressState{
		PlanId: "fallback-1",
		Source: "system-updated",
		Tasks: []uctypes.UITaskItem{{ID: "tool-1", Title: "执行命令", Status: uctypes.TaskItemStatusInProgress}},
	}
	merged := mergeTaskStateForToolCalls(existing, fallback)
	if got := merged.Tasks[0].Title; got != "创建 Python 脚本" {
		t.Fatalf("expected semantic title to remain, got %q", got)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableDeleteFileFallback(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "delete_text_file",
		Input: map[string]any{"filename": "/app/sample.txt"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run delete_text_file" {
		t.Fatalf("expected readable delete-file title, got %q", got)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableEditFileFallback(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "edit_text_file",
		Input: map[string]any{"filename": "/app/sample.txt"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got == "Run edit_text_file" {
		t.Fatalf("expected readable edit-file title, got %q", got)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableCommandSummary(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "wave_run_command",
		Input: map[string]any{"command": "python text_processor.py sample.txt"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if state.Tasks[0].Title == "执行命令" {
		t.Fatalf("expected command summary to be more specific than generic fallback, got %q", state.Tasks[0].Title)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableWriteFileSummary(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "write_text_file",
		Input: map[string]any{"filename": "/app/text_processor.py"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if state.Tasks[0].Title == "写入文件" {
		t.Fatalf("expected file summary to include path, got %q", state.Tasks[0].Title)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableReadFileSummary(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:    "tool-1",
		Name:  "read_text_file",
		Input: map[string]any{"filename": "/app/sample.txt"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if state.Tasks[0].Title == "读取文件" {
		t.Fatalf("expected file summary to include path, got %q", state.Tasks[0].Title)
	}
}

func TestMergeToolTaskStatePreservesSemanticPlanStatus(t *testing.T) {
	existing := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Status: uctypes.TaskProgressStatusBlocked,
		Tasks: []uctypes.UITaskItem{{ID: "plan-task-1", Title: "运行并验证输出", Status: uctypes.TaskItemStatusBlocked}},
	}
	fallback := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-1", Name: "wave_run_command"}})
	merged := mergeTaskStateForToolCalls(existing, fallback)
	if got := merged.Status; got != uctypes.TaskProgressStatusBlocked {
		t.Fatalf("expected semantic plan status to remain, got %q", got)
	}
}

func TestAdvanceTaskStateForToolResult_UpdatesSummaryForSemanticPlan(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "plan-task-1",
		Tasks: []uctypes.UITaskItem{
			{ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusInProgress, ToolCallIds: []string{"tool-a"}},
			{ID: "plan-task-2", Title: "创建测试文件", Status: uctypes.TaskItemStatusPending, ToolCallIds: []string{"tool-b"}},
		},
	}
	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-a"})
	if got := state.Summary.Completed; got != 1 {
		t.Fatalf("expected summary completed=1, got %d", got)
	}
}

func TestBuildTaskStateFromToolCalls_UsesToolDescriptionBeforeInputParsing(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{
		ID:          "tool-1",
		Name:        "write_text_file",
		Input:       map[string]any{"filename": "/app/text_processor.py"},
		ToolUseData: &uctypes.UIMessageDataToolUse{ToolDesc: "创建 Python 脚本"},
	}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got != "创建 Python 脚本" {
		t.Fatalf("expected tool description to win, got %q", got)
	}
}

func TestMergeToolTaskStateKeepsSemanticPlanEvenWhenFallbackHasMoreTasks(t *testing.T) {
	existing := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Tasks: []uctypes.UITaskItem{{ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusInProgress}},
	}
	fallback := &uctypes.UITaskProgressState{
		PlanId: "fallback-1",
		Source: "system-updated",
		Tasks: []uctypes.UITaskItem{
			{ID: "tool-1", Title: "执行命令", Status: uctypes.TaskItemStatusInProgress},
			{ID: "tool-2", Title: "写入文件 /app/sample.txt", Status: uctypes.TaskItemStatusPending},
		},
	}
	merged := mergeTaskStateForToolCalls(existing, fallback)
	if len(merged.Tasks) != 1 || merged.Tasks[0].Title != "创建 Python 脚本" {
		t.Fatalf("expected semantic plan to remain unchanged, got %#v", merged.Tasks)
	}
}

func TestBuildTaskStateFromToolCalls_UsesReadableUnknownToolFallback(t *testing.T) {
	state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-1", Name: "mystery_tool"}})
	if state == nil {
		t.Fatal("expected task state")
	}
	if got := state.Tasks[0].Title; got != "执行步骤" {
		t.Fatalf("expected generic readable fallback, got %q", got)
	}
}

func TestAdvanceTaskStateForCompletedTool_MarksNextTaskActive(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId:        "plan-1",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: "tool-1",
		Tasks: []uctypes.UITaskItem{
			{ID: "tool-1", Title: "Read config", Status: uctypes.TaskItemStatusInProgress, ToolCallIds: []string{"tool-1"}},
			{ID: "tool-2", Title: "Run tests", Status: uctypes.TaskItemStatusPending, ToolCallIds: []string{"tool-2"}},
		},
	}

	advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-1"})

	if state.Tasks[0].Status != uctypes.TaskItemStatusCompleted {
		t.Fatalf("expected completed first task, got %q", state.Tasks[0].Status)
	}
	if state.Tasks[1].Status != uctypes.TaskItemStatusInProgress {
		t.Fatalf("expected second task in progress, got %q", state.Tasks[1].Status)
	}
	if state.CurrentTaskId != "tool-2" {
		t.Fatalf("expected current task id tool-2, got %q", state.CurrentTaskId)
	}
}
