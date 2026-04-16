// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
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

func TestNewContextUsageInfo(t *testing.T) {
	info := NewContextUsageInfo(30000, 10000, 100000)
	if info.InputTokens != 30000 {
		t.Errorf("expected 30000 input tokens, got %d", info.InputTokens)
	}
	if info.OutputTokens != 10000 {
		t.Errorf("expected 10000 output tokens, got %d", info.OutputTokens)
	}
	if info.MaxTokens != 100000 {
		t.Errorf("expected 100000 max tokens, got %d", info.MaxTokens)
	}
	if info.UsagePercent != 40 {
		t.Errorf("expected 40%% usage, got %d%%", info.UsagePercent)
	}
	if info.TotalTokens() != 40000 {
		t.Errorf("expected 40000 total tokens, got %d", info.TotalTokens())
	}
}

func TestNewContextUsageInfo_ZeroMaxTokens(t *testing.T) {
	info := NewContextUsageInfo(5000, 5000, 0)
	if info.UsagePercent != 0 {
		t.Errorf("expected 0%% usage with zero max tokens, got %d%%", info.UsagePercent)
	}
}

func TestNewContextUsageInfo_CappedAt100(t *testing.T) {
	info := NewContextUsageInfo(80000, 30000, 100000)
	if info.UsagePercent != 100 {
		t.Errorf("expected 100%% usage when over max, got %d%%", info.UsagePercent)
	}
}

func TestUpdateContextTrackerFromUsage(t *testing.T) {
	level := UpdateContextTrackerFromUsage("test-tracker-usage-a", ContextUsageInfo{
		InputTokens:  35000,
		OutputTokens: 25000,
		MaxTokens:    100000,
	})
	if level != ContextLevelWarning {
		t.Errorf("expected warning level at 60%%, got %q", level)
	}

	level = UpdateContextTrackerFromUsage("test-tracker-usage-b", ContextUsageInfo{
		InputTokens:  40000,
		OutputTokens: 35000,
		MaxTokens:    100000,
	})
	if level != ContextLevelCritical {
		t.Errorf("expected critical level at 75%%, got %q", level)
	}
}

func TestBuildContextWarningPrompt(t *testing.T) {
	tests := []struct {
		level    ContextThresholdLevel
		wantEmpty bool
	}{
		{ContextLevelNormal, true},
		{ContextLevelWarning, false},
		{ContextLevelCritical, false},
		{ContextLevelMaximum, false},
	}
	info := NewContextUsageInfo(75000, 25000, 100000)
	for _, test := range tests {
		prompt := BuildContextWarningPrompt(test.level, info)
		if test.wantEmpty && prompt != "" {
			t.Errorf("expected empty prompt for %q, got %q", test.level, prompt)
		}
		if !test.wantEmpty && prompt == "" {
			t.Errorf("expected non-empty prompt for %q", test.level)
		}
	}
}

func TestShouldTruncate(t *testing.T) {
	if ShouldTruncate(ContextLevelNormal) {
		t.Error("should not truncate at normal level")
	}
	if ShouldTruncate(ContextLevelWarning) {
		t.Error("should not truncate at warning level")
	}
	if !ShouldTruncate(ContextLevelCritical) {
		t.Error("should truncate at critical level")
	}
	if !ShouldTruncate(ContextLevelMaximum) {
		t.Error("should truncate at maximum level")
	}
}

func TestPlanTruncation_NoTruncationWhenNormal(t *testing.T) {
	messages := makeTestMessages(10)
	plan := PlanTruncation(messages, ContextLevelNormal)
	if plan.Strategy != TruncationStrategyNone {
		t.Errorf("expected none strategy at normal level, got %q", plan.Strategy)
	}
}

func TestPlanTruncation_NoTruncationWhenFewTurns(t *testing.T) {
	messages := makeTestMessages(1)
	plan := PlanTruncation(messages, ContextLevelCritical)
	if plan.Strategy != TruncationStrategyNone {
		t.Errorf("expected none strategy with few turns, got %q", plan.Strategy)
	}
}

func TestPlanTruncation_SummarizeWhenCritical(t *testing.T) {
	messages := makeTestMessages(10)
	plan := PlanTruncation(messages, ContextLevelCritical)
	if plan.Strategy != TruncationStrategySummarize {
		t.Errorf("expected summarize strategy at critical level, got %q", plan.Strategy)
	}
	if plan.DroppedTurns == 0 {
		t.Error("expected some dropped turns")
	}
	if plan.KeepFromIndex <= 0 {
		t.Error("expected keep from index > 0")
	}
	if plan.SummaryText == "" {
		t.Error("expected summary text")
	}
	if plan.Reason == "" {
		t.Error("expected reason")
	}
}

func TestPlanTruncation_SummarizeWhenMaximum(t *testing.T) {
	messages := makeTestMessages(10)
	plan := PlanTruncation(messages, ContextLevelMaximum)
	if plan.Strategy != TruncationStrategySummarize {
		t.Errorf("expected summarize strategy at maximum level, got %q", plan.Strategy)
	}
}

func TestApplyTruncation_NoneStrategy(t *testing.T) {
	messages := makeTestMessages(5)
	plan := TruncationPlan{Strategy: TruncationStrategyNone}
	result := ApplyTruncation(messages, plan)
	if len(result) != len(messages) {
		t.Errorf("expected same message count, got %d vs %d", len(result), len(messages))
	}
}

func TestApplyTruncation_SummarizeStrategy(t *testing.T) {
	messages := makeTestMessages(10)
	plan := TruncationPlan{
		Strategy:      TruncationStrategySummarize,
		KeepFromIndex: 6,
		DroppedTurns:  6,
		SummaryText:   "之前对话摘要：\nuser asked something\nassistant responded",
		Reason:        "test truncation",
	}
	result := ApplyTruncation(messages, plan)
	if len(result) >= len(messages) {
		t.Errorf("expected fewer messages after truncation, got %d vs %d", len(result), len(messages))
	}
	if len(result) < 2 {
		t.Errorf("expected at least summary + some kept messages, got %d", len(result))
	}
	hasSummary := false
	for _, msg := range result {
		if msg.ID == "truncation-summary" {
			hasSummary = true
			if msg.Role != "user" {
				t.Error("expected summary message to have user role")
			}
		}
	}
	if !hasSummary {
		t.Error("expected truncation summary message in result")
	}
}

func TestApplyTruncation_DropStrategy(t *testing.T) {
	messages := makeTestMessages(10)
	plan := TruncationPlan{
		Strategy:      TruncationStrategyDrop,
		KeepFromIndex: 5,
		DroppedTurns:  5,
	}
	result := ApplyTruncation(messages, plan)
	if len(result) != len(messages)-5 {
		t.Errorf("expected %d messages after drop, got %d", len(messages)-5, len(result))
	}
}

func TestPlanAndApplyTruncation_Integration(t *testing.T) {
	messages := makeTestMessages(10)
	plan := PlanTruncation(messages, ContextLevelCritical)
	result := ApplyTruncation(messages, plan)
	if plan.Strategy == TruncationStrategyNone {
		if len(result) != len(messages) {
			t.Error("none strategy should preserve all messages")
		}
		return
	}
	if len(result) >= len(messages) {
		t.Errorf("expected fewer messages after truncation, got %d >= %d", len(result), len(messages))
	}
}

func makeTestMessages(turns int) []uctypes.UIMessage {
	var messages []uctypes.UIMessage
	for i := 0; i < turns; i++ {
		messages = append(messages, uctypes.UIMessage{
			ID:   fmt.Sprintf("user-%d", i),
			Role: "user",
			Parts: []uctypes.UIMessagePart{
				{Type: "text", Text: fmt.Sprintf("User message %d", i)},
			},
		})
		messages = append(messages, uctypes.UIMessage{
			ID:   fmt.Sprintf("assistant-%d", i),
			Role: "assistant",
			Parts: []uctypes.UIMessagePart{
				{Type: "text", Text: fmt.Sprintf("Assistant response %d", i)},
			},
		})
	}
	return messages
}

func TestDeriveCheatsheetFromTaskState_Nil(t *testing.T) {
	if result := deriveCheatsheetFromTaskState(nil); result != nil {
		t.Fatalf("expected nil for nil task state, got %#v", result)
	}
}

func TestDeriveCheatsheetFromTaskState_EmptyTasks(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{Tasks: []uctypes.UITaskItem{}}
	if result := deriveCheatsheetFromTaskState(taskState); result != nil {
		t.Fatalf("expected nil for empty tasks, got %#v", result)
	}
}

func TestDeriveCheatsheetFromTaskState_ActivePlan(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{
		CurrentTaskId: "task-2",
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: "安装 MySQL 8.0", Status: uctypes.TaskItemStatusCompleted, Order: 1},
			{ID: "task-2", Title: "配置主库", Description: "调整 binlog 和 server-id", Status: uctypes.TaskItemStatusInProgress, Order: 2},
			{ID: "task-3", Title: "配置从库连接", Status: uctypes.TaskItemStatusPending, Order: 3},
			{ID: "task-4", Title: "验证数据同步", Status: uctypes.TaskItemStatusPending, Order: 4},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.CurrentWork != "配置主库 — 调整 binlog 和 server-id" {
		t.Fatalf("unexpected current work: %q", cheatsheet.CurrentWork)
	}
	if cheatsheet.Completed != "安装 MySQL 8.0" {
		t.Fatalf("unexpected completed: %q", cheatsheet.Completed)
	}
	if cheatsheet.NextStep != "配置从库连接" {
		t.Fatalf("unexpected next step: %q", cheatsheet.NextStep)
	}
	if cheatsheet.BlockedBy != "" {
		t.Fatalf("expected no blocked by, got %q", cheatsheet.BlockedBy)
	}
}

func TestDeriveCheatsheetFromTaskState_BlockedPlan(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{
		BlockedReason: "权限不足，无法写入 /etc/my.cnf",
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusCompleted, Order: 1},
			{ID: "task-2", Title: "配置主库", Status: uctypes.TaskItemStatusBlocked, Notes: "需要 root 权限", Order: 2},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.BlockedBy != "权限不足，无法写入 /etc/my.cnf" {
		t.Fatalf("expected blocked reason from BlockedReason, got %q", cheatsheet.BlockedBy)
	}
}

func TestDeriveCheatsheetFromTaskState_BlockedTaskWithoutReason(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusCompleted, Order: 1},
			{ID: "task-2", Title: "配置主库", Status: uctypes.TaskItemStatusBlocked, Notes: "需要 root 权限", Order: 2},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.BlockedBy != "配置主库：需要 root 权限" {
		t.Fatalf("expected blocked reason from task notes, got %q", cheatsheet.BlockedBy)
	}
}

func TestDeriveCheatsheetFromTaskState_AllCompleted(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusCompleted, Order: 1},
			{ID: "task-2", Title: "配置主库", Status: uctypes.TaskItemStatusCompleted, Order: 2},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.Completed != "安装 MySQL、配置主库" {
		t.Fatalf("unexpected completed: %q", cheatsheet.Completed)
	}
	if cheatsheet.NextStep != "所有任务已完成" {
		t.Fatalf("unexpected next step: %q", cheatsheet.NextStep)
	}
}

func TestDeriveCheatsheetFromTaskState_NoCurrentTaskId(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusCompleted, Order: 1},
			{ID: "task-2", Title: "配置主库", Status: uctypes.TaskItemStatusInProgress, Order: 2},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.CurrentWork != "配置主库" {
		t.Fatalf("expected current work from in_progress task, got %q", cheatsheet.CurrentWork)
	}
}

func TestDeriveCheatsheetFromTaskState_SkippedTasks(t *testing.T) {
	taskState := &uctypes.UITaskProgressState{
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusCompleted, Order: 1},
			{ID: "task-2", Title: "可选配置", Status: uctypes.TaskItemStatusSkipped, Order: 2},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if cheatsheet.Completed != "安装 MySQL" {
		t.Fatalf("skipped tasks should not appear in completed, got %q", cheatsheet.Completed)
	}
	if cheatsheet.NextStep != "所有任务已完成" {
		t.Fatalf("all completed+skipped should show all done, got %q", cheatsheet.NextStep)
	}
}

func TestDeriveCheatsheetFromTaskState_TitleTruncation(t *testing.T) {
	longTitle := ""
	for i := 0; i < 50; i++ {
		longTitle += "非常长的标题"
	}
	taskState := &uctypes.UITaskProgressState{
		CurrentTaskId: "task-1",
		Tasks: []uctypes.UITaskItem{
			{ID: "task-1", Title: longTitle, Status: uctypes.TaskItemStatusInProgress, Order: 1},
		},
	}
	cheatsheet := deriveCheatsheetFromTaskState(taskState)
	if cheatsheet == nil {
		t.Fatal("expected cheatsheet")
	}
	if len(cheatsheet.CurrentWork) > 123 {
		t.Fatalf("expected current work to be truncated to ~120 chars, got %d chars", len(cheatsheet.CurrentWork))
	}
}
