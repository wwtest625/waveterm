// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
)

type createPlanTaskInput struct {
	Title string `json:"title"`
}

type createPlanInput struct {
	Title string                `json:"title"`
	Items []createPlanTaskInput `json:"items"`
}

type advancePlanInput struct {
	CompleteTaskId string `json:"complete_task_id"`
	NextTaskId     string `json:"next_task_id,omitempty"`
	BlockedReason  string `json:"blocked_reason,omitempty"`
}

func buildPlannedTaskState(input createPlanInput) *uctypes.UITaskProgressState {
	now := time.Now().UnixMilli()
	tasks := make([]uctypes.UITaskItem, 0, len(input.Items))
	for idx, item := range input.Items {
		status := uctypes.TaskItemStatusPending
		startedTs := int64(0)
		if idx == 0 {
			status = uctypes.TaskItemStatusInProgress
			startedTs = now
		}
		tasks = append(tasks, uctypes.UITaskItem{
			ID:        fmt.Sprintf("plan-task-%d", idx+1),
			Title:     item.Title,
			Status:    status,
			Order:     idx,
			StartedTs: startedTs,
		})
	}
	currentTaskId := ""
	if len(tasks) > 0 {
		currentTaskId = tasks[0].ID
	}
	return &uctypes.UITaskProgressState{
		Version:       1,
		PlanId:        uuid.NewString(),
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: currentTaskId,
		Tasks:         tasks,
		Summary:       buildTaskStateSummary(tasks),
		LastUpdatedTs: now,
	}
}

func GetCreatePlanToolDefinition(chatId string, aiOpts *uctypes.AIOptsType) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_create_plan",
		DisplayName: "Create Plan",
		Description: "Create a concise task plan for the current request before or during execution. Use this when the request needs multiple concrete steps. Keep items short and action-oriented.",
		ToolLogName: "wave:createplan",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title": map[string]any{"type": "string"},
				"items": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"title": map[string]any{"type": "string"},
						},
						"required":             []string{"title"},
						"additionalProperties": false,
					},
				},
			},
			"required":             []string{"title", "items"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any, _ *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}
			plan := createPlanInput{}
			if title, ok := m["title"].(string); ok {
				plan.Title = title
			}
			if rawItems, ok := m["items"].([]any); ok {
				for _, rawItem := range rawItems {
					if itemMap, ok := rawItem.(map[string]any); ok {
						if title, ok := itemMap["title"].(string); ok && title != "" {
							plan.Items = append(plan.Items, createPlanTaskInput{Title: title})
						}
					}
				}
			}
			if len(plan.Items) == 0 {
				return nil, fmt.Errorf("plan items are required")
			}
			state := buildPlannedTaskState(plan)
			chatstore.DefaultChatStore.UpsertSessionMeta(chatId, aiOpts, uctypes.UIChatSessionMetaUpdate{
				TaskState: state,
				LastState: string(state.Status),
			})
			return state, nil
		},
		ToolApproval: func(input any) string { return uctypes.ApprovalAutoApproved },
	}
}

func GetAdvancePlanToolDefinition(chatId string, aiOpts *uctypes.AIOptsType) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_advance_plan",
		DisplayName: "Advance Plan",
		Description: "Advance the current task plan by completing the active task and optionally selecting the next task or blocking the plan.",
		ToolLogName: "wave:advanceplan",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"complete_task_id": map[string]any{"type": "string"},
				"next_task_id":     map[string]any{"type": "string"},
				"blocked_reason":   map[string]any{"type": "string"},
			},
			"required":             []string{"complete_task_id", "next_task_id", "blocked_reason"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any, _ *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}
			meta := chatstore.DefaultChatStore.GetSession(chatId)
			if meta == nil || meta.TaskState == nil {
				return nil, fmt.Errorf("no active plan")
			}
			state := meta.TaskState.Clone()
			completeTaskId, _ := m["complete_task_id"].(string)
			nextTaskId, _ := m["next_task_id"].(string)
			blockedReason, _ := m["blocked_reason"].(string)
			now := time.Now().UnixMilli()
			completed := false
			for idx := range state.Tasks {
				if state.Tasks[idx].ID != completeTaskId {
					continue
				}
				state.Tasks[idx].Status = uctypes.TaskItemStatusCompleted
				state.Tasks[idx].CompletedTs = now
				completed = true
				break
			}
			if !completed {
				return nil, fmt.Errorf("task %s not found", completeTaskId)
			}
			state.CurrentTaskId = ""
			if blockedReason != "" {
				state.Status = uctypes.TaskProgressStatusBlocked
				state.BlockedReason = blockedReason
			} else {
				for idx := range state.Tasks {
					if state.Tasks[idx].Status == uctypes.TaskItemStatusPending && (nextTaskId == "" || state.Tasks[idx].ID == nextTaskId) {
						state.Tasks[idx].Status = uctypes.TaskItemStatusInProgress
						if state.Tasks[idx].StartedTs == 0 {
							state.Tasks[idx].StartedTs = now
						}
						state.CurrentTaskId = state.Tasks[idx].ID
						state.Status = uctypes.TaskProgressStatusActive
						break
					}
				}
				if state.CurrentTaskId == "" {
					state.Status = uctypes.TaskProgressStatusCompleted
				}
				state.BlockedReason = ""
			}
			state.LastUpdatedTs = now
			state.Summary = buildTaskStateSummary(state.Tasks)
			chatstore.DefaultChatStore.UpsertSessionMeta(chatId, aiOpts, uctypes.UIChatSessionMetaUpdate{
				TaskState: state,
				LastState: string(state.Status),
			})
			return state, nil
		},
		ToolApproval: func(input any) string { return uctypes.ApprovalAutoApproved },
	}
}
