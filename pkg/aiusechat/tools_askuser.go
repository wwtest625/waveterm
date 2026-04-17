	package aiusechat

import (
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

func GetAskUserToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_ask_user",
		DisplayName: "Ask User",
		Description: "Ask the user a clarification question when critical execution parameters are missing. Use this tool instead of asking in plain text. The tool will pause execution until the user responds. Ask at most 3 questions per turn.",
		ToolLogName: "wave:askuser",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"enum":        []string{"freeform", "select", "multiselect", "confirm"},
					"description": "The type of question to ask: freeform for text input, select for single choice, multiselect for multiple choices, confirm for yes/no confirmation",
				},
				"prompt": map[string]any{
					"type":        "string",
					"description": "The question to ask the user. Must be specific and actionable.",
				},
				"options": map[string]any{
					"type":  "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"id":    map[string]any{"type": "string"},
							"label": map[string]any{"type": "string"},
							"value": map[string]any{"type": "string"},
						},
						"required":             []string{"id", "label"},
						"additionalProperties": false,
					},
					"description": "Options for select/multiselect questions. Each option needs id and label.",
				},
				"default": map[string]any{
					"type":        "string",
					"description": "Default answer for freeform/confirm questions",
				},
				"required": map[string]any{
					"type":        "boolean",
					"description": "Whether the user must answer (default: true)",
				},
			},
			"required":             []string{"kind", "prompt"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			return map[string]any{"status": "pending"}, nil
		},
		ToolApproval: func(input any) string { return uctypes.ApprovalAutoApproved },
	}
}

type askUserInput struct {
	Kind     string            `json:"kind"`
	Prompt   string            `json:"prompt"`
	Options  []uctypes.AskUserOption `json:"options,omitempty"`
	Default  string            `json:"default,omitempty"`
	Required bool              `json:"required,omitempty"`
}

func parseAskUserInput(m map[string]any) (askUserInput, error) {
	input := askUserInput{Required: true}
	if kind, ok := m["kind"].(string); ok {
		input.Kind = kind
	} else {
		return input, fmt.Errorf("kind is required")
	}
	if prompt, ok := m["prompt"].(string); ok {
		input.Prompt = prompt
	} else {
		return input, fmt.Errorf("prompt is required")
	}
	if input.Prompt == "" {
		return input, fmt.Errorf("prompt must not be empty")
	}
	validKinds := map[string]bool{"freeform": true, "select": true, "multiselect": true, "confirm": true}
	if !validKinds[input.Kind] {
		return input, fmt.Errorf("invalid kind: %s (must be freeform/select/multiselect/confirm)", input.Kind)
	}
	if rawOptions, ok := m["options"].([]any); ok {
		for _, rawOpt := range rawOptions {
			if optMap, ok := rawOpt.(map[string]any); ok {
				opt := uctypes.AskUserOption{}
				if id, ok := optMap["id"].(string); ok {
					opt.ID = id
				}
				if label, ok := optMap["label"].(string); ok {
					opt.Label = label
				}
				if value, ok := optMap["value"].(string); ok {
					opt.Value = value
				}
				input.Options = append(input.Options, opt)
			}
		}
	}
	if (input.Kind == "select" || input.Kind == "multiselect") && len(input.Options) == 0 {
		return input, fmt.Errorf("options are required for select/multiselect questions")
	}
	if def, ok := m["default"].(string); ok {
		input.Default = def
	}
	if required, ok := m["required"].(bool); ok {
		input.Required = required
	}
	return input, nil
}

func processAskUserToolCall(toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh) uctypes.AIToolResult {
	m, ok := toolCall.Input.(map[string]any)
	if !ok {
		return uctypes.AIToolResult{
			ToolName:  "waveai_ask_user",
			ToolUseID: toolCall.ID,
			ErrorText: "invalid input",
		}
	}

	parsed, err := parseAskUserInput(m)
	if err != nil {
		return uctypes.AIToolResult{
			ToolName:  "waveai_ask_user",
			ToolUseID: toolCall.ID,
			ErrorText: err.Error(),
		}
	}

	actionId := fmt.Sprintf("ask-%s-%d", toolCall.ID, time.Now().UnixMilli())

	var taskId string
	existingSession := chatstore.DefaultChatStore.GetSession(chatOpts.ChatId)
	if existingSession != nil && existingSession.TaskState != nil && existingSession.TaskState.CurrentTaskId != "" {
		taskId = existingSession.TaskState.CurrentTaskId
	}

	askData := uctypes.UIMessageDataAsk{
		ActionId: actionId,
		Kind:     uctypes.AskUserKind(parsed.Kind),
		Prompt:   parsed.Prompt,
		Options:  parsed.Options,
		Default:  parsed.Default,
		Required: parsed.Required,
		TaskId:   taskId,
		Status:   "pending",
	}
	_ = sseHandler.AiMsgData("data-ask", actionId, askData)

	var prevTaskStatus uctypes.TaskProgressStatus
	if taskId != "" && existingSession != nil && existingSession.TaskState != nil {
		prevTaskStatus = existingSession.TaskState.Status
		blockedState := existingSession.TaskState.Clone()
		blockedState.Status = uctypes.TaskProgressStatusBlocked
		blockedState.BlockedReason = fmt.Sprintf("等待用户回答：%s", truncateStr(parsed.Prompt, 60))
		blockedState.LastUpdatedTs = time.Now().UnixMilli()
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			TaskState: blockedState,
			LastState: string(blockedState.Status),
		})
		_ = sseHandler.AiMsgData("data-taskstate", blockedState.PlanId, *blockedState)
	}

	RegisterPendingAction(actionId, uctypes.PendingActionAskUser, sseHandler)

	result, waitErr := WaitForPendingAction(sseHandler.Context(), actionId)
	if waitErr != nil {
		if taskId != "" {
			unblockTaskState(chatOpts.ChatId, chatOpts.Config, prevTaskStatus, sseHandler)
		}
		return uctypes.AIToolResult{
			ToolName:  "waveai_ask_user",
			ToolUseID: toolCall.ID,
			ErrorText: fmt.Sprintf("failed to wait for user response: %v", waitErr),
		}
	}

	if result.Status == uctypes.PendingActionCanceled {
		if taskId != "" {
			unblockTaskState(chatOpts.ChatId, chatOpts.Config, prevTaskStatus, sseHandler)
		}
		askData.Status = "canceled"
		_ = sseHandler.AiMsgData("data-ask", actionId, askData)
		return uctypes.AIToolResult{
			ToolName:  "waveai_ask_user",
			ToolUseID: toolCall.ID,
			ErrorText: "user canceled the question",
		}
	}

	if taskId != "" {
		unblockTaskState(chatOpts.ChatId, chatOpts.Config, prevTaskStatus, sseHandler)
	}

	if result.Value == "__canceled__" {
		askData.Status = "canceled"
		_ = sseHandler.AiMsgData("data-ask", actionId, askData)
		return uctypes.AIToolResult{
			ToolName:  "waveai_ask_user",
			ToolUseID: toolCall.ID,
			Text:      "User skipped this question. Proceed with your best judgment or ask a different question.",
		}
	}

	askData.Status = "answered"
	askData.Answer = result.Value
	_ = sseHandler.AiMsgData("data-ask", actionId, askData)

	return uctypes.AIToolResult{
		ToolName:  "waveai_ask_user",
		ToolUseID: toolCall.ID,
		Text:      result.Value,
	}
}

func unblockTaskState(chatId string, config uctypes.AIOptsType, prevStatus uctypes.TaskProgressStatus, sseHandler *sse.SSEHandlerCh) {
	session := chatstore.DefaultChatStore.GetSession(chatId)
	if session == nil || session.TaskState == nil {
		return
	}
	restoreStatus := prevStatus
	if restoreStatus == "" || restoreStatus == uctypes.TaskProgressStatusBlocked {
		restoreStatus = uctypes.TaskProgressStatusActive
	}
	unblockedState := session.TaskState.Clone()
	unblockedState.Status = restoreStatus
	unblockedState.BlockedReason = ""
	unblockedState.LastUpdatedTs = time.Now().UnixMilli()
	chatstore.DefaultChatStore.UpsertSessionMeta(chatId, &config, uctypes.UIChatSessionMetaUpdate{
		TaskState: unblockedState,
		LastState: string(unblockedState.Status),
	})
	_ = sseHandler.AiMsgData("data-taskstate", unblockedState.PlanId, *unblockedState)
}

func truncateStr(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	if maxRunes > 3 {
		return string(runes[:maxRunes-3]) + "..."
	}
	return string(runes[:maxRunes])
}
