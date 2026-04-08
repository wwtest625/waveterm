// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/user"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const DefaultAPI = uctypes.APIType_OpenAIResponses
const DefaultMaxTokens = 4 * 1024
const BuilderMaxTokens = 24 * 1024

var (
	globalRateLimitInfo = &uctypes.RateLimitInfo{Unknown: true}
	rateLimitLock       sync.Mutex

	activeChats = ds.MakeSyncMap[bool]() // key is chatid
)

func getSystemPrompt(apiType string, model string, provider string, isBuilder bool, hasToolsCapability bool, widgetAccess bool, agentMode AgentMode, currentMessageText string) []string {
	if isBuilder {
		return []string{}
	}
	useNoToolsPrompt := !hasToolsCapability || (!widgetAccess && provider != uctypes.AIProvider_Wave)
	basePrompt := SystemPromptText_OpenAI
	if useNoToolsPrompt {
		basePrompt = SystemPromptText_NoTools
	} else {
		basePrompt = strings.TrimSpace(basePrompt + " " + SystemPromptText_EditWorkflowAddOn)
	}
	basePrompt = strings.TrimSpace(basePrompt + " " + getModeAwareSystemPromptText(provider, agentMode))
	modelLower := strings.ToLower(model)
	needsStrictToolAddOn, _ := regexp.MatchString(`(?i)\b(mistral|o?llama|qwen|mixtral|yi|phi|deepseek)\b`, modelLower)
	if needsStrictToolAddOn && !useNoToolsPrompt {
		return []string{basePrompt, SystemPromptText_StrictToolAddOn}
	}
	return []string{basePrompt}
}

func isLocalEndpoint(endpoint string) bool {
	if endpoint == "" {
		return false
	}
	endpointLower := strings.ToLower(endpoint)
	return strings.Contains(endpointLower, "localhost") || strings.Contains(endpointLower, "127.0.0.1")
}

func getWaveAISettings(premium bool, builderMode bool, rtInfo waveobj.ObjRTInfo, aiModeName string) (*uctypes.AIOptsType, error) {
	maxTokens := DefaultMaxTokens
	if builderMode {
		maxTokens = BuilderMaxTokens
	}
	if rtInfo.WaveAIMaxOutputTokens > 0 {
		maxTokens = rtInfo.WaveAIMaxOutputTokens
	}
	aiMode, config, err := resolveAIMode(aiModeName, premium)
	if err != nil {
		return nil, err
	}
	if config.WaveAICloud && !telemetry.IsTelemetryEnabled() {
		return nil, fmt.Errorf("Wave AI cloud modes require telemetry to be enabled")
	}
	apiToken := config.APIToken
	if apiToken == "" && config.APITokenSecretName != "" {
		secret, exists, err := secretstore.GetSecret(config.APITokenSecretName)
		if err != nil {
			return nil, fmt.Errorf("failed to retrieve secret %s: %w", config.APITokenSecretName, err)
		}
		secret = strings.TrimSpace(secret)
		if !exists || secret == "" {
			return nil, fmt.Errorf("secret %s not found or empty", config.APITokenSecretName)
		}
		apiToken = secret
	}

	var baseUrl string
	if config.Endpoint != "" {
		baseUrl = config.Endpoint
	} else {
		return nil, fmt.Errorf("no ai:endpoint configured for AI mode %s", aiMode)
	}

	thinkingLevel := config.ThinkingLevel
	if thinkingLevel == "" {
		thinkingLevel = uctypes.ThinkingLevelMedium
	}
	verbosity := config.Verbosity
	if verbosity == "" {
		verbosity = uctypes.VerbosityLevelMedium // default to medium
	}
	opts := &uctypes.AIOptsType{
		Provider:      config.Provider,
		APIType:       config.APIType,
		Model:         config.Model,
		MaxTokens:     maxTokens,
		ThinkingLevel: thinkingLevel,
		Verbosity:     verbosity,
		AIMode:        aiMode,
		Endpoint:      baseUrl,
		ProxyURL:      config.ProxyURL,
		Capabilities:  config.Capabilities,
		WaveAIPremium: config.WaveAIPremium,
	}
	if apiToken != "" {
		opts.APIToken = apiToken
	}
	return opts, nil
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}

func shouldUsePremium() bool {
	info := GetGlobalRateLimit()
	if info == nil || info.Unknown {
		return true
	}
	if info.PReq > 0 {
		return true
	}
	nowEpoch := time.Now().Unix()
	if nowEpoch >= info.ResetEpoch {
		return true
	}
	return false
}

func updateRateLimit(info *uctypes.RateLimitInfo) {
	if info == nil {
		return
	}
	rateLimitLock.Lock()
	defer rateLimitLock.Unlock()
	globalRateLimitInfo = info
	go func() {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_WaveAIRateLimit,
			Data:  info,
		})
	}()
}

func GetGlobalRateLimit() *uctypes.RateLimitInfo {
	rateLimitLock.Lock()
	defer rateLimitLock.Unlock()
	return globalRateLimitInfo
}

func runAIChatStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.WaveChatOpts, cont *uctypes.WaveContinueResponse) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, error) {
	if chatOpts.Config.APIType == uctypes.APIType_OpenAIResponses && shouldUseChatCompletionsAPI(chatOpts.Config.Model) {
		return nil, nil, fmt.Errorf("Chat completions API not available (must use newer OpenAI models)")
	}
	stopReason, messages, rateLimitInfo, err := backend.RunChatStep(ctx, sseHandler, chatOpts, cont)
	updateRateLimit(rateLimitInfo)
	return stopReason, messages, err
}

func getUsage(msgs []uctypes.GenAIMessage) uctypes.AIUsage {
	var rtn uctypes.AIUsage
	var found bool
	for _, msg := range msgs {
		if usage := msg.GetUsage(); usage != nil {
			if !found {
				rtn = *usage
				found = true
			} else {
				rtn.InputTokens += usage.InputTokens
				rtn.OutputTokens += usage.OutputTokens
				rtn.NativeWebSearchCount += usage.NativeWebSearchCount
			}
		}
	}
	return rtn
}

func GetChatUsage(chat *uctypes.AIChat) uctypes.AIUsage {
	usage := getUsage(chat.NativeMessages)
	usage.APIType = chat.APIType
	usage.Model = chat.Model
	return usage
}

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
	if toolName == "wave_get_command_result" || toolName == "term_command_output" || toolName == "term_get_scrollback" {
		var outputMap map[string]any
		if err := json.Unmarshal([]byte(trimmedResult), &outputMap); err == nil {
			for _, key := range []string{"output", "text", "stdout", "content"} {
				if rawText, ok := outputMap[key].(string); ok && strings.TrimSpace(rawText) != "" {
					return truncateToolOutputText(rawText)
				}
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

var waveCommandResultPollers = struct {
	mu   sync.Mutex
	jobs map[string]struct{}
}{
	jobs: make(map[string]struct{}),
}

func tryStartWaveCommandResultPoller(
	ctx context.Context,
	chatOpts uctypes.WaveChatOpts,
	backend UseChatBackend,
	toolCallID string,
	snapshot *wshrpc.CommandAgentGetCommandResultRtnData,
) {
	if snapshot == nil || strings.TrimSpace(snapshot.JobId) == "" {
		return
	}
	pollerKey := chatOpts.ChatId + ":" + toolCallID
	waveCommandResultPollers.mu.Lock()
	if _, exists := waveCommandResultPollers.jobs[pollerKey]; exists {
		waveCommandResultPollers.mu.Unlock()
		return
	}
	waveCommandResultPollers.jobs[pollerKey] = struct{}{}
	waveCommandResultPollers.mu.Unlock()

	initialToolUse := uctypes.UIMessageDataToolUse{
		ToolCallId: toolCallID,
		ToolName:   "wave_get_command_result",
		Status:     uctypes.ToolUseStatusCompleted,
		JobId:      snapshot.JobId,
		DurationMs: snapshot.DurationMs,
		OutputText: extractToolOutputText("wave_get_command_result", snapshot.Output),
	}
	if snapshot.Status == "running" {
		initialToolUse.Status = "running"
	}
	if strings.TrimSpace(snapshot.Error) != "" {
		initialToolUse.Status = uctypes.ToolUseStatusError
		initialToolUse.ErrorMessage = snapshot.Error
	}

	go func() {
		defer func() {
			waveCommandResultPollers.mu.Lock()
			delete(waveCommandResultPollers.jobs, pollerKey)
			waveCommandResultPollers.mu.Unlock()
		}()

		current := initialToolUse
		currentOutput := current.OutputText
		currentDuration := current.DurationMs
		terminalSeenAt := time.Time{}
		deadline := time.Now().Add(60 * time.Second)
		rpcClient := wshclient.GetBareRpcClient()
		for {
			if err := ctx.Err(); err != nil {
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = "command result polling canceled"
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if time.Now().After(deadline) {
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = "command result polling timed out"
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			result, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
				JobId:     snapshot.JobId,
				TailBytes: 32768,
			}, nil)
			if err != nil {
				log.Printf("failed to poll wave command result for %s: %v", snapshot.JobId, err)
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = err.Error()
				current.DurationMs = currentDuration
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			current.DurationMs = result.DurationMs
			current.OutputText = extractToolOutputText("wave_get_command_result", result.Output)
			if result.Status == "error" {
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = result.Error
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if result.Status == "running" {
				current.Status = "running"
				current.ErrorMessage = ""
				if current.OutputText != currentOutput || current.DurationMs != currentDuration {
					currentOutput = current.OutputText
					currentDuration = current.DurationMs
					updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				}
				select {
				case <-ctx.Done():
				case <-time.After(250 * time.Millisecond):
				}
				continue
			}
			if shouldReturnWaveCommandResult(result, time.Now(), deadline, &terminalSeenAt) {
				current.Status = uctypes.ToolUseStatusCompleted
				current.ErrorMessage = ""
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if current.OutputText != currentOutput || current.DurationMs != currentDuration {
				currentOutput = current.OutputText
				currentDuration = current.DurationMs
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
			}
			select {
			case <-ctx.Done():
			case <-time.After(250 * time.Millisecond):
			}
		}
	}()
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
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}

	agentMode := resolveAgentMode(chatOpts.AgentMode)
	if err := validateToolForAgentMode(agentMode, toolCall.Name); err != nil {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = err.Error()
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: err.Error(),
		}
	}
	toolCall.ToolUseData.Approval = applyAgentModeApprovalPolicy(agentMode, toolCall.Name, toolCall.ToolUseData.Approval)

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
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}

	toolCall.ToolUseData.RunTs = time.Now().UnixMilli()
	result := ResolveToolCall(toolDef, toolCall, chatOpts)

	if result.ErrorText != "" {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = result.ErrorText
		toolCall.ToolUseData.OutputText = ""
	} else if toolCall.Name == "wave_get_command_result" {
		if snapshot, ok := parseWaveCommandResultSnapshot(result.Text); ok {
			toolCall.ToolUseData.JobId = snapshot.JobId
			toolCall.ToolUseData.DurationMs = snapshot.DurationMs
			toolCall.ToolUseData.OutputText = extractToolOutputText(toolCall.Name, result.Text)
			if snapshot.Status == "running" {
				toolCall.ToolUseData.Status = "running"
				toolCall.ToolUseData.ErrorMessage = ""
				tryStartWaveCommandResultPoller(sseHandler.Context(), chatOpts, backend, toolCall.ID, snapshot)
			} else if snapshot.Status == "error" || strings.TrimSpace(snapshot.Error) != "" {
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
				toolCall.ToolUseData.ErrorMessage = snapshot.Error
			} else {
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
				toolCall.ToolUseData.ErrorMessage = ""
			}
		} else {
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
			toolCall.ToolUseData.OutputText = extractToolOutputText(toolCall.Name, result.Text)
		}
	} else {
		if toolCall.Name == "wave_run_command" {
			toolCall.ToolUseData.JobId = parseWaveCommandJobID(result.Text)
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
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}
}

type toolExecutionGroup struct {
	Start    int
	End      int
	Parallel bool
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
	switch toolCall.Name {
	case "capture_screenshot", "term_get_scrollback", "term_command_output", "builder_list_files", "wave_get_command_result", "wave_run_command":
		return true
	default:
		return false
	}
}

func buildToolExecutionPlan(toolCalls []uctypes.WaveToolCall) []toolExecutionGroup {
	if len(toolCalls) == 0 {
		return nil
	}
	var plan []toolExecutionGroup
	for i := 0; i < len(toolCalls); {
		parallel := canProcessToolCallInParallel(toolCalls[i])
		start := i
		i++
		if parallel {
			for i < len(toolCalls) && canProcessToolCallInParallel(toolCalls[i]) {
				i++
			}
		}
		plan = append(plan, toolExecutionGroup{
			Start:    start,
			End:      i,
			Parallel: parallel,
		})
	}
	return plan
}

func processToolCallBatch(
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

	wg.Wait()
	close(resultCh)

	finalized := make([]batchResult, len(toolCalls))
	for item := range resultCh {
		finalized[item.index] = item
	}
	for idx, item := range finalized {
		results[idx] = item.result
		finalizeToolCallProcessing(backend, chatOpts, sseHandler, item.toolCall, item.toolDef, item.result, metrics)
	}
	return results
}

func processAllToolCalls(backend UseChatBackend, stopReason *uctypes.WaveStopReason, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) {
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
		if toolUseData.Approval == uctypes.ApprovalNeedsApproval {
			RegisterToolApproval(toolCall.ID, sseHandler)
		}
	}
	// At this point, all ToolCalls are guaranteed to have non-nil ToolUseData

	toolResults := make([]uctypes.AIToolResult, len(stopReason.ToolCalls))
	processed := make([]bool, len(stopReason.ToolCalls))
	dedupKeys := buildToolCallDedupKeys(stopReason.ToolCalls)
	seenResultsByKey := make(map[string]uctypes.AIToolResult)
	for _, group := range buildToolExecutionPlan(stopReason.ToolCalls) {
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
					if stopReason.ToolCalls[idx].ToolUseData != nil {
						stopReason.ToolCalls[idx].ToolUseData.Status = stopReason.ToolCalls[idx].ToolUseData.Status
					}
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
			results := processToolCallBatch(backend, uniqueToolCalls, chatOpts, sseHandler, metrics)
			for idx, result := range results {
				origIndex := uniqueIndices[idx]
				key := dedupKeys[origIndex]
				seenResultsByKey[key] = result
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

func RunAIChat(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.WaveChatOpts) (*uctypes.AIMetrics, error) {
	if !activeChats.SetUnless(chatOpts.ChatId, true) {
		return nil, fmt.Errorf("chat %s is already running", chatOpts.ChatId)
	}
	defer activeChats.Delete(chatOpts.ChatId)

	stepNum := chatstore.DefaultChatStore.CountUserMessages(chatOpts.ChatId)
	aiProvider := chatOpts.Config.Provider
	if aiProvider == "" {
		aiProvider = uctypes.AIProvider_Custom
	}
	isLocal := isLocalEndpoint(chatOpts.Config.Endpoint)
	metrics := &uctypes.AIMetrics{
		ChatId:  chatOpts.ChatId,
		StepNum: stepNum,
		Usage: uctypes.AIUsage{
			APIType: chatOpts.Config.APIType,
			Model:   chatOpts.Config.Model,
		},
		WidgetAccess:  chatOpts.WidgetAccess,
		ToolDetail:    make(map[string]int),
		ThinkingLevel: chatOpts.Config.ThinkingLevel,
		AIMode:        chatOpts.Config.AIMode,
		AIProvider:    aiProvider,
		IsLocal:       isLocal,
	}
	firstStep := true
	var cont *uctypes.WaveContinueResponse
	for {
		if chatOpts.TabStateGenerator != nil {
			tabState, tabTools, tabId, tabErr := chatOpts.TabStateGenerator()
			if tabErr == nil {
				chatOpts.TabState = tabState
				chatOpts.TabTools = tabTools
				chatOpts.TabId = tabId
			}
		}
		if chatOpts.BuilderAppGenerator != nil {
			appGoFile, appStaticFiles, platformInfo, appErr := chatOpts.BuilderAppGenerator()
			if appErr == nil {
				chatOpts.AppGoFile = appGoFile
				chatOpts.AppStaticFiles = appStaticFiles
				chatOpts.PlatformInfo = platformInfo
			}
		}
		stopReason, rtnMessages, err := runAIChatStep(ctx, sseHandler, backend, chatOpts, cont)
		metrics.RequestCount++
		if chatOpts.Config.IsWaveProxy() {
			metrics.ProxyReqCount++
			if chatOpts.Config.IsPremiumModel() {
				metrics.PremiumReqCount++
			}
		}
		if stopReason != nil {
			logutil.DevPrintf("stopreason: %s (%s) (%s) (%s)\n", stopReason.Kind, stopReason.ErrorText, stopReason.ErrorType, stopReason.RawReason)
		}
		if len(rtnMessages) > 0 {
			usage := getUsage(rtnMessages)
			log.Printf("usage: input=%d output=%d websearch=%d\n", usage.InputTokens, usage.OutputTokens, usage.NativeWebSearchCount)
			metrics.Usage.InputTokens += usage.InputTokens
			metrics.Usage.OutputTokens += usage.OutputTokens
			metrics.Usage.NativeWebSearchCount += usage.NativeWebSearchCount
			if usage.Model != "" && metrics.Usage.Model != usage.Model {
				metrics.Usage.Model = "mixed"
			}
		}
		if firstStep && err != nil {
			metrics.HadError = true
			return metrics, fmt.Errorf("failed to stream %s chat: %w", chatOpts.Config.APIType, err)
		}
		if err != nil {
			metrics.HadError = true
			_ = sseHandler.AiMsgError(err.Error())
			_ = sseHandler.AiMsgFinish("", nil)
			break
		}
		for _, msg := range rtnMessages {
			if msg != nil {
				if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg); err != nil {
					log.Printf("Failed to post message: %v", err)
				}
			}
		}
		firstStep = false
		if stopReason != nil && stopReason.Kind == uctypes.StopKindPremiumRateLimit && chatOpts.Config.APIType == uctypes.APIType_OpenAIResponses && chatOpts.Config.Model == uctypes.PremiumOpenAIModel {
			log.Printf("Premium rate limit hit with %s, switching to %s\n", uctypes.PremiumOpenAIModel, uctypes.DefaultOpenAIModel)
			cont = &uctypes.WaveContinueResponse{
				Model:            uctypes.DefaultOpenAIModel,
				ContinueFromKind: uctypes.StopKindPremiumRateLimit,
			}
			continue
		}
		if stopReason != nil && stopReason.Kind == uctypes.StopKindToolUse {
			metrics.ToolUseCount += len(stopReason.ToolCalls)
			processAllToolCalls(backend, stopReason, chatOpts, sseHandler, metrics)
			cont = &uctypes.WaveContinueResponse{
				Model:            chatOpts.Config.Model,
				ContinueFromKind: uctypes.StopKindToolUse,
			}
			continue
		}
		break
	}
	return metrics, nil
}

func ResolveToolCall(toolDef *uctypes.ToolDefinition, toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts) (result uctypes.AIToolResult) {
	result = uctypes.AIToolResult{
		ToolName:  toolCall.Name,
		ToolUseID: toolCall.ID,
	}

	defer func() {
		if r := recover(); r != nil {
			result.ErrorText = fmt.Sprintf("panic in tool execution: %v", r)
			result.Text = ""
		}
	}()

	if toolDef == nil {
		result.ErrorText = fmt.Sprintf("tool '%s' not found", toolCall.Name)
		return
	}

	// Try ToolTextCallback first, then ToolAnyCallback
	if toolDef.ToolTextCallback != nil {
		text, err := toolDef.ToolTextCallback(toolCall.Input)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			result.Text = text
			// Recompute tool description with the result
			if toolDef.ToolCallDesc != nil && toolCall.ToolUseData != nil {
				toolCall.ToolUseData.ToolDesc = toolDef.ToolCallDesc(toolCall.Input, text, toolCall.ToolUseData)
			}
		}
	} else if toolDef.ToolAnyCallback != nil {
		output, err := toolDef.ToolAnyCallback(toolCall.Input, toolCall.ToolUseData)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			// Marshal the result to JSON
			jsonBytes, marshalErr := json.Marshal(output)
			if marshalErr != nil {
				result.ErrorText = fmt.Sprintf("failed to marshal tool output: %v", marshalErr)
			} else {
				result.Text = string(jsonBytes)
				// Recompute tool description with the result
				if toolDef.ToolCallDesc != nil && toolCall.ToolUseData != nil {
					toolCall.ToolUseData.ToolDesc = toolDef.ToolCallDesc(toolCall.Input, output, toolCall.ToolUseData)
				}
			}
		}
	} else {
		result.ErrorText = fmt.Sprintf("tool '%s' has no callback functions", toolCall.Name)
	}

	return
}

func WaveAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, message *uctypes.AIMessage, chatOpts uctypes.WaveChatOpts) error {
	startTime := time.Now()
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		TabId:     chatOpts.TabId,
		LastState: "submitting",
	})
	chatstore.DefaultChatStore.UpdateSessionPreviewFromMessage(chatOpts.ChatId, &chatOpts.Config, chatOpts.TabId, message)

	// Convert AIMessage to native chat message using backend
	backend, err := GetBackendByAPIType(chatOpts.Config.APIType)
	if err != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			LastState: "failed",
		})
		return err
	}
	convertedMessage, err := backend.ConvertAIMessageToNativeChatMessage(*message)
	if err != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			LastState: "failed",
		})
		return fmt.Errorf("message conversion failed: %w", err)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, convertedMessage); err != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			LastState: "failed",
		})
		return fmt.Errorf("failed to store message: %w", err)
	}

	metrics, err := RunAIChat(ctx, sseHandler, backend, chatOpts)
	sessionState := "completed"
	if err != nil {
		sessionState = "failed"
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		LastState: sessionState,
	})
	if metrics != nil {
		metrics.RequestDuration = int(time.Since(startTime).Milliseconds())
		for _, part := range message.Parts {
			if part.Type == uctypes.AIMessagePartTypeText {
				metrics.TextLen += len(part.Text)
			} else if part.Type == uctypes.AIMessagePartTypeFile {
				mimeType := strings.ToLower(part.MimeType)
				if strings.HasPrefix(mimeType, "image/") {
					metrics.ImageCount++
				} else if mimeType == "application/pdf" {
					metrics.PDFCount++
				} else {
					metrics.TextDocCount++
				}
			}
		}
		log.Printf("WaveAI call metrics: requests=%d tools=%d premium=%d proxy=%d images=%d pdfs=%d textdocs=%d textlen=%d duration=%dms error=%v\n",
			metrics.RequestCount, metrics.ToolUseCount, metrics.PremiumReqCount, metrics.ProxyReqCount,
			metrics.ImageCount, metrics.PDFCount, metrics.TextDocCount, metrics.TextLen, metrics.RequestDuration, metrics.HadError)

		sendAIMetricsTelemetry(ctx, metrics)
	}
	return err
}

func sendAIMetricsTelemetry(ctx context.Context, metrics *uctypes.AIMetrics) {
	event := telemetrydata.MakeTEvent("waveai:post", telemetrydata.TEventProps{
		WaveAIAPIType:              metrics.Usage.APIType,
		WaveAIModel:                metrics.Usage.Model,
		WaveAIChatId:               metrics.ChatId,
		WaveAIStepNum:              metrics.StepNum,
		WaveAIInputTokens:          metrics.Usage.InputTokens,
		WaveAIOutputTokens:         metrics.Usage.OutputTokens,
		WaveAINativeWebSearchCount: metrics.Usage.NativeWebSearchCount,
		WaveAIRequestCount:         metrics.RequestCount,
		WaveAIToolUseCount:         metrics.ToolUseCount,
		WaveAIToolUseErrorCount:    metrics.ToolUseErrorCount,
		WaveAIToolDetail:           metrics.ToolDetail,
		WaveAIPremiumReq:           metrics.PremiumReqCount,
		WaveAIProxyReq:             metrics.ProxyReqCount,
		WaveAIHadError:             metrics.HadError,
		WaveAIImageCount:           metrics.ImageCount,
		WaveAIPDFCount:             metrics.PDFCount,
		WaveAITextDocCount:         metrics.TextDocCount,
		WaveAITextLen:              metrics.TextLen,
		WaveAIFirstByteMs:          metrics.FirstByteLatency,
		WaveAIRequestDurMs:         metrics.RequestDuration,
		WaveAIWidgetAccess:         metrics.WidgetAccess,
		WaveAIThinkingLevel:        metrics.ThinkingLevel,
		WaveAIMode:                 metrics.AIMode,
		WaveAIProvider:             metrics.AIProvider,
		WaveAIIsLocal:              metrics.IsLocal,
	})
	_ = telemetry.RecordTEvent(ctx, event)
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	TabId        string            `json:"tabid,omitempty"`
	BlockId      string            `json:"blockid,omitempty"`
	BuilderId    string            `json:"builderid,omitempty"`
	BuilderAppId string            `json:"builderappid,omitempty"`
	ChatID       string            `json:"chatid"`
	Msg          uctypes.AIMessage `json:"msg"`
	WidgetAccess bool              `json:"widgetaccess,omitempty"`
	AIMode       string            `json:"aimode"`
	AgentMode    string            `json:"agentmode,omitempty"`
}

func WaveAIPostMessageHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow POST method
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PostMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate chatid is present and is a UUID
	if req.ChatID == "" {
		http.Error(w, "chatid is required in request body", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.ChatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Validate the message
	if err := req.Msg.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("Message validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Get RTInfo from TabId or BuilderId
	var rtInfo *waveobj.ObjRTInfo
	if req.TabId != "" {
		oref := waveobj.MakeORef(waveobj.OType_Tab, req.TabId)
		rtInfo = wstore.GetRTInfo(oref)
	} else if req.BuilderId != "" {
		oref := waveobj.MakeORef(waveobj.OType_Builder, req.BuilderId)
		rtInfo = wstore.GetRTInfo(oref)
	}
	if rtInfo == nil {
		rtInfo = &waveobj.ObjRTInfo{}
	}

	// Get WaveAI settings
	premium := shouldUsePremium()
	builderMode := req.BuilderId != ""
	if req.AIMode == "" {
		http.Error(w, "aimode is required in request body", http.StatusBadRequest)
		return
	}
	aiOpts, err := getWaveAISettings(premium, builderMode, *rtInfo, req.AIMode)
	if err != nil {
		http.Error(w, fmt.Sprintf("WaveAI configuration error: %v", err), http.StatusInternalServerError)
		return
	}
	effectiveWidgetAccess := req.WidgetAccess || aiOpts.Provider == uctypes.AIProvider_Wave

	// Call the core WaveAIPostMessage function
	chatOpts := uctypes.WaveChatOpts{
		ChatId:               req.ChatID,
		ClientId:             wstore.GetClientId(),
		Config:               *aiOpts,
		AgentMode:            string(resolveAgentMode(req.AgentMode)),
		CurrentMessageText:   req.Msg.GetContent(),
		WidgetAccess:         effectiveWidgetAccess,
		AllowNativeWebSearch: true,
		TabId:                req.TabId,
		BlockId:              req.BlockId,
		BuilderId:            req.BuilderId,
		BuilderAppId:         req.BuilderAppId,
	}
	chatOpts.SystemPrompt = getSystemPrompt(chatOpts.Config.APIType, chatOpts.Config.Model, chatOpts.Config.Provider, chatOpts.BuilderId != "", chatOpts.Config.HasCapability(uctypes.AICapabilityTools), effectiveWidgetAccess, resolveAgentMode(req.AgentMode), req.Msg.GetContent())

	if req.TabId != "" {
		chatOpts.TabStateGenerator = func() (string, []uctypes.ToolDefinition, string, error) {
			tabState, tabTools, err := GenerateTabStateAndTools(r.Context(), req.TabId, effectiveWidgetAccess, &chatOpts)
			return tabState, tabTools, req.TabId, err
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.BuilderAppGenerator = func() (string, string, string, error) {
			return generateBuilderAppData(req.BuilderAppId)
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.Tools = append(chatOpts.Tools,
			GetBuilderWriteAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderEditAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderListFilesToolDefinition(req.BuilderAppId),
		)
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	if err := WaveAIPostMessageWrap(r.Context(), sseHandler, &req.Msg, chatOpts); err != nil {
		http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
		return
	}
}

func WaveAIGetChatHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get chatid from URL parameters
	chatID := r.URL.Query().Get("chatid")
	if chatID == "" {
		http.Error(w, "chatid parameter is required", http.StatusBadRequest)
		return
	}

	// Validate chatid is a UUID
	if _, err := uuid.Parse(chatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		http.Error(w, "chat not found", http.StatusNotFound)
		return
	}

	// Set response headers for JSON
	w.Header().Set("Content-Type", "application/json")

	// Encode and return the chat
	if err := json.NewEncoder(w).Encode(chat); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
		return
	}
}

// CreateWriteTextFileDiff generates a diff for write_text_file or edit_text_file tool calls.
// Returns the original content, modified content, and any error.
// For Anthropic, this returns an unimplemented error.
func CreateWriteTextFileDiff(ctx context.Context, chatId string, toolCallId string) ([]byte, []byte, error) {
	aiChat := chatstore.DefaultChatStore.Get(chatId)
	if aiChat == nil {
		return nil, nil, fmt.Errorf("chat not found: %s", chatId)
	}

	backend, err := GetBackendByAPIType(aiChat.APIType)
	if err != nil {
		return nil, nil, err
	}

	funcCallInput := backend.GetFunctionCallInputByToolCallId(*aiChat, toolCallId)
	if funcCallInput == nil {
		return nil, nil, fmt.Errorf("tool call not found: %s", toolCallId)
	}

	toolName := funcCallInput.Name
	if toolName != "write_text_file" && toolName != "edit_text_file" {
		return nil, nil, fmt.Errorf("tool call %s is not a write_text_file or edit_text_file (got: %s)", toolCallId, toolName)
	}

	var backupFileName string
	if funcCallInput.ToolUseData != nil {
		backupFileName = funcCallInput.ToolUseData.WriteBackupFileName
	}

	var parsedArguments any
	if err := json.Unmarshal([]byte(funcCallInput.Arguments), &parsedArguments); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal arguments: %w", err)
	}

	if toolName == "edit_text_file" {
		originalContent, modifiedContent, err := EditTextFileDryRun(parsedArguments, backupFileName)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to generate diff: %w", err)
		}
		return originalContent, modifiedContent, nil
	}

	params, err := parseWriteTextFileInput(parsedArguments)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse write_text_file input: %w", err)
	}

	var originalContent []byte
	if backupFileName != "" {
		originalContent, err = os.ReadFile(backupFileName)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to read backup file: %w", err)
		}
	} else {
		expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to expand path: %w", err)
		}
		originalContent, err = os.ReadFile(expandedPath)
		if err != nil && !os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("failed to read original file: %w", err)
		}
	}

	modifiedContent := []byte(params.Contents)
	return originalContent, modifiedContent, nil
}

type StaticFileInfo struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	Modified     string `json:"modified"`
	ModifiedTime string `json:"modified_time"`
}

func generateBuilderAppData(appId string) (string, string, string, error) {
	appGoFile := ""
	fileData, err := waveappstore.ReadAppFile(appId, "app.go")
	if err == nil {
		appGoFile = string(fileData.Contents)
	}

	staticFilesJSON := ""
	allFiles, err := waveappstore.ListAllAppFiles(appId)
	if err == nil {
		var staticFiles []StaticFileInfo
		for _, entry := range allFiles.Entries {
			if strings.HasPrefix(entry.Name, "static/") {
				staticFiles = append(staticFiles, StaticFileInfo{
					Name:         entry.Name,
					Size:         entry.Size,
					Modified:     entry.Modified,
					ModifiedTime: entry.ModifiedTime,
				})
			}
		}

		if len(staticFiles) > 0 {
			staticFilesBytes, marshalErr := json.Marshal(staticFiles)
			if marshalErr == nil {
				staticFilesJSON = string(staticFilesBytes)
			}
		}
	}

	platformInfo := wavebase.GetSystemSummary()
	if currentUser, userErr := user.Current(); userErr == nil && currentUser.Username != "" {
		platformInfo = fmt.Sprintf("Local Machine: %s, User: %s", platformInfo, currentUser.Username)
	} else {
		platformInfo = fmt.Sprintf("Local Machine: %s", platformInfo)
	}

	return appGoFile, staticFilesJSON, platformInfo, nil
}
