// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func buildTaskStateSummary(tasks []uctypes.UITaskItem) uctypes.UITaskProgressSummary {
	summary := uctypes.UITaskProgressSummary{Total: len(tasks)}
	for _, task := range tasks {
		switch task.Status {
		case uctypes.TaskItemStatusCompleted:
			summary.Completed++
		case uctypes.TaskItemStatusInProgress:
			summary.InProgress++
		case uctypes.TaskItemStatusBlocked:
			summary.Blocked++
		default:
			summary.Pending++
		}
	}
	if summary.Total > 0 {
		summary.Percent = int(float64(summary.Completed) / float64(summary.Total) * 100)
	}
	return summary
}

func shortenCommandSummary(command string) string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return "执行命令"
	}
	if len(trimmed) > 48 {
		return fmt.Sprintf("执行命令：%s...", trimmed[:45])
	}
	return fmt.Sprintf("执行命令：%s", trimmed)
}

func readableFallbackTaskTitle(toolCall uctypes.WaveToolCall) string {
	inputMap, _ := toolCall.Input.(map[string]any)
	switch toolCall.Name {
	case "wave_run_command":
		if cmd, ok := inputMap["command"].(string); ok {
			return shortenCommandSummary(cmd)
		}
		return "执行命令"
	case "write_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("写入文件 %s", filename)
		}
		return "写入文件"
	case "edit_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("编辑文件 %s", filename)
		}
		return "编辑文件"
	case "delete_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("删除文件 %s", filename)
		}
		return "删除文件"
	case "read_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("读取文件 %s", filename)
		}
		return "读取文件"
	default:
		return "执行步骤"
	}
}

func buildTaskTitle(toolCall uctypes.WaveToolCall) string {
	if toolCall.ToolUseData != nil && strings.TrimSpace(toolCall.ToolUseData.ToolDesc) != "" {
		return strings.TrimSpace(toolCall.ToolUseData.ToolDesc)
	}
	return readableFallbackTaskTitle(toolCall)
}

func buildTaskStateFromToolCalls(toolCalls []uctypes.WaveToolCall) *uctypes.UITaskProgressState {
	if len(toolCalls) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	tasks := make([]uctypes.UITaskItem, 0, len(toolCalls))
	for idx, toolCall := range toolCalls {
		status := uctypes.TaskItemStatusPending
		startedTs := int64(0)
		if idx == 0 {
			status = uctypes.TaskItemStatusInProgress
			startedTs = now
		}
		tasks = append(tasks, uctypes.UITaskItem{
			ID:        toolCall.ID,
			Title:     buildTaskTitle(toolCall),
			Status:    status,
			Order:     idx,
			ToolCalls: []uctypes.UIToolCall{{ID: toolCall.ID, Name: toolCall.Name, Timestamp: now}},
			StartedTs: startedTs,
		})
	}
	return &uctypes.UITaskProgressState{
		Version:       1,
		PlanId:        uuid.NewString(),
		Source:        "system-updated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: tasks[0].ID,
		Tasks:         tasks,
		Summary:       buildTaskStateSummary(tasks),
		LastUpdatedTs: now,
	}
}

func RecordToolCall(chatId string, toolName string, toolCallID string, parameters map[string]any) {
	tracker := GetTodoContextTracker(chatId)
	activeTodoID := tracker.GetActiveTodoID()
	if activeTodoID == "" {
		return
	}
	meta := chatstore.DefaultChatStore.GetSession(chatId)
	if meta == nil || meta.TaskState == nil {
		return
	}
	state := meta.TaskState.Clone()
	toolCall := uctypes.UIToolCall{
		ID:         fmt.Sprintf("tool_%d_%s", time.Now().UnixMilli(), strings.ReplaceAll(toolName, " ", "_")),
		Name:       toolName,
		Parameters: parameters,
		Timestamp:  time.Now().UnixMilli(),
	}
	found := false
	for idx := range state.Tasks {
		if state.Tasks[idx].ID == activeTodoID {
			state.Tasks[idx].ToolCalls = append(state.Tasks[idx].ToolCalls, toolCall)
			state.Tasks[idx].UpdatedTs = time.Now().UnixMilli()
			found = true
			break
		}
	}
	if !found {
		return
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(chatId, nil, uctypes.UIChatSessionMetaUpdate{
		TaskState: state,
	})
}

func mergeTaskStateForToolCalls(existing *uctypes.UITaskProgressState, fallback *uctypes.UITaskProgressState) *uctypes.UITaskProgressState {
	if existing != nil && len(existing.Tasks) > 0 && existing.Source == "model-generated" {
		return existing.Clone()
	}
	return nil
}

func refreshTaskStateFromStore(chatId string, current *uctypes.UITaskProgressState) (*uctypes.UITaskProgressState, bool) {
	meta := chatstore.DefaultChatStore.GetSession(chatId)
	if meta == nil || meta.TaskState == nil || len(meta.TaskState.Tasks) == 0 || meta.TaskState.Source != "model-generated" {
		return current, false
	}
	if current != nil && meta.TaskState.LastUpdatedTs <= current.LastUpdatedTs {
		return current, false
	}
	return meta.TaskState.Clone(), true
}

func advanceTaskStateForToolResult(state *uctypes.UITaskProgressState, result uctypes.AIToolResult) {
	if state == nil {
		return
	}
	now := time.Now().UnixMilli()
	nextTaskIndex := -1
	matchedAny := false
	for idx := range state.Tasks {
		task := &state.Tasks[idx]
		matched := task.ID == result.ToolUseID
		if !matched {
			for _, toolCall := range task.ToolCalls {
				if toolCall.ID == result.ToolUseID {
					matched = true
					break
				}
			}
		}
		if !matched {
			continue
		}
		matchedAny = true
		if result.ErrorText != "" {
			task.Status = uctypes.TaskItemStatusBlocked
			state.Status = uctypes.TaskProgressStatusBlocked
			state.BlockedReason = result.ErrorText
			state.CurrentTaskId = task.ID
			state.LastUpdatedTs = now
			state.Summary = buildTaskStateSummary(state.Tasks)
			return
		}
		task.Status = uctypes.TaskItemStatusCompleted
		task.CompletedTs = now
		task.IsFocused = false
		task.FocusedTs = 0
		nextTaskIndex = idx + 1
		break
	}
	if !matchedAny {
		return
	}
	var nextTodoID string
	if nextTaskIndex >= 0 && nextTaskIndex < len(state.Tasks) {
		state.Tasks[nextTaskIndex].Status = uctypes.TaskItemStatusInProgress
		if state.Tasks[nextTaskIndex].StartedTs == 0 {
			state.Tasks[nextTaskIndex].StartedTs = now
		}
		state.Tasks[nextTaskIndex].IsFocused = true
		state.Tasks[nextTaskIndex].FocusedTs = now
		state.Tasks[nextTaskIndex].UpdatedTs = now
		state.CurrentTaskId = state.Tasks[nextTaskIndex].ID
		nextTodoID = state.Tasks[nextTaskIndex].ID
		state.Status = uctypes.TaskProgressStatusActive
		state.BlockedReason = ""
	} else {
		state.CurrentTaskId = ""
		if state.FocusChain != nil {
			state.FocusChain.FocusedTodoId = ""
		}
		state.Status = uctypes.TaskProgressStatusCompleted
		state.BlockedReason = ""
	}
	state.LastUpdatedTs = now
	state.Summary = buildTaskStateSummary(state.Tasks)
	if state.FocusChain != nil {
		state.FocusChain.TotalTodos = state.Summary.Total
		state.FocusChain.CompletedTodos = state.Summary.Completed
		if state.Summary.Total > 0 {
			state.FocusChain.ChainProgress = int(float64(state.Summary.Completed) / float64(state.Summary.Total) * 100)
		} else {
			state.FocusChain.ChainProgress = 0
		}
		state.FocusChain.AutoTransition = true
		state.FocusChain.LastFocusChangeTs = now
		state.FocusChain.FocusedTodoId = nextTodoID
	}
}
