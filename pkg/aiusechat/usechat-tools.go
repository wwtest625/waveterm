// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func updateToolUseDataInChat(backend UseChatBackend, chatOpts uctypes.WaveChatOpts, toolCallID string, toolUseData uctypes.UIMessageDataToolUse) {
	if err := backend.UpdateToolUseData(chatOpts.ChatId, toolCallID, toolUseData); err != nil {
		log.Printf("failed to update tool use data in chat: %v\n", err)
	}
}

const maxToolOutputTextLen = 24 * 1024

func truncateToolOutputText(text string) string {
	trimmed := strings.TrimSpace(text)
	if len(trimmed) <= maxToolOutputTextLen {
		return trimmed
	}
	return strings.TrimSpace(trimmed[:maxToolOutputTextLen]) + "\n...[truncated]"
}

func extractToolOutputText(toolName string, resultText string) string {
	trimmedResult := strings.TrimSpace(resultText)
	if trimmedResult == "" {
		return ""
	}
	if toolName == "wave_run_command" || toolName == "wave_get_command_result" {
		var outputMap map[string]any
		if err := json.Unmarshal([]byte(trimmedResult), &outputMap); err == nil {
			for _, key := range []string{"output", "text", "stdout", "content"} {
				if rawText, ok := outputMap[key].(string); ok && strings.TrimSpace(rawText) != "" {
					return truncateToolOutputText(rawText)
				}
			}
			if rawText, ok := outputMap["error"].(string); ok && strings.TrimSpace(rawText) != "" {
				return truncateToolOutputText(rawText)
			}
			if rawLines, ok := outputMap["lines"].([]any); ok && len(rawLines) > 0 {
				lines := make([]string, 0, len(rawLines))
				for _, rawLine := range rawLines {
					if line, ok := rawLine.(string); ok {
						lines = append(lines, line)
					}
				}
				if len(lines) > 0 {
					return truncateToolOutputText(strings.Join(lines, "\n"))
				}
			}
			if summary, ok := outputMap["summary"].(string); ok && strings.TrimSpace(summary) != "" {
				return truncateToolOutputText(summary)
			}
		}
	}
	return truncateToolOutputText(trimmedResult)
}

func parseWaveCommandResultSnapshot(resultText string) (*wshrpc.CommandAgentGetCommandResultRtnData, bool) {
	trimmed := strings.TrimSpace(resultText)
	if trimmed == "" {
		return nil, false
	}
	var parsed wshrpc.CommandAgentGetCommandResultRtnData
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil, false
	}
	if strings.TrimSpace(parsed.JobId) == "" {
		return nil, false
	}
	return &parsed, true
}

func parseWaveCommandJobID(resultText string) string {
	trimmed := strings.TrimSpace(resultText)
	if trimmed == "" {
		return ""
	}
	var parsed struct {
		JobID string `json:"job_id"`
		JobId string `json:"jobid"`
	}
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return ""
	}
	if strings.TrimSpace(parsed.JobID) != "" {
		return strings.TrimSpace(parsed.JobID)
	}
	return strings.TrimSpace(parsed.JobId)
}

func applyWaveCommandInteractionState(toolUseData *uctypes.UIMessageDataToolUse, interaction *detectedInteraction) {
	if toolUseData == nil {
		return
	}
	if interaction == nil {
		toolUseData.AwaitingInput = false
		toolUseData.PromptHint = ""
		toolUseData.InputOptions = nil
		toolUseData.TuiDetected = false
		toolUseData.TuiSuppressed = false
		return
	}
	toolUseData.AwaitingInput = interaction.AwaitingInput
	toolUseData.PromptHint = strings.TrimSpace(interaction.PromptHint)
	if len(interaction.InputOptions) > 0 {
		toolUseData.InputOptions = append([]string(nil), interaction.InputOptions...)
	} else {
		toolUseData.InputOptions = nil
	}
	toolUseData.TuiDetected = interaction.TuiDetected
	toolUseData.TuiSuppressed = interaction.TuiSuppressed
}

func processToolCallInternal(backend UseChatBackend, toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts, toolDef *uctypes.ToolDefinition, sseHandler *sse.SSEHandlerCh) uctypes.AIToolResult {
	if toolCall.ToolUseData == nil {
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: "Invalid Tool Call",
		}
	}

	if toolCall.ToolUseData.Status == uctypes.ToolUseStatusError {
		errorMsg := toolCall.ToolUseData.ErrorMessage
		if errorMsg == "" {
			errorMsg = "Unspecified Tool Error"
		}
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: errorMsg,
		}
	}

	if toolDef != nil && toolDef.ToolVerifyInput != nil {
		if err := toolDef.ToolVerifyInput(toolCall.Input, toolCall.ToolUseData); err != nil {
			errorMsg := fmt.Sprintf("Input validation failed: %v", err)
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
			toolCall.ToolUseData.ErrorMessage = errorMsg
			return uctypes.AIToolResult{
				ToolName:  toolCall.Name,
				ToolUseID: toolCall.ID,
				ErrorText: errorMsg,
			}
		}
		// ToolVerifyInput can modify the toolusedata.  re-send it here.
		toolCall.ToolUseData.Partial = uctypes.BoolPtr(true)
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}

	agentMode := resolveAgentMode(chatOpts.AgentMode)
	if err := validateToolForAgentMode(agentMode, toolCall.Name); err != nil {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = err.Error()
		toolCall.ToolUseData.Partial = uctypes.BoolPtr(false)
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: err.Error(),
		}
	}
	toolCall.ToolUseData.Approval = applyAgentModeApprovalPolicy(agentMode, toolCall.Name, toolCall.ToolUseData.Approval)

	if toolCall.ToolUseData.Approval == uctypes.ApprovalBlocked {
		errorMsg := "Command blocked by security policy: this command is too dangerous to execute"
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = errorMsg
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: errorMsg,
		}
	}

	if toolCall.ToolUseData.Approval == uctypes.ApprovalNeedsApproval {
		log.Printf("  waiting for approval...\n")
		approval, err := WaitForToolApproval(sseHandler.Context(), toolCall.ID)
		if err != nil || approval == "" {
			approval = uctypes.ApprovalCanceled
		}
		log.Printf("  approval result: %q\n", approval)
		toolCall.ToolUseData.Approval = approval

		if !toolCall.ToolUseData.IsApproved() {
			errorMsg := "Tool use denied or timed out"
			if approval == uctypes.ApprovalUserDenied {
				errorMsg = "Tool use denied by user"
			} else if approval == uctypes.ApprovalTimeout {
				errorMsg = "Tool approval timed out"
			} else if approval == uctypes.ApprovalCanceled {
				errorMsg = "Tool approval canceled"
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusCancelled
				toolCall.ToolUseData.CancellationReason = uctypes.CancelReasonManual
				toolCall.ToolUseData.Partial = uctypes.BoolPtr(false)
				_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
				updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
				return uctypes.AIToolResult{
					ToolName:  toolCall.Name,
					ToolUseID: toolCall.ID,
					ErrorText: errorMsg,
				}
			}
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
			toolCall.ToolUseData.ErrorMessage = errorMsg
			return uctypes.AIToolResult{
				ToolName:  toolCall.Name,
				ToolUseID: toolCall.ID,
				ErrorText: errorMsg,
			}
		}

		// this still happens here because we need to update the FE to say the tool call was approved
		toolCall.ToolUseData.Partial = uctypes.BoolPtr(true)
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}

	toolCall.ToolUseData.RunTs = time.Now().UnixMilli()

	if toolCall.Name == "waveai_ask_user" {
		askResult := processAskUserToolCall(toolCall, chatOpts, sseHandler)
		if askResult.ErrorText != "" {
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
			toolCall.ToolUseData.ErrorMessage = askResult.ErrorText
		} else {
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
			toolCall.ToolUseData.OutputText = askResult.Text
		}
		return askResult
	}

	result := ResolveToolCall(toolDef, toolCall, chatOpts)

	if result.ErrorText != "" {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = result.ErrorText
		toolCall.ToolUseData.OutputText = ""
	} else {
		if toolCall.Name == "wave_run_command" {
			jobID := parseWaveCommandJobID(result.Text)
			toolCall.ToolUseData.JobId = jobID
			commandText := ""
			targetLabel := ""
			connectionName := ""
			if parsedCommandInput, parseErr := parseWaveRunCommandToolInput(toolCall.Input); parseErr == nil && parsedCommandInput != nil {
				commandText = getWaveRunCommandDisplayText(parsedCommandInput)
				rememberWaveCommandJob(jobID, commandText)
				if resolvedInput, resolvedTarget, resolveErr := resolveWaveRunCommandTarget(parsedCommandInput, toolCall.ToolUseData); resolveErr == nil && resolvedInput != nil {
					targetLabel = resolvedTarget
					connectionName = resolvedInput.Connection
				}
			}
			if snapshot, ok := parseWaveCommandResultSnapshot(result.Text); ok {
				toolCall.ToolUseData.DurationMs = snapshot.DurationMs
				toolCall.ToolUseData.ExitCode = snapshot.ExitCode
				toolCall.ToolUseData.ExitSignal = snapshot.ExitSignal
				toolCall.ToolUseData.OutputText = extractToolOutputText(toolCall.Name, result.Text)
				applyWaveCommandInteractionState(toolCall.ToolUseData, detectCommandInteraction(lookupWaveCommandJob(snapshot.JobId), snapshot))
				if strings.TrimSpace(snapshot.JobId) != "" {
					jobStatus := "running"
					if snapshot.Status == "done" {
						jobStatus = "completed"
					} else if snapshot.Status == "error" || snapshot.Status == "gone" {
						jobStatus = "error"
					}
					chatstore.DefaultChatStore.UpsertBackgroundJob(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatBackgroundJobInfo{
						JobId:            snapshot.JobId,
						ToolCallId:       toolCall.ID,
						CommandSummary:   commandText,
						Connection:       connectionName,
						TargetLabel:      targetLabel,
						Status:           jobStatus,
						ApprovalState:    strings.TrimSpace(toolCall.ToolUseData.Approval),
						InteractionState: func() string { if toolCall.ToolUseData.AwaitingInput { return "awaiting-input" }; if toolCall.ToolUseData.TuiDetected { return "tui-detected" }; return "" }(),
						PromptHint:       strings.TrimSpace(toolCall.ToolUseData.PromptHint),
						DurationMs:       snapshot.DurationMs,
						ExitCode:         snapshot.ExitCode,
						ExitSignal:       snapshot.ExitSignal,
						Error:            strings.TrimSpace(snapshot.Error),
						OutputPreview:    strings.TrimSpace(toolCall.ToolUseData.OutputText),
						TurnId:           toolCall.ID,
						LastUpdatedTs:    time.Now().UnixMilli(),
					})
				}
				if snapshot.Status == "running" {
					tryStartWaveCommandResultPoller(sseHandler.Context(), chatOpts, backend, sseHandler, toolCall.ID, snapshot)
				}
				if snapshot.Status == "gone" || (snapshot.ExitCode == nil && strings.TrimSpace(snapshot.Error) != "") {
					toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
					toolCall.ToolUseData.ErrorMessage = strings.TrimSpace(snapshot.Error)
					if toolCall.ToolUseData.ErrorMessage == "" {
						toolCall.ToolUseData.ErrorMessage = "command execution failed"
					}
				} else if snapshot.Status == "running" {
					toolCall.ToolUseData.Status = "running"
					toolCall.ToolUseData.ErrorMessage = ""
				} else {
					toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
					toolCall.ToolUseData.ErrorMessage = ""
				}
				return result
			}
		}
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
		toolCall.ToolUseData.OutputText = extractToolOutputText(toolCall.Name, result.Text)
	}

	return result
}

func processToolCall(backend UseChatBackend, toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) uctypes.AIToolResult {
	inputJSON, _ := json.Marshal(toolCall.Input)
	logutil.DevPrintf("TOOLUSE name=%s id=%s input=%s approval=%q\n", toolCall.Name, toolCall.ID, utilfn.TruncateString(string(inputJSON), 40), toolCall.ToolUseData.Approval)

	toolDef := chatOpts.GetToolDefinition(toolCall.Name)
	result := processToolCallInternal(backend, toolCall, chatOpts, toolDef, sseHandler)
	finalizeToolCallProcessing(backend, chatOpts, sseHandler, toolCall, toolDef, result, metrics)

	return result
}

func finalizeToolCallProcessing(
	backend UseChatBackend,
	chatOpts uctypes.WaveChatOpts,
	sseHandler *sse.SSEHandlerCh,
	toolCall uctypes.WaveToolCall,
	toolDef *uctypes.ToolDefinition,
	result uctypes.AIToolResult,
	metrics *uctypes.AIMetrics,
) {

	if result.ErrorText != "" {
		log.Printf("  error=%s\n", result.ErrorText)
		metrics.ToolUseErrorCount++
	} else {
		log.Printf("  result=%s\n", utilfn.TruncateString(result.Text, 40))
	}

	if toolDef != nil && toolDef.ToolLogName != "" {
		metrics.ToolDetail[toolDef.ToolLogName]++
	}

	if toolCall.ToolUseData != nil {
		if toolCall.ToolUseData.IsTerminal() {
			toolCall.ToolUseData.Partial = uctypes.BoolPtr(false)
		}
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}
}

type toolExecutionGroup struct {
	Start    int
	End      int
	Parallel bool
}

type toolExecutionLane string

const (
	toolExecutionLaneSequential toolExecutionLane = ""
	toolExecutionLaneReadOnly   toolExecutionLane = "readonly"
	toolExecutionLaneCommand    toolExecutionLane = "command"
)

func isCommandChainTool(toolName string) bool {
	return toolName == "wave_run_command"
}

func buildToolCallDedupKey(toolName string, input any) (string, error) {
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	return toolName + "\n" + string(inputJSON), nil
}

func buildToolCallDedupKeys(toolCalls []uctypes.WaveToolCall) []string {
	keys := make([]string, len(toolCalls))
	for i, toolCall := range toolCalls {
		key, err := buildToolCallDedupKey(toolCall.Name, toolCall.Input)
		if err != nil {
			keys[i] = toolCall.Name + "\n" + toolCall.ID
			continue
		}
		keys[i] = key
	}
	return keys
}

func canProcessToolCallInParallel(toolCall uctypes.WaveToolCall) bool {
	if toolCall.ToolUseData == nil {
		return false
	}
	if toolCall.ToolUseData.Approval == uctypes.ApprovalNeedsApproval {
		return false
	}
	if isCommandChainTool(toolCall.Name) {
		return true
	}
	return readOnlyAgentTools[toolCall.Name]
}

func getToolExecutionLane(toolCall uctypes.WaveToolCall) toolExecutionLane {
	if !canProcessToolCallInParallel(toolCall) {
		return toolExecutionLaneSequential
	}
	if isCommandChainTool(toolCall.Name) {
		return toolExecutionLaneCommand
	}
	return toolExecutionLaneReadOnly
}

func buildToolExecutionPlan(toolCalls []uctypes.WaveToolCall) []toolExecutionGroup {
	if len(toolCalls) == 0 {
		return nil
	}
	var plan []toolExecutionGroup
	for i := 0; i < len(toolCalls); {
		lane := getToolExecutionLane(toolCalls[i])
		start := i
		i++
		if lane != toolExecutionLaneSequential {
			for i < len(toolCalls) && getToolExecutionLane(toolCalls[i]) == lane {
				i++
			}
		}
		plan = append(plan, toolExecutionGroup{
			Start:    start,
			End:      i,
			Parallel: lane != toolExecutionLaneSequential,
		})
	}
	return plan
}

func processToolCallBatch(
	ctx context.Context,
	backend UseChatBackend,
	toolCalls []uctypes.WaveToolCall,
	chatOpts uctypes.WaveChatOpts,
	sseHandler *sse.SSEHandlerCh,
	metrics *uctypes.AIMetrics,
) []uctypes.AIToolResult {
	results := make([]uctypes.AIToolResult, len(toolCalls))
	type batchResult struct {
		index    int
		result   uctypes.AIToolResult
		toolCall uctypes.WaveToolCall
		toolDef  *uctypes.ToolDefinition
	}
	resultCh := make(chan batchResult, len(toolCalls))

	var wg sync.WaitGroup
	for idx := range toolCalls {
		toolCall := toolCalls[idx]
		toolDef := chatOpts.GetToolDefinition(toolCall.Name)
		wg.Add(1)
		go func(index int, call uctypes.WaveToolCall, def *uctypes.ToolDefinition) {
			defer wg.Done()
			if ctx.Err() != nil {
				resultCh <- batchResult{
					index:    index,
					result:   uctypes.AIToolResult{ToolName: call.Name, ToolUseID: call.ID, ErrorText: "cancelled"},
					toolCall: call,
					toolDef:  def,
				}
				return
			}
			inputJSON, _ := json.Marshal(call.Input)
			logutil.DevPrintf("TOOLUSE(P) name=%s id=%s input=%s approval=%q\n", call.Name, call.ID, utilfn.TruncateString(string(inputJSON), 40), call.ToolUseData.Approval)
			resultCh <- batchResult{
				index:    index,
				result:   processToolCallInternal(backend, call, chatOpts, def, sseHandler),
				toolCall: call,
				toolDef:  def,
			}
		}(idx, toolCall, toolDef)
	}

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	for item := range resultCh {
		results[item.index] = item.result
		finalizeToolCallProcessing(backend, chatOpts, sseHandler, item.toolCall, item.toolDef, item.result, metrics)
	}
	return results
}

func processAllToolCalls(ctx context.Context, backend UseChatBackend, stopReason *uctypes.WaveStopReason, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) {
	existingTaskState := chatstore.DefaultChatStore.GetSession(chatOpts.ChatId)
	var currentTaskState *uctypes.UITaskProgressState
	if existingTaskState != nil {
		currentTaskState = existingTaskState.TaskState
	}
	taskState := mergeTaskStateForToolCalls(currentTaskState, buildTaskStateFromToolCalls(stopReason.ToolCalls))
	if taskState != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			TaskState: taskState,
			LastState: string(taskState.Status),
		})
		_ = sseHandler.AiMsgData("data-taskstate", taskState.PlanId, *taskState)
	}
	// Create and send all data-tooluse packets at the beginning
	for i := range stopReason.ToolCalls {
		toolCall := &stopReason.ToolCalls[i]
		// Create toolUseData from the tool call input
		var argsJSON string
		if toolCall.Input != nil {
			argsBytes, err := json.Marshal(toolCall.Input)
			if err == nil {
				argsJSON = string(argsBytes)
			}
		}
		toolUseData := aiutil.CreateToolUseData(toolCall.ID, toolCall.Name, argsJSON, chatOpts)
		stopReason.ToolCalls[i].ToolUseData = &toolUseData
		log.Printf("AI data-tooluse %s\n", toolCall.ID)
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, toolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, toolUseData)
		if toolUseData.Approval == uctypes.ApprovalNeedsApproval && toolUseData.Status != uctypes.ToolUseStatusError {
			RegisterToolApproval(toolCall.ID, sseHandler)
		}
	}
	// At this point, all ToolCalls are guaranteed to have non-nil ToolUseData

	for _, toolCall := range stopReason.ToolCalls {
		var params map[string]any
		if toolCall.Input != nil {
			if m, ok := toolCall.Input.(map[string]any); ok {
				params = m
			}
		}
		RecordToolCall(chatOpts.ChatId, toolCall.Name, toolCall.ID, params)
	}

	toolResults := make([]uctypes.AIToolResult, len(stopReason.ToolCalls))
	processed := make([]bool, len(stopReason.ToolCalls))
	dedupKeys := buildToolCallDedupKeys(stopReason.ToolCalls)
	seenResultsByKey := make(map[string]uctypes.AIToolResult)
	for _, group := range buildToolExecutionPlan(stopReason.ToolCalls) {
		if ctx.Err() != nil {
			log.Printf("AI tool processing stopped (context cancelled): %v\n", ctx.Err())
			break
		}
		if sseHandler.Err() != nil {
			log.Printf("AI tool processing stopped: %v\n", sseHandler.Err())
			break
		}
		if group.Parallel {
			var uniqueToolCalls []uctypes.WaveToolCall
			var uniqueIndices []int
			for idx := group.Start; idx < group.End; idx++ {
				key := dedupKeys[idx]
				if prior, ok := seenResultsByKey[key]; ok {
					toolResults[idx] = prior
					processed[idx] = true
					continue
				}
				alreadyQueued := false
				for _, existingIndex := range uniqueIndices {
					if dedupKeys[existingIndex] == key {
						alreadyQueued = true
						break
					}
				}
				if alreadyQueued {
					continue
				}
				uniqueToolCalls = append(uniqueToolCalls, stopReason.ToolCalls[idx])
				uniqueIndices = append(uniqueIndices, idx)
			}
			results := processToolCallBatch(ctx, backend, uniqueToolCalls, chatOpts, sseHandler, metrics)
			for idx, result := range results {
				origIndex := uniqueIndices[idx]
				key := dedupKeys[origIndex]
				seenResultsByKey[key] = result
				if taskState != nil {
					advanceTaskStateForToolResult(taskState, result)
					chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
						TaskState: taskState,
						LastState: string(taskState.Status),
					})
					_ = sseHandler.AiMsgData("data-taskstate", taskState.PlanId, *taskState)
				}
				toolResults[origIndex] = result
				processed[origIndex] = true
				for dupIndex := group.Start; dupIndex < group.End; dupIndex++ {
					if dupIndex == origIndex || processed[dupIndex] || dedupKeys[dupIndex] != key {
						continue
					}
					toolResults[dupIndex] = result
					processed[dupIndex] = true
					if stopReason.ToolCalls[dupIndex].ToolUseData != nil {
						stopReason.ToolCalls[dupIndex].ToolUseData.Status = stopReason.ToolCalls[origIndex].ToolUseData.Status
						stopReason.ToolCalls[dupIndex].ToolUseData.ErrorMessage = stopReason.ToolCalls[origIndex].ToolUseData.ErrorMessage
						stopReason.ToolCalls[dupIndex].ToolUseData.OutputText = stopReason.ToolCalls[origIndex].ToolUseData.OutputText
						stopReason.ToolCalls[dupIndex].ToolUseData.DurationMs = stopReason.ToolCalls[origIndex].ToolUseData.DurationMs
						stopReason.ToolCalls[dupIndex].ToolUseData.ToolDesc = stopReason.ToolCalls[origIndex].ToolUseData.ToolDesc
						stopReason.ToolCalls[dupIndex].ToolUseData.Partial = stopReason.ToolCalls[origIndex].ToolUseData.Partial
						_ = sseHandler.AiMsgData("data-tooluse", stopReason.ToolCalls[dupIndex].ID, *stopReason.ToolCalls[dupIndex].ToolUseData)
						updateToolUseDataInChat(backend, chatOpts, stopReason.ToolCalls[dupIndex].ID, *stopReason.ToolCalls[dupIndex].ToolUseData)
					}
				}
			}
			continue
		}
		toolCall := stopReason.ToolCalls[group.Start]
		key := dedupKeys[group.Start]
		if prior, ok := seenResultsByKey[key]; ok {
			toolResults[group.Start] = prior
			processed[group.Start] = true
			if toolCall.ToolUseData != nil {
				_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
				updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
			}
			continue
		}
		result := processToolCall(backend, toolCall, chatOpts, sseHandler, metrics)
		toolResults[group.Start] = result
		processed[group.Start] = true
		seenResultsByKey[key] = result
		if refreshedTaskState, changed := refreshTaskStateFromStore(chatOpts.ChatId, taskState); changed {
			taskState = refreshedTaskState
			_ = sseHandler.AiMsgData("data-taskstate", taskState.PlanId, *taskState)
		}
	}

	// Cleanup: unregister approvals, remove incomplete/canceled tool calls, and filter results
	var filteredResults []uctypes.AIToolResult
	for i, toolCall := range stopReason.ToolCalls {
		UnregisterToolApproval(toolCall.ID)
		hasResult := processed[i]
		shouldRemove := !hasResult || (toolCall.ToolUseData != nil && toolCall.ToolUseData.Approval == uctypes.ApprovalCanceled)
		if shouldRemove {
			backend.RemoveToolUseCall(chatOpts.ChatId, toolCall.ID)
		} else if hasResult {
			filteredResults = append(filteredResults, toolResults[i])
		}
	}

	if len(filteredResults) > 0 {
		toolResultMsgs, err := backend.ConvertToolResultsToNativeChatMessage(filteredResults)
		if err != nil {
			log.Printf("Failed to convert tool results to native chat messages: %v", err)
		} else {
			for _, msg := range toolResultMsgs {
				if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg); err != nil {
					log.Printf("Failed to post tool result message: %v", err)
				}
			}
		}
	}
}
