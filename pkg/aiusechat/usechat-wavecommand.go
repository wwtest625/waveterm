// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func autoCancelTUICommand(rpcClient *wshutil.WshRpc, jobId string) {
	if strings.TrimSpace(jobId) == "" {
		return
	}
	defaultChatManager.tuiAutoCancelMu.Lock()
	if defaultChatManager.tuiAutoCancelledJobs[jobId] {
		defaultChatManager.tuiAutoCancelMu.Unlock()
		return
	}
	defaultChatManager.tuiAutoCancelledJobs[jobId] = true
	defaultChatManager.tuiAutoCancelMu.Unlock()

	go func() {
		err := wshclient.AgentCancelCommand(rpcClient, jobId, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			log.Printf("failed to auto-cancel TUI command %s: %v", jobId, err)
		} else {
			log.Printf("auto-cancelled TUI command %s", jobId)
		}
		time.AfterFunc(30*time.Second, func() {
			defaultChatManager.tuiAutoCancelMu.Lock()
			delete(defaultChatManager.tuiAutoCancelledJobs, jobId)
			defaultChatManager.tuiAutoCancelMu.Unlock()
		})
	}()
}

const (
	waveCommandPollFastInterval    = 50 * time.Millisecond
	waveCommandPollMaxInterval     = 2 * time.Second
	waveCommandPollAbsoluteTimeout = 30 * time.Minute
	waveCommandPollChunkBytes      = 8192
	waveCommandUiDurationStepMs    = int64(1000)
)

func mergeWaveCommandOutputText(existing string, chunk string) string {
	if chunk == "" {
		return existing
	}
	combined := existing + chunk
	if len(combined) <= maxToolOutputTextLen {
		return combined
	}
	return combined[len(combined)-maxToolOutputTextLen:]
}

func nextWaveCommandPollInterval(current time.Duration) time.Duration {
	if current <= 0 {
		return waveCommandPollFastInterval
	}
	next := current * 2
	if next > waveCommandPollMaxInterval {
		next = waveCommandPollMaxInterval
	}
	return next
}

func tryStartWaveCommandResultPoller(
	ctx context.Context,
	chatOpts uctypes.WaveChatOpts,
	backend UseChatBackend,
	sseHandler *sse.SSEHandlerCh,
	toolCallID string,
	snapshot *wshrpc.CommandAgentGetCommandResultRtnData,
) {
	if snapshot == nil || strings.TrimSpace(snapshot.JobId) == "" {
		return
	}
	pollerKey := chatOpts.ChatId + ":" + toolCallID
	defaultChatManager.commandPollerMu.Lock()
	if _, exists := defaultChatManager.commandPollers[pollerKey]; exists {
		defaultChatManager.commandPollerMu.Unlock()
		return
	}
	defaultChatManager.commandPollers[pollerKey] = struct{}{}
	defaultChatManager.commandPollerMu.Unlock()

	initialToolUse := makeWaveCommandToolUseData("wave_run_command", toolCallID, snapshot)
	commandText := lookupWaveCommandJob(snapshot.JobId)
	applyWaveCommandInteractionState(&initialToolUse, detectCommandInteraction(commandText, snapshot))
	if snapshot.Status == "running" {
		initialToolUse.Status = "running"
	}
	if strings.TrimSpace(snapshot.Error) != "" {
		initialToolUse.Status = uctypes.ToolUseStatusError
		initialToolUse.ErrorMessage = snapshot.Error
	}

	go func() {
		defer func() {
			defaultChatManager.commandPollerMu.Lock()
			delete(defaultChatManager.commandPollers, pollerKey)
			defaultChatManager.commandPollerMu.Unlock()
			defaultChatManager.rememberCommandJob(snapshot.JobId, "")
		}()

		current := initialToolUse
		currentOutput := current.OutputText
		currentDuration := current.DurationMs
		currentInteractionDedupKey := ""
		terminalSeenAt := time.Time{}
		absoluteDeadline := time.Now().Add(waveCommandPollAbsoluteTimeout)
		pollInterval := waveCommandPollFastInterval
		lastStatus := snapshot.Status
		offsetCursor := snapshot.NextOffset
		if offsetCursor <= 0 && strings.TrimSpace(snapshot.Output) != "" {
			offsetCursor = int64(len(snapshot.Output))
		}
		rpcClient := wshclient.GetBareRpcClient()
		for {
			now := time.Now()
			if err := ctx.Err(); err != nil {
				current.Status = uctypes.ToolUseStatusCancelled
				current.ErrorMessage = "command result polling canceled"
				current.CancellationReason = uctypes.CancelReasonManual
				current.Partial = uctypes.BoolPtr(false)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if now.After(absoluteDeadline) {
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = "command result polling timed out"
				current.CancellationReason = uctypes.CancelReasonTimeout
				current.Partial = uctypes.BoolPtr(false)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			requestOffset := offsetCursor
			result, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
				JobId:     snapshot.JobId,
				TailBytes: waveCommandPollChunkBytes,
				Offset:    &requestOffset,
			}, nil)
			if err != nil {
				log.Printf("failed to poll wave command result for %s: %v", snapshot.JobId, err)
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = err.Error()
				current.DurationMs = currentDuration
				current.Partial = uctypes.BoolPtr(false)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			current.DurationMs = result.DurationMs
			chunkText := getWaveCommandResultOutputText(current.ToolName, result.Output)
			outputChanged := false
			if chunkText != "" {
				if result.OutputOffset == offsetCursor && !result.Truncated {
					merged := mergeWaveCommandOutputText(currentOutput, chunkText)
					outputChanged = merged != currentOutput
					current.OutputText = merged
				} else {
					outputChanged = chunkText != currentOutput
					current.OutputText = chunkText
				}
			}
			if result.NextOffset > 0 {
				offsetCursor = result.NextOffset
			} else if chunkText != "" {
				offsetCursor += int64(len(result.Output))
			}
			detectedInteraction := detectCommandInteraction(commandText, result)
			detectedInteractionKey := ""
			if detectedInteraction != nil {
				detectedInteractionKey = detectedInteraction.DedupKey
			}
			applyWaveCommandInteractionState(&current, detectedInteraction)
			if detectedInteraction != nil && detectedInteraction.TuiDetected && detectedInteraction.TuiCategory == TuiCategoryAlways && !current.TuiSuppressed {
				autoCancelTUICommand(rpcClient, snapshot.JobId)
			}
			statusChanged := result.Status != lastStatus
			interactionChanged := detectedInteractionKey != currentInteractionDedupKey
			if outputChanged || interactionChanged || statusChanged {
				pollInterval = waveCommandPollFastInterval
			} else {
				pollInterval = nextWaveCommandPollInterval(pollInterval)
			}
			lastStatus = result.Status
			if result.Status == "gone" {
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = strings.TrimSpace(result.Error)
				if current.ErrorMessage == "" {
					current.ErrorMessage = "command result is unavailable; rerun the command"
				}
				current.DurationMs = currentDuration
				current.Partial = uctypes.BoolPtr(false)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if result.Status == "error" {
				current.Status = uctypes.ToolUseStatusError
				current.ErrorMessage = result.Error
				current.Partial = uctypes.BoolPtr(false)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if result.Status == "running" {
				current.Status = "running"
				current.ErrorMessage = ""
				current.Partial = uctypes.BoolPtr(true)
				durationChangedForUI := (current.DurationMs-currentDuration) >= waveCommandUiDurationStepMs || current.DurationMs < currentDuration
				if current.OutputText != currentOutput || durationChangedForUI || detectedInteractionKey != currentInteractionDedupKey {
					currentOutput = current.OutputText
					currentDuration = current.DurationMs
					currentInteractionDedupKey = detectedInteractionKey
					_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
					updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				}
				select {
				case <-ctx.Done():
				case <-time.After(pollInterval):
				}
				continue
			}
			if shouldReturnWaveCommandResult(result, time.Now(), absoluteDeadline, &terminalSeenAt) {
				current.Status = uctypes.ToolUseStatusCompleted
				current.ErrorMessage = ""
				current.Partial = uctypes.BoolPtr(false)
				applyWaveCommandInteractionState(&current, nil)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
				return
			}
			if current.OutputText != currentOutput || current.DurationMs != currentDuration || detectedInteractionKey != currentInteractionDedupKey {
				currentOutput = current.OutputText
				currentDuration = current.DurationMs
				currentInteractionDedupKey = detectedInteractionKey
				current.Partial = uctypes.BoolPtr(true)
				_ = sseHandler.AiMsgData("data-tooluse", toolCallID, current)
				updateToolUseDataInChat(backend, chatOpts, toolCallID, current)
			}
			select {
			case <-ctx.Done():
			case <-time.After(pollInterval):
			}
		}
	}()
}
