package aiusechat

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type todoWriteSubtaskInput struct {
	ID          string `json:"id"`
	Content     string `json:"content"`
	Description string `json:"description,omitempty"`
}

type todoWriteTaskInput struct {
	ID          string                  `json:"id"`
	Content     string                  `json:"content"`
	Description string                  `json:"description,omitempty"`
	Status      string                  `json:"status"`
	Priority    string                  `json:"priority"`
	Subtasks    []todoWriteSubtaskInput `json:"subtasks,omitempty"`
}

type todoWriteInput struct {
	Todos     []todoWriteTaskInput `json:"todos"`
	AutoFocus bool                 `json:"autofocus,omitempty"`
}

func hasChineseContent(text string) bool {
	for _, r := range text {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

func parseTodoWriteInput(m map[string]any) (todoWriteInput, error) {
	input := todoWriteInput{}
	if autoFocus, ok := m["auto_focus"].(bool); ok {
		input.AutoFocus = autoFocus
	}
	rawTodos, ok := m["todos"].([]any)
	if !ok || len(rawTodos) == 0 {
		return input, fmt.Errorf("todos array is required and must not be empty")
	}
	for _, rawTodo := range rawTodos {
		todoMap, ok := rawTodo.(map[string]any)
		if !ok {
			continue
		}
		todo := todoWriteTaskInput{}
		if id, ok := todoMap["id"].(string); ok {
			todo.ID = id
		}
		if content, ok := todoMap["content"].(string); ok {
			todo.Content = content
		}
		if desc, ok := todoMap["description"].(string); ok {
			todo.Description = desc
		}
		if status, ok := todoMap["status"].(string); ok {
			todo.Status = status
		}
		if priority, ok := todoMap["priority"].(string); ok {
			todo.Priority = priority
		}
		if rawSubtasks, ok := todoMap["subtasks"].([]any); ok {
			for _, rawSub := range rawSubtasks {
				if subMap, ok := rawSub.(map[string]any); ok {
					sub := todoWriteSubtaskInput{}
					if id, ok := subMap["id"].(string); ok {
						sub.ID = id
					}
					if content, ok := subMap["content"].(string); ok {
						sub.Content = content
					}
					if desc, ok := subMap["description"].(string); ok {
						sub.Description = desc
					}
					todo.Subtasks = append(todo.Subtasks, sub)
				}
			}
		}
		input.Todos = append(input.Todos, todo)
	}
	return input, nil
}

func buildTodoTaskState(input todoWriteInput) *uctypes.UITaskProgressState {
	now := time.Now().UnixMilli()
	tasks := make([]uctypes.UITaskItem, 0, len(input.Todos))
	hasExplicitFocus := false
	for idx, todo := range input.Todos {
		status := uctypes.TaskItemStatus(todo.Status)
		if status == "" {
			status = uctypes.TaskItemStatusPending
		}
		priority := uctypes.TaskItemPriority(todo.Priority)
		if priority == "" {
			priority = uctypes.TaskItemPriorityMedium
		}
		var subtasks []uctypes.UISubtask
		for _, sub := range todo.Subtasks {
			subtasks = append(subtasks, uctypes.UISubtask{
				ID:          sub.ID,
				Content:     sub.Content,
				Description: sub.Description,
			})
		}
		isFocused := false
		focusedTs := int64(0)
		if status == uctypes.TaskItemStatusInProgress {
			isFocused = true
			focusedTs = now
			hasExplicitFocus = true
		}
		startedTs := int64(0)
		completedTs := int64(0)
		if status == uctypes.TaskItemStatusInProgress || status == uctypes.TaskItemStatusCompleted {
			startedTs = now
		}
		if status == uctypes.TaskItemStatusCompleted {
			completedTs = now
			isFocused = false
			focusedTs = 0
		}
		tasks = append(tasks, uctypes.UITaskItem{
			ID:          todo.ID,
			Title:       todo.Content,
			Description: todo.Description,
			Status:      status,
			Priority:    priority,
			Order:       idx,
			Subtasks:    subtasks,
			IsFocused:   isFocused,
			StartedTs:   startedTs,
			CompletedTs: completedTs,
			FocusedTs:   focusedTs,
			CreatedTs:   now,
			UpdatedTs:   now,
		})
	}
	if !hasExplicitFocus && input.AutoFocus && len(tasks) > 0 {
		for idx := range tasks {
			if tasks[idx].Status == uctypes.TaskItemStatusPending {
				tasks[idx].Status = uctypes.TaskItemStatusInProgress
				tasks[idx].IsFocused = true
				tasks[idx].FocusedTs = now
				tasks[idx].StartedTs = now
				tasks[idx].UpdatedTs = now
				break
			}
		}
	}
	currentTaskId := ""
	for _, task := range tasks {
		if task.IsFocused {
			currentTaskId = task.ID
			break
		}
	}
	allPending := true
	for _, task := range tasks {
		if task.Status != uctypes.TaskItemStatusPending {
			allPending = false
			break
		}
	}
	focusChain := &uctypes.UIFocusChainState{
		TotalTodos:     len(tasks),
		AutoTransition: true,
	}
	completedCount := 0
	for _, task := range tasks {
		if task.Status == uctypes.TaskItemStatusCompleted {
			completedCount++
		}
	}
	focusChain.CompletedTodos = completedCount
	if len(tasks) > 0 {
		focusChain.ChainProgress = int(float64(completedCount) / float64(len(tasks)) * 100)
	}
	for _, task := range tasks {
		if task.IsFocused {
			focusChain.FocusedTodoId = task.ID
			break
		}
	}
	state := &uctypes.UITaskProgressState{
		Version:       1,
		PlanId:        uuid.NewString(),
		Source:        "model-generated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: currentTaskId,
		Tasks:         tasks,
		Summary:       buildTaskStateSummary(tasks),
		LastUpdatedTs: now,
		FocusChain:    focusChain,
	}
	if currentTaskId == "" {
		if allPending && len(tasks) >= 3 {
			state.Status = uctypes.TaskProgressStatusActive
		} else if completedCount == len(tasks) {
			state.Status = uctypes.TaskProgressStatusCompleted
		}
	}
	return state
}

func buildTodoWriteReminder(state *uctypes.UITaskProgressState, input todoWriteInput) string {
	isChinese := false
	for _, todo := range input.Todos {
		if hasChineseContent(todo.Content) {
			isChinese = true
			break
		}
	}
	allPending := true
	for _, task := range state.Tasks {
		if task.Status != uctypes.TaskItemStatusPending {
			allPending = false
			break
		}
	}
	if allPending && len(state.Tasks) >= 3 {
		if isChinese {
			return "提醒：已创建任务列表但所有任务仍为 pending。请立即将第一个任务设为 in_progress 并开始执行。"
		}
		return "Reminder: Todo list created but all tasks are still pending. Set the first task to in_progress immediately and begin execution."
	}
	return ""
}

func GetTodoWriteToolDefinition(chatId string, aiOpts *uctypes.AIOptsType) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_todo_write",
		DisplayName: "Todo Write",
		Description: "Create and manage structured task lists. Each task must include content (title) and description (detailed steps). Use ONLY for tasks with ≥3 concrete steps; for 1-2 steps, act directly. State flow: pending → in_progress → completed.",
		ToolLogName: "wave:todowrite",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"todos": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"id":          map[string]any{"type": "string"},
							"content":     map[string]any{"type": "string"},
							"description": map[string]any{"type": "string"},
							"status":      map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed"}},
							"priority":    map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}},
							"subtasks": map[string]any{
								"type": "array",
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"id":          map[string]any{"type": "string"},
										"content":     map[string]any{"type": "string"},
										"description": map[string]any{"type": "string"},
									},
									"required":             []string{"id", "content", "description"},
									"additionalProperties": false,
								},
							},
						},
						"required":             []string{"id", "content", "description", "status", "priority"},
						"additionalProperties": false,
					},
				},
				"auto_focus": map[string]any{"type": "boolean"},
			},
			"required":             []string{"todos"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any, _ *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}
			parsed, err := parseTodoWriteInput(m)
			if err != nil {
				return nil, err
			}
			state := buildTodoTaskState(parsed)
			svc := NewFocusChainService(chatId, state)
			if state.FocusChain.FocusedTodoId == "" && len(state.Tasks) > 0 {
				for idx := range state.Tasks {
					if state.Tasks[idx].Status == uctypes.TaskItemStatusPending {
						svc.FocusTodo(state.Tasks[idx].ID, "auto_focus_on_create")
						break
					}
				}
			}
			svc.SyncToStore()
			result := map[string]any{
				"state":    state,
				"reminder": buildTodoWriteReminder(state, parsed),
			}
			return result, nil
		},
		ToolApproval: func(input any) string { return uctypes.ApprovalAutoApproved },
	}
}

func GetTodoReadToolDefinition(chatId string, aiOpts *uctypes.AIOptsType) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_todo_read",
		DisplayName: "Todo Read",
		Description: "Read the current task list. Returns all tasks with their status, focus chain state, and context usage. If fewer than 3 tasks exist, suggests executing directly instead of maintaining a list.",
		ToolLogName: "wave:todoread",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"include_details": map[string]any{"type": "boolean"},
			},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any, _ *uctypes.UIMessageDataToolUse) (any, error) {
			meta := chatstore.DefaultChatStore.GetSession(chatId)
			if meta == nil || meta.TaskState == nil || len(meta.TaskState.Tasks) == 0 {
				return map[string]any{
					"todos": []any{},
					"hint":  "No task list exists. Use waveai_todo_write to create one for complex multi-step tasks (≥3 steps).",
				}, nil
			}
			state := meta.TaskState.Clone()
			svc := NewFocusChainService(chatId, state)
			suggestNewTask, suggestReason := svc.ShouldSuggestNewTask()
			isChinese := false
			for _, task := range state.Tasks {
				if hasChineseContent(task.Title) {
					isChinese = true
					break
				}
			}
			if len(state.Tasks) < 3 {
				hint := "Only 1-2 tasks present. This is not a complex checklist; execute directly and report the outcome."
				if isChinese {
					hint = "仅有 1-2 个任务，无需维护清单，直接执行并报告结果即可。"
				}
				return map[string]any{
					"todos": state.Tasks,
					"state": state,
					"hint":  hint,
				}, nil
			}
			var sb strings.Builder
			for _, task := range state.Tasks {
				statusIcon := "○"
				switch task.Status {
				case uctypes.TaskItemStatusCompleted:
					statusIcon = "✓"
				case uctypes.TaskItemStatusInProgress:
					statusIcon = "►"
				case uctypes.TaskItemStatusBlocked:
					statusIcon = "✗"
				}
				focusMark := ""
				if task.IsFocused {
					focusMark = " ← focused"
				}
				sb.WriteString(fmt.Sprintf("%s [%s] %s%s\n", statusIcon, task.Priority, task.Title, focusMark))
			}
			resultMap := map[string]any{
				"todos":      state.Tasks,
				"state":      state,
				"focuschain": state.FocusChain,
				"summary":    state.Summary,
				"formatted":  sb.String(),
			}
			if suggestNewTask {
				resultMap["context_warning"] = suggestReason
			}
			return resultMap, nil
		},
		ToolApproval: func(input any) string { return uctypes.ApprovalAutoApproved },
	}
}
