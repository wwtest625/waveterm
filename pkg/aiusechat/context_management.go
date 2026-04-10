// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func formatSessionCheatsheet(meta *uctypes.UIChatSessionMeta) string {
	if meta == nil || meta.Cheatsheet == nil {
		return ""
	}
	lines := []string{
		summarizeCheatsheetText(meta.Cheatsheet.CurrentWork, 120),
		summarizeCheatsheetText(meta.Cheatsheet.Completed, 120),
		summarizeCheatsheetText(meta.Cheatsheet.BlockedBy, 120),
		summarizeCheatsheetText(meta.Cheatsheet.NextStep, 120),
	}
	if lines[0] == "" && lines[1] == "" && lines[2] == "" && lines[3] == "" {
		return ""
	}
	return strings.TrimSpace(strings.Join([]string{
		"会话小抄：仅把下面四项当作当前任务状态，不要扩写，不要重置目标。",
		"现在在做什么：" + maxCheatsheetLine(lines[0]),
		"已经完成什么：" + maxCheatsheetLine(lines[1]),
		"当前卡点：" + maxCheatsheetLine(lines[2]),
		"下一步：" + maxCheatsheetLine(lines[3]),
	}, "\n"))
}

func maxCheatsheetLine(value string) string {
	if strings.TrimSpace(value) == "" {
		return "无"
	}
	return value
}

func composeSystemPromptWithCheatsheet(basePrompt []string, meta *uctypes.UIChatSessionMeta) []string {
	composed := append([]string(nil), basePrompt...)
	cheatsheetPrompt := formatSessionCheatsheet(meta)
	if cheatsheetPrompt == "" {
		return composed
	}
	return append(composed, cheatsheetPrompt)
}

func buildSessionCheatsheetPrompt(messages []uctypes.UIMessage, lastState string, existing *uctypes.SessionCheatsheet) string {
	var lines []string
	lines = append(lines,
		"请把下面的会话状态压缩成严格四行，不要 markdown，不要解释。",
		"输出格式必须是：",
		"现在在做什么：...",
		"已经完成什么：...",
		"当前卡点：...",
		"下一步：...",
		"每行尽量短。没有内容时写“无”。",
	)
	if existing != nil {
		lines = append(lines,
			"",
			"已有小抄：",
			"现在在做什么："+maxCheatsheetLine(existing.CurrentWork),
			"已经完成什么："+maxCheatsheetLine(existing.Completed),
			"当前卡点："+maxCheatsheetLine(existing.BlockedBy),
			"下一步："+maxCheatsheetLine(existing.NextStep),
		)
	}
	lines = append(lines, "", "最新会话：")
	for _, message := range messages {
		roleLabel := "assistant"
		if message.Role == "user" {
			roleLabel = "user"
		}
		var parts []string
		for _, part := range message.Parts {
			switch part.Type {
			case "text":
				if strings.TrimSpace(part.Text) != "" {
					parts = append(parts, summarizeCheatsheetText(part.Text, 160))
				}
			case "data-tooluse":
				if toolUseData, ok := part.Data.(uctypes.UIMessageDataToolUse); ok {
					if strings.TrimSpace(toolUseData.ToolDesc) != "" {
						parts = append(parts, "工具:"+summarizeCheatsheetText(toolUseData.ToolDesc, 120))
					}
					if strings.TrimSpace(toolUseData.ErrorMessage) != "" {
						parts = append(parts, "错误:"+summarizeCheatsheetText(toolUseData.ErrorMessage, 120))
					}
					if toolUseData.AwaitingInput && strings.TrimSpace(toolUseData.PromptHint) != "" {
						parts = append(parts, "交互:"+summarizeCheatsheetText(toolUseData.PromptHint, 120))
					}
				}
			}
		}
		if len(parts) > 0 {
			lines = append(lines, roleLabel+": "+strings.Join(parts, " | "))
		}
	}
	if strings.TrimSpace(lastState) != "" {
		lines = append(lines, "当前状态: "+lastState)
	}
	return strings.Join(lines, "\n")
}

func parseSessionCheatsheetText(text string) *uctypes.SessionCheatsheet {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "：", ":")
	var cheatsheet uctypes.SessionCheatsheet
	found := 0
	for _, line := range strings.Split(normalized, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "现在在做什么:"):
			cheatsheet.CurrentWork = strings.TrimSpace(strings.TrimPrefix(line, "现在在做什么:"))
			found++
		case strings.HasPrefix(line, "已经完成什么:"):
			cheatsheet.Completed = strings.TrimSpace(strings.TrimPrefix(line, "已经完成什么:"))
			found++
		case strings.HasPrefix(line, "当前卡点:"):
			cheatsheet.BlockedBy = strings.TrimSpace(strings.TrimPrefix(line, "当前卡点:"))
			found++
		case strings.HasPrefix(line, "下一步:"):
			cheatsheet.NextStep = strings.TrimSpace(strings.TrimPrefix(line, "下一步:"))
			found++
		}
	}
	if found == 0 {
		return nil
	}
	return &cheatsheet
}

func summarizeSessionCheatsheetWithModel(ctx context.Context, chatOpts uctypes.WaveChatOpts, messages []uctypes.UIMessage, lastState string, existing *uctypes.SessionCheatsheet) *uctypes.SessionCheatsheet {
	prompt := buildSessionCheatsheetPrompt(messages, lastState, existing)
	if strings.TrimSpace(prompt) == "" {
		return nil
	}
	var summaryText string
	var err error
	switch chatOpts.Config.APIType {
	case uctypes.APIType_OpenAIChat:
		summaryText, err = openaichat.GenerateSessionCheatsheet(ctx, chatOpts.Config, prompt)
	case uctypes.APIType_OpenAIResponses:
		summaryText, err = openai.GenerateSessionCheatsheet(ctx, chatOpts.Config, prompt)
	}
	if err != nil || strings.TrimSpace(summaryText) == "" {
		return nil
	}
	return parseSessionCheatsheetText(summaryText)
}

func summarizeCheatsheetText(text string, limit int) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if normalized == "" {
		return ""
	}
	if limit <= 0 || len(normalized) <= limit {
		return normalized
	}
	if limit <= 3 {
		return normalized[:limit]
	}
	return normalized[:limit-3] + "..."
}

func deriveSessionCheatsheet(messages []uctypes.UIMessage, lastState string) *uctypes.SessionCheatsheet {
	var latestUserText string
	var latestAssistantText string
	var latestCompletedTool string
	var latestToolError string
	var latestInteractionPrompt string

	for msgIdx := len(messages) - 1; msgIdx >= 0; msgIdx-- {
		message := messages[msgIdx]
		if message.Role == "user" && latestUserText == "" {
			var textParts []string
			for _, part := range message.Parts {
				if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
					textParts = append(textParts, part.Text)
				}
			}
			latestUserText = summarizeCheatsheetText(strings.Join(textParts, "\n"), 80)
		}
		if message.Role == "assistant" && latestAssistantText == "" {
			var textParts []string
			for _, part := range message.Parts {
				if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
					textParts = append(textParts, part.Text)
				}
			}
			latestAssistantText = summarizeCheatsheetText(strings.Join(textParts, "\n"), 80)
		}
		for _, part := range message.Parts {
			if part.Type != "data-tooluse" {
				continue
			}
			toolUseData, ok := part.Data.(uctypes.UIMessageDataToolUse)
			if !ok {
				continue
			}
			if latestCompletedTool == "" && toolUseData.Status == uctypes.ToolUseStatusCompleted && strings.TrimSpace(toolUseData.ToolDesc) != "" {
				latestCompletedTool = summarizeCheatsheetText(toolUseData.ToolDesc, 80)
			}
			if latestToolError == "" && strings.TrimSpace(toolUseData.ErrorMessage) != "" {
				latestToolError = summarizeCheatsheetText(toolUseData.ErrorMessage, 80)
			}
			if latestInteractionPrompt == "" && toolUseData.AwaitingInput && strings.TrimSpace(toolUseData.PromptHint) != "" {
				latestInteractionPrompt = summarizeCheatsheetText(toolUseData.PromptHint, 80)
			}
		}
	}

	cheatsheet := &uctypes.SessionCheatsheet{}
	cheatsheet.CurrentWork = latestUserText
	if cheatsheet.CurrentWork == "" {
		cheatsheet.CurrentWork = latestAssistantText
	}
	if latestCompletedTool != "" {
		cheatsheet.Completed = latestCompletedTool
	} else if lastState == "completed" {
		cheatsheet.Completed = latestAssistantText
	}
	if latestToolError != "" {
		cheatsheet.BlockedBy = latestToolError
	} else if latestInteractionPrompt != "" {
		cheatsheet.BlockedBy = latestInteractionPrompt
	}

	switch {
	case latestInteractionPrompt != "":
		cheatsheet.NextStep = "先补充当前交互输入"
	case lastState == "failed":
		cheatsheet.NextStep = "先解决当前卡点后重试"
	case lastState == "completed":
		cheatsheet.NextStep = "根据当前结果决定下一步"
	default:
		cheatsheet.NextStep = "继续推进当前任务"
	}

	if cheatsheet.CurrentWork == "" && cheatsheet.Completed == "" && cheatsheet.BlockedBy == "" {
		return nil
	}
	return cheatsheet
}

func refreshSessionCheatsheet(backend UseChatBackend, chatOpts uctypes.WaveChatOpts) {
	if backend == nil || strings.TrimSpace(chatOpts.ChatId) == "" {
		return
	}
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return
	}
	uiChat, err := backend.ConvertAIChatToUIChat(*chat)
	if err != nil || uiChat == nil {
		return
	}
	lastState := ""
	var existing *uctypes.SessionCheatsheet
	if chat.SessionMeta != nil {
		lastState = chat.SessionMeta.LastTaskState
		existing = chat.SessionMeta.Cheatsheet
	}
	cheatsheet := summarizeSessionCheatsheetWithModel(context.Background(), chatOpts, uiChat.Messages, lastState, existing)
	if cheatsheet == nil {
		cheatsheet = deriveSessionCheatsheet(uiChat.Messages, lastState)
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		Cheatsheet: cheatsheet,
	})
}
