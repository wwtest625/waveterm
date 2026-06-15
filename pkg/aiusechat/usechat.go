// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// DefaultAPI, DefaultMaxTokens, BuilderMaxTokens and all settings helpers
// (getSystemPrompt, logWaveAIDebugRequest, isLocalEndpoint, getWaveAISettings,
// normalizeOpenAIEndpointByAPIType, shouldUseChatCompletionsAPI,
// shouldUsePremium, updateRateLimit, GetGlobalRateLimit) live in
// usechat-settings.go.

// ChatManager (type, NewChatManager, defaultChatManager, all methods),
// waveCommandJobEntry, waveCommandJobRetention, waveCommandJobMaxCount,
// the waveCommandJobCleanupInterval ticker init(), and the
// cleanupWaveCommandJobsLocked / rememberWaveCommandJob / lookupWaveCommandJob
// package-level wrappers all live in usechat-manager.go.

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

// updateToolUseDataInChat, maxToolOutputTextLen, truncateToolOutputText,
// extractToolOutputText, parseWaveCommandResultSnapshot,
// parseWaveCommandJobID, applyWaveCommandInteractionState,
// processToolCallInternal, processToolCall, finalizeToolCallProcessing,
// toolExecutionGroup, toolExecutionLane + lane constants, isCommandChainTool,
// buildToolCallDedupKey, buildToolCallDedupKeys, canProcessToolCallInParallel,
// getToolExecutionLane, buildToolExecutionPlan, processToolCallBatch and
// processAllToolCalls all live in usechat-tools.go.

// autoCancelTUICommand, waveCommandPoll* constants, mergeWaveCommandOutputText,
// nextWaveCommandPollInterval and tryStartWaveCommandResultPoller live in
// usechat-wavecommand.go.

func RunAIChat(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.WaveChatOpts) (*uctypes.AIMetrics, error) {
	if !defaultChatManager.activeChats.SetUnless(chatOpts.ChatId, true) {
		return nil, fmt.Errorf("chat %s is already running", chatOpts.ChatId)
	}
	defer defaultChatManager.activeChats.Delete(chatOpts.ChatId)

	// Get or create the AppendOnlyContextManager for this chat.
	// This manager caches the stable prefix (system prompt + tools) and
	// maintains an append-only message log to maximize provider prefix-cache hits.
	contextMgr := GetOrCreateAppendOnlyContextManager(chatOpts.ChatId)

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
	baseSystemPrompt := append([]string(nil), chatOpts.SystemPrompt...)
	firstStep := true
	tabStateDirty := true
	var cont *uctypes.WaveContinueResponse
	for {
		chatOpts.SystemPrompt = baseSystemPrompt
		if chatOpts.TabStateGenerator != nil && tabStateDirty {
			metrics.TabStateRefreshCount++
			tabState, tabTools, tabId, tabErr := chatOpts.TabStateGenerator()
			if tabErr == nil {
				chatOpts.TabState = tabState
				chatOpts.TabTools = tabTools
				chatOpts.TabId = tabId
			}
			if strings.Contains(chatOpts.TabState, "Active Remote Session:") {
				chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, "The user is currently working on a remote terminal connection. Prioritize the remote environment for file operations and command execution.")
			}
			tabStateDirty = false
			// Tab state changed, invalidate prefix so tools are re-evaluated
			contextMgr.InvalidatePrefix()
		}
		if chatOpts.BuilderAppGenerator != nil {
			appGoFile, appStaticFiles, platformInfo, appErr := chatOpts.BuilderAppGenerator()
			if appErr == nil {
				chatOpts.AppGoFile = appGoFile
				chatOpts.AppStaticFiles = appStaticFiles
				chatOpts.PlatformInfo = platformInfo
			}
		}
		var allTools []uctypes.ToolDefinition
		if chatOpts.BuilderId == "" {
			allTools = make([]uctypes.ToolDefinition, 0, len(chatOpts.Tools)+len(chatOpts.TabTools))
			if chatOpts.Config.HasCapability(uctypes.AICapabilityTools) {
				for _, tool := range chatOpts.Tools {
					if tool.HasRequiredCapabilities(chatOpts.Config.Capabilities) {
						allTools = append(allTools, tool)
					}
				}
				for _, tool := range chatOpts.TabTools {
					if tool.HasRequiredCapabilities(chatOpts.Config.Capabilities) {
						allTools = append(allTools, tool)
					}
				}
			}
			if toolCapabilityPrompt := getToolCapabilityPrompt(allTools); toolCapabilityPrompt != "" {
				chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, toolCapabilityPrompt)
			}
		}

		// Build the stable prefix (system prompt + tools).
		// This freezes the prefix if unchanged, maximizing provider cache hits.
		prefixChanged := contextMgr.Build(chatOpts.SystemPrompt, allTools)
		if prefixChanged {
			logutil.DevPrintf("append-only: prefix rebuilt (version=%d fingerprint=%s)\n", contextMgr.Stats().PrefixVersion, contextMgr.Stats().PrefixFingerprint)
		}

		// Override chatOpts with the frozen prefix data.
		// This ensures system prompt and tools are byte-identical across turns,
		// so the provider can use prefix caching (DeepSeek, Anthropic, OpenAI).
		if contextMgr.Prefix.Built() {
			cachedPrompt := contextMgr.GetSystemPrompt()
			if len(cachedPrompt) > 0 {
				chatOpts.SystemPrompt = cachedPrompt
			}
			cachedTools := contextMgr.GetTools()
			if len(cachedTools) > 0 {
				// Replace both Tools and TabTools with the cached combined set
				chatOpts.Tools = nil
				chatOpts.TabTools = cachedTools
			}

			// SnapCompact: check if context compression is needed before the LLM call.
			// This prevents context window overflow by compressing old messages into
			// a summary when token usage exceeds the threshold.
			compactResult, compactErr := contextMgr.CompactContext(chatOpts.Config.Model, chatOpts.Config.MaxTokens)
			if compactErr != nil {
				logutil.DevPrintf("snapcompact: compaction check failed: %v\n", compactErr)
			} else if compactResult.Compacted {
				log.Printf("snapcompact: compacted %d turns (%d→%d messages, ~%d tokens saved)\n",
					compactResult.CompactedTurns, compactResult.OriginalMessageCount, compactResult.CompactedMessageCount, compactResult.TokensSaved)
				// Notify the frontend that compaction occurred so the user is aware
				// that older conversation history has been summarized.
				_ = sseHandler.AiMsgData("data-compaction", chatOpts.ChatId, map[string]any{
					"compactedTurns":    compactResult.CompactedTurns,
					"originalMessages":  compactResult.OriginalMessageCount,
					"compactedMessages": compactResult.CompactedMessageCount,
					"tokensSaved":       compactResult.TokensSaved,
				})
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

			// Use local token counting for accurate context tracking.
			// This is more reliable than the LLM's usage report because:
			// 1. It counts the actual tokens we send (including system prompt + tools)
			// 2. It works even when the provider doesn't return usage data
			// 3. It's available before the LLM call, enabling proactive warnings
			localTokenResult, localErr := CountTokensForChat(chatOpts)
			if localErr == nil && localTokenResult.TotalTokens > 0 {
				usageInfo := NewContextUsageInfo(localTokenResult.TotalTokens, 0, chatOpts.Config.MaxTokens)
				contextLevel := UpdateContextTrackerFromUsage(chatOpts.ChatId, usageInfo)
				if warningPrompt := BuildContextWarningPrompt(contextLevel, usageInfo); warningPrompt != "" {
					chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, warningPrompt)
				}
				logutil.DevPrintf("append-only: local token count=%d (encoding=%s byRole=%v)\n", localTokenResult.TotalTokens, localTokenResult.Encoding, localTokenResult.ByRole)
			} else {
				// Fallback to LLM-reported usage
				usageInfo := NewContextUsageInfo(metrics.Usage.InputTokens, metrics.Usage.OutputTokens, chatOpts.Config.MaxTokens)
				contextLevel := UpdateContextTrackerFromUsage(chatOpts.ChatId, usageInfo)
				if warningPrompt := BuildContextWarningPrompt(contextLevel, usageInfo); warningPrompt != "" {
					chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, warningPrompt)
				}
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
			processAllToolCalls(ctx, backend, stopReason, chatOpts, sseHandler, metrics)
			tabStateDirty = true
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
			buf := make([]byte, 4096)
			n := runtime.Stack(buf, false)
			stackTrace := string(buf[:n])
			log.Printf("PANIC in tool execution: %v\nStack:\n%s", r, stackTrace)
			result.ErrorText = fmt.Sprintf("Internal error (panic: %v). This is a bug, please report it.", r)
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

// PostMessageRequest, WaveAIPostMessageWrap, WaveAIPostMessageHandler and
// WaveAIGetChatHandler all live in usechat-handler.go.
