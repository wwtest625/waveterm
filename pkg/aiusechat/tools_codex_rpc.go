// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/service/blockservice"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

type WaveRunCommandToolInput struct {
	Connection  string             `json:"connection"`
	Cwd         string             `json:"cwd,omitempty"`
	Command     string             `json:"command"`
	Args        waveRunCommandArgs `json:"args,omitempty"`
	Env         map[string]string  `json:"env,omitempty"`
	Interactive bool               `json:"interactive,omitempty"`
}

type waveRunCommandArgs []string

var dangerousWaveCommandPattern = regexp.MustCompile(`(?i)(\|\s*(bash|sh|zsh|pwsh|powershell|cmd)(\s|$)|(^|\s)sudo(\s|$)|(^|\s)(rm|format|shutdown|reboot|halt|poweroff|init|killall|pkill|fuser|dd|mkfs|fdisk|parted|iptables|ufw|firewall-cmd|chmod|chown|mount|umount|truncate|drop|delete)(\s|$))`)
var streamPreferredWaveCommandPattern = regexp.MustCompile(`(?i)\b(apt|apt-get|yum|dnf|pacman|zypper|apk|brew)\s+(install|upgrade|update|dist-upgrade|full-upgrade|remove|autoremove)\b|\b(curl|wget|aria2c|rsync|scp|sftp)\b|\b(tail|journalctl|docker|kubectl)\b[^\n]*\s-f(\s|$)|\bwatch\b`)

func (a *waveRunCommandArgs) UnmarshalJSON(data []byte) error {
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*a = arr
		return nil
	}
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		if strings.TrimSpace(single) == "" {
			*a = nil
		} else {
			*a = []string{single}
		}
		return nil
	}
	return fmt.Errorf("args must be a string or array of strings")
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
	if err := validateRemoteLinuxWaveRunCommand(&resolved); err != nil {
		return nil, "", err
	}
	return &resolved, resolved.Connection, nil
}

func isWindowsShellWaveCommand(commandText string) bool {
	normalized := strings.ToLower(strings.TrimSpace(commandText))
	return strings.HasPrefix(normalized, "powershell ") ||
		normalized == "powershell" ||
		strings.HasPrefix(normalized, "pwsh ") ||
		normalized == "pwsh" ||
		strings.HasPrefix(normalized, "cmd ") ||
		normalized == "cmd"
}

func validateRemoteLinuxWaveRunCommand(parsed *WaveRunCommandToolInput) error {
	if parsed == nil {
		return fmt.Errorf("command is required")
	}
	connName := strings.TrimSpace(parsed.Connection)
	if connName == "" {
		return fmt.Errorf("remote linux connection is required")
	}
	if conncontroller.IsLocalConnName(connName) || conncontroller.IsWslConnName(connName) {
		return fmt.Errorf("wave_run_command only supports remote linux connections; local execution is disabled")
	}
	commandText := getWaveRunCommandDisplayText(parsed)
	if isWindowsShellWaveCommand(commandText) {
		return fmt.Errorf("wave_run_command only supports linux shell commands on remote connections")
	}
	return nil
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

func isDangerousWaveRunCommandText(command string) bool {
	return dangerousWaveCommandPattern.MatchString(strings.TrimSpace(command))
}

func isDangerousWaveRunCommandInput(input any) bool {
	parsed, err := parseWaveRunCommandToolInput(input)
	if err != nil || parsed == nil {
		return true
	}
	return isDangerousWaveRunCommandText(getWaveRunCommandDisplayText(parsed))
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

func isLikelyInteractiveWaveRunCommand(parsed *WaveRunCommandToolInput) bool {
	if parsed == nil {
		return false
	}
	commandText := strings.ToLower(strings.TrimSpace(getWaveRunCommandDisplayText(parsed)))
	for _, marker := range []string{
		"ssh",
		"sudo",
		"mysql",
		"psql",
		"sqlite3",
		"python",
		"node",
		"less",
		"more",
		"top",
		"htop",
		"vim",
		"nano",
	} {
		if strings.HasPrefix(commandText, marker+" ") || commandText == marker {
			return true
		}
	}
	return false
}

func isLikelyStreamingWaveRunCommand(parsed *WaveRunCommandToolInput) bool {
	if parsed == nil {
		return false
	}
	commandText := strings.ToLower(strings.TrimSpace(getWaveRunCommandDisplayText(parsed)))
	if commandText == "" {
		return false
	}
	return streamPreferredWaveCommandPattern.MatchString(commandText)
}

func getWaveRunCommandPromptHint(parsed *WaveRunCommandToolInput) string {
	if !isLikelyInteractiveWaveRunCommand(parsed) {
		return ""
	}
	return "Command is waiting for terminal input"
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
		Description: "Start a background command on a Wave connection using Wave RPC job execution. If connection is omitted, Wave uses the current terminal in the same tab by default. When that terminal is already remote, run the target shell command directly there instead of wrapping it in ssh, unless the user explicitly asked for a nested SSH hop.",
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
				"interactive": map[string]any{
					"type":        "boolean",
					"description": "Optional. Force interactive stdin support when the command is expected to ask follow-up questions or prompts.",
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
				ConnName:    parsed.Connection,
				Cwd:         parsed.Cwd,
				Cmd:         parsed.Command,
				Args:        parsed.Args,
				Env:         parsed.Env,
				Interactive: parsed.Interactive || isLikelyInteractiveWaveRunCommand(parsed) || isLikelyStreamingWaveRunCommand(parsed),
				PromptHint:  getWaveRunCommandPromptHint(parsed),
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
			if isDangerousWaveRunCommandInput(input) {
				return uctypes.ApprovalNeedsApproval
			}
			return uctypes.ApprovalAutoApproved
		},
	}
}

func GetWaveGetCommandResultToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "wave_get_command_result",
		DisplayName: "Poll Wave Command Result",
		Description: "Fetch the latest Wave RPC background command snapshot. The scheduler continues polling in the background.",
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
			result, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
				JobId:     parsed.JobId,
				TailBytes: 32768,
			}, nil)
			if err != nil {
				return nil, err
			}
			return result, nil
		},
	}
}

func shouldReturnWaveCommandResult(
	result *wshrpc.CommandAgentGetCommandResultRtnData,
	now time.Time,
	deadline time.Time,
	terminalSeenAt *time.Time,
) bool {
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
	return true
}
