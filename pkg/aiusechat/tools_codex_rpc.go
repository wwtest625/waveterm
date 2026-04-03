// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/service/blockservice"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

type WaveRunCommandToolInput struct {
	Connection string            `json:"connection"`
	Cwd        string            `json:"cwd,omitempty"`
	Command    string            `json:"command"`
	Args       []string          `json:"args,omitempty"`
	Env        map[string]string `json:"env,omitempty"`
}

type WaveGetCommandResultToolInput struct {
	JobId string `json:"job_id"`
}

func parseWaveRunCommandToolInput(input any) (*WaveRunCommandToolInput, error) {
	result := &WaveRunCommandToolInput{}
	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}
	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}
	result.Connection = strings.TrimSpace(result.Connection)
	result.Cwd = strings.TrimSpace(result.Cwd)
	result.Command = strings.TrimSpace(result.Command)
	if result.Command == "" {
		return nil, fmt.Errorf("command is required")
	}
	normalizeWaveRunCommandToolInput(result)
	return result, nil
}

func resolveWaveRunCommandTarget(parsed *WaveRunCommandToolInput, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, string, error) {
	if parsed == nil {
		return nil, "", fmt.Errorf("command is required")
	}
	resolved := *parsed
	if resolved.Connection != "" {
		return &resolved, resolved.Connection, nil
	}
	if toolUseData == nil || strings.TrimSpace(toolUseData.TabId) == "" {
		return nil, "", fmt.Errorf("connection is required when no current tab terminal is available")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	termCtx, err := blockservice.BlockServiceInstance.GetTerminalContext(ctx, toolUseData.TabId, toolUseData.BlockId)
	if err != nil {
		return nil, "", fmt.Errorf("failed to resolve current tab terminal: %w", err)
	}
	resolved.Connection = strings.TrimSpace(termCtx.Connection)
	if resolved.Connection == "" {
		resolved.Connection = strings.TrimSpace(termCtx.ControllerConnName)
	}
	if resolved.Connection == "" {
		return nil, "", fmt.Errorf("current tab terminal has no connection")
	}
	if resolved.Cwd == "" {
		resolved.Cwd = strings.TrimSpace(termCtx.Cwd)
	}
	return &resolved, resolved.Connection, nil
}

func normalizeWaveRunCommandToolInput(input *WaveRunCommandToolInput) {
	if input == nil {
		return
	}
	if len(input.Args) > 0 {
		return
	}
	if shouldUseShellCommand(input.Command) {
		originalCommand := input.Command
		input.Command = "sh"
		input.Args = []string{"-lc", originalCommand}
		return
	}
	commandParts := strings.Fields(input.Command)
	if len(commandParts) <= 1 {
		return
	}
	input.Command = commandParts[0]
	input.Args = commandParts[1:]
}

func shouldUseShellCommand(command string) bool {
	if strings.TrimSpace(command) == "" {
		return false
	}
	return strings.ContainsAny(command, `|&;<>()$'"`)
}

func getWaveRunCommandDisplayText(parsed *WaveRunCommandToolInput) string {
	if parsed == nil {
		return ""
	}
	if parsed.Command == "sh" && len(parsed.Args) >= 2 && parsed.Args[0] == "-lc" {
		return parsed.Args[1]
	}
	if len(parsed.Args) == 0 {
		return parsed.Command
	}
	return strings.Join(append([]string{parsed.Command}, parsed.Args...), " ")
}

func parseWaveGetCommandResultToolInput(input any) (*WaveGetCommandResultToolInput, error) {
	result := &WaveGetCommandResultToolInput{}
	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}
	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}
	if strings.TrimSpace(result.JobId) == "" {
		var aliasInput struct {
			JobId string `json:"jobid"`
		}
		if err := json.Unmarshal(inputBytes, &aliasInput); err == nil {
			result.JobId = aliasInput.JobId
		}
	}
	result.JobId = strings.TrimSpace(result.JobId)
	if strings.TrimSpace(result.JobId) == "" {
		return nil, fmt.Errorf("job_id is required")
	}
	return result, nil
}

func GetWaveRunCommandToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "wave_run_command",
		DisplayName: "Run Command via Wave RPC",
		Description: "Start a background command on a Wave connection using Wave RPC job execution. If connection is omitted, Wave uses the current terminal in the same tab by default.",
		ToolLogName: "wave:runcommand",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"connection": map[string]any{
					"type":        "string",
					"description": "Optional explicit Wave connection name. Defaults to the current terminal in the same tab.",
				},
				"cwd":     map[string]any{"type": "string"},
				"command": map[string]any{"type": "string"},
				"args": map[string]any{
					"type":  "array",
					"items": map[string]any{"type": "string"},
				},
				"env": map[string]any{
					"type":                 "object",
					"additionalProperties": map[string]any{"type": "string"},
				},
			},
			"required":             []string{"command"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWaveRunCommandToolInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			target := "current terminal"
			resolved, _, resolveErr := resolveWaveRunCommandTarget(parsed, toolUseData)
			if resolveErr == nil {
				parsed = resolved
				target = parsed.Connection
			} else if parsed.Connection != "" {
				target = parsed.Connection
			}
			commandText := getWaveRunCommandDisplayText(parsed)
			if cwd := strings.TrimSpace(parsed.Cwd); cwd != "" {
				return fmt.Sprintf("running %q on %s in %s", commandText, target, cwd)
			}
			return fmt.Sprintf("running %q on %s", commandText, target)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWaveRunCommandToolInput(input)
			if err != nil {
				return nil, err
			}
			parsed, _, err = resolveWaveRunCommandTarget(parsed, toolUseData)
			if err != nil {
				return nil, err
			}
			rpcClient := wshclient.GetBareRpcClient()
			result, err := wshclient.AgentRunCommandCommand(rpcClient, wshrpc.CommandAgentRunCommandData{
				ConnName: parsed.Connection,
				Cwd:      parsed.Cwd,
				Cmd:      parsed.Command,
				Args:     parsed.Args,
				Env:      parsed.Env,
			}, nil)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"job_id": result.JobId,
				"jobid":  result.JobId,
			}, nil
		},
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}

func GetWaveGetCommandResultToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "wave_get_command_result",
		DisplayName: "Poll Wave Command Result",
		Description: "Poll a Wave RPC background command until it finishes and return the latest output.",
		ToolLogName: "wave:getcommandresult",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"job_id": map[string]any{
					"type":        "string",
					"description": "Wave job id returned by wave_run_command. Prefer this field name.",
				},
				"jobid": map[string]any{
					"type":        "string",
					"description": "Legacy alias for job_id kept for backward compatibility.",
				},
			},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWaveGetCommandResultToolInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("polling command result for %s", parsed.JobId)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWaveGetCommandResultToolInput(input)
			if err != nil {
				return nil, err
			}
			rpcClient := wshclient.GetBareRpcClient()
			deadline := time.Now().Add(30 * time.Second)
			var terminalSeenAt time.Time
			for {
				result, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
					JobId:     parsed.JobId,
					TailBytes: 32768,
				}, nil)
				if err != nil {
					return nil, err
				}
				now := time.Now()
				if shouldReturnWaveCommandResult(result, now, deadline, &terminalSeenAt) {
					return result, nil
				}
				select {
				case <-context.Background().Done():
					return result, nil
				case <-time.After(250 * time.Millisecond):
				}
			}
		},
	}
}

func shouldReturnWaveCommandResult(
	result *wshrpc.CommandAgentGetCommandResultRtnData,
	now time.Time,
	deadline time.Time,
	terminalSeenAt *time.Time,
) bool {
	const outputFlushGraceWindow = 5 * time.Second

	if result == nil {
		return true
	}
	if now.After(deadline) {
		return true
	}
	if result.Status == "running" {
		if terminalSeenAt != nil {
			*terminalSeenAt = time.Time{}
		}
		return false
	}
	if strings.TrimSpace(result.Error) != "" || strings.TrimSpace(result.Output) != "" {
		return true
	}
	if terminalSeenAt == nil {
		return true
	}
	if terminalSeenAt.IsZero() {
		*terminalSeenAt = now
		return false
	}
	return now.Sub(*terminalSeenAt) >= outputFlushGraceWindow
}
