package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestTodoContextTracker_UpdateContextUsage(t *testing.T) {
	tracker := &TodoContextTracker{maxContextTokens: 100000}

	level := tracker.UpdateContextUsage(30000, 100000)
	if level != ContextLevelNormal {
		t.Errorf("expected normal, got %s", level)
	}
	if tracker.contextUsagePercent != 30 {
		t.Errorf("expected 30%%, got %d%%", tracker.contextUsagePercent)
	}

	level = tracker.UpdateContextUsage(55000, 100000)
	if level != ContextLevelWarning {
		t.Errorf("expected warning, got %s", level)
	}

	level = tracker.UpdateContextUsage(75000, 100000)
	if level != ContextLevelCritical {
		t.Errorf("expected critical, got %s", level)
	}

	level = tracker.UpdateContextUsage(92000, 100000)
	if level != ContextLevelMaximum {
		t.Errorf("expected maximum, got %s", level)
	}
}

func TestTodoContextTracker_ShouldSuggestNewTask(t *testing.T) {
	tracker := &TodoContextTracker{maxContextTokens: 100000}

	tracker.UpdateContextUsage(30000, 100000)
	suggest, _ := tracker.ShouldSuggestNewTask()
	if suggest {
		t.Error("should not suggest new task at 30%")
	}

	tracker.UpdateContextUsage(75000, 100000)
	suggest, reason := tracker.ShouldSuggestNewTask()
	if !suggest {
		t.Error("should suggest new task at 75%")
	}
	if reason == "" {
		t.Error("reason should not be empty")
	}
}

func TestFocusChainService_AutoAdvanceOnComplete(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Status: uctypes.TaskProgressStatusActive,
		Tasks: []uctypes.UITaskItem{
			{ID: "t1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusInProgress, IsFocused: true, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t2", Title: "配置 my.cnf", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t3", Title: "启动并验证", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityMedium},
		},
		FocusChain: &uctypes.UIFocusChainState{
			FocusedTodoId:  "t1",
			TotalTodos:     3,
			CompletedTodos: 0,
		},
	}
	svc := NewFocusChainService("chat-1", state)
	completed, next := svc.CompleteFocusedTodo()
	if completed == nil || completed.ID != "t1" {
		t.Fatalf("expected t1 completed, got %v", completed)
	}
	if completed.Status != uctypes.TaskItemStatusCompleted {
		t.Fatalf("completed task should have completed status")
	}
	if next == nil || next.ID != "t2" {
		t.Fatalf("expected t2 as next, got %v", next)
	}
	if !next.IsFocused {
		t.Fatalf("next task should be focused")
	}
	if next.Status != uctypes.TaskItemStatusInProgress {
		t.Fatalf("next task should be in_progress")
	}
	if state.FocusChain.FocusedTodoId != "t2" {
		t.Fatalf("focus chain should point to t2, got %s", state.FocusChain.FocusedTodoId)
	}
	if state.FocusChain.CompletedTodos != 1 {
		t.Fatalf("expected 1 completed, got %d", state.FocusChain.CompletedTodos)
	}
}

func TestFocusChainService_CompleteAllTasks(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Status: uctypes.TaskProgressStatusActive,
		Tasks: []uctypes.UITaskItem{
			{ID: "t1", Title: "步骤1", Status: uctypes.TaskItemStatusInProgress, IsFocused: true, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t2", Title: "步骤2", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityHigh},
		},
		FocusChain: &uctypes.UIFocusChainState{
			FocusedTodoId:  "t1",
			TotalTodos:     2,
			CompletedTodos: 0,
		},
	}
	svc := NewFocusChainService("chat-1", state)

	completed1, next1 := svc.CompleteFocusedTodo()
	if completed1.ID != "t1" {
		t.Fatalf("expected t1, got %s", completed1.ID)
	}
	if next1 == nil || next1.ID != "t2" {
		t.Fatalf("expected t2, got %v", next1)
	}

	completed2, next2 := svc.CompleteFocusedTodo()
	if completed2.ID != "t2" {
		t.Fatalf("expected t2, got %s", completed2.ID)
	}
	if next2 != nil {
		t.Fatalf("expected nil next after all tasks completed, got %v", next2)
	}
	if state.Status != uctypes.TaskProgressStatusCompleted {
		t.Fatalf("state should be completed, got %s", state.Status)
	}
	if state.FocusChain.FocusedTodoId != "" {
		t.Fatalf("focused todo should be empty after all completed, got %s", state.FocusChain.FocusedTodoId)
	}
}

func TestFocusChainService_FocusTodo(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Status: uctypes.TaskProgressStatusActive,
		Tasks: []uctypes.UITaskItem{
			{ID: "t1", Title: "任务1", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t2", Title: "任务2", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityMedium},
		},
		FocusChain: &uctypes.UIFocusChainState{
			TotalTodos: 2,
		},
	}
	svc := NewFocusChainService("chat-1", state)

	svc.FocusTodo("t1", "user_request")
	if !state.Tasks[0].IsFocused {
		t.Fatal("t1 should be focused")
	}
	if state.Tasks[0].Status != uctypes.TaskItemStatusInProgress {
		t.Fatal("t1 should be in_progress after focus")
	}
	if state.FocusChain.FocusedTodoId != "t1" {
		t.Fatal("focus chain should point to t1")
	}

	svc.FocusTodo("t2", "user_request")
	if state.Tasks[0].IsFocused {
		t.Fatal("t1 should no longer be focused")
	}
	if !state.Tasks[1].IsFocused {
		t.Fatal("t2 should be focused")
	}
	if state.Tasks[1].Status != uctypes.TaskItemStatusInProgress {
		t.Fatal("t2 should be in_progress after focus")
	}

	transitions := svc.GetTransitions()
	if len(transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(transitions))
	}
	if transitions[0].ToTodoId != "t1" {
		t.Fatalf("first transition should be to t1")
	}
	if transitions[1].FromTodoId != "t1" || transitions[1].ToTodoId != "t2" {
		t.Fatalf("second transition should be from t1 to t2")
	}
}

func TestFocusChainService_GetProgressSummary(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Tasks: []uctypes.UITaskItem{
			{ID: "t1", Title: "任务1", Status: uctypes.TaskItemStatusCompleted, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t2", Title: "任务2", Status: uctypes.TaskItemStatusInProgress, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t3", Title: "任务3", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityMedium},
			{ID: "t4", Title: "任务4", Status: uctypes.TaskItemStatusCompleted, Priority: uctypes.TaskItemPriorityLow},
		},
		FocusChain: &uctypes.UIFocusChainState{},
	}
	svc := NewFocusChainService("chat-1", state)
	total, completed, progress := svc.GetProgressSummary()
	if total != 4 {
		t.Fatalf("expected 4 total, got %d", total)
	}
	if completed != 2 {
		t.Fatalf("expected 2 completed, got %d", completed)
	}
	if progress != 50 {
		t.Fatalf("expected 50%%, got %d%%", progress)
	}
}

func TestFocusChainService_GenerateHandoff(t *testing.T) {
	state := &uctypes.UITaskProgressState{
		PlanId: "plan-1",
		Source: "model-generated",
		Status: uctypes.TaskProgressStatusActive,
		Tasks: []uctypes.UITaskItem{
			{ID: "t1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusCompleted, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t2", Title: "配置 my.cnf", Status: uctypes.TaskItemStatusInProgress, IsFocused: true, Priority: uctypes.TaskItemPriorityHigh},
			{ID: "t3", Title: "启动并验证", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityMedium},
		},
		FocusChain: &uctypes.UIFocusChainState{
			FocusedTodoId:  "t2",
			TotalTodos:     3,
			CompletedTodos: 1,
		},
	}
	svc := NewFocusChainService("chat-1", state)
	svc.tracker.UpdateContextUsage(45000, 100000)

	handoff := svc.GenerateHandoff()
	if handoff.CompletedWork == "" {
		t.Fatal("completed work should not be empty")
	}
	if !containsStr(handoff.CompletedWork, "安装 MySQL") {
		t.Fatal("completed work should include 安装 MySQL")
	}
	if handoff.CurrentState != "active" {
		t.Fatalf("expected active state, got %s", handoff.CurrentState)
	}
	if handoff.ContextSnapshot.TotalTodos != 3 {
		t.Fatalf("expected 3 total, got %d", handoff.ContextSnapshot.TotalTodos)
	}
	if handoff.ContextSnapshot.CompletedTodos != 1 {
		t.Fatalf("expected 1 completed, got %d", handoff.ContextSnapshot.CompletedTodos)
	}
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsStrHelper(s, sub))
}

func containsStrHelper(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
