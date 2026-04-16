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
	"github.com/wavetermdev/waveterm/pkg/wshutil"
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

// criticalDangerousCommandPattern matches commands that should be blocked outright
// (no approval flow) rather than merely requiring user approval.
// Covers: rm -rf /, rm -rf /*, dd of=/dev/..., mkfs on device, format on root,
// and any destructive command targeting the root filesystem.
var criticalDangerousCommandPattern = regexp.MustCompile(`(?i)(^|\s|&&|\|\||;|` + "`" + `)rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+/(\s|$|/\*)|dd\s+.*of=/dev/(sd[a-z]|nvme|vd[a-z]|hd[a-z])|mkfs\.\w+\s+/dev/(sd[a-z]|nvme|vd[a-z]|hd[a-z])|format\s+[a-zA-Z]:\s*$|(:>|\bcat\s+/dev/zero\s*>)\s*/dev/(sd[a-z]|nvme|vd[a-z]|hd[a-z]))`)
var streamPreferredWaveCommandPattern = regexp.MustCompile(`(?i)\b(apt|apt-get|yum|dnf|pacman|zypper|apk|brew)\s+(install|upgrade|update|dist-upgrade|full-upgrade|remove|autoremove)\b|\b(curl|wget|aria2c|rsync|scp|sftp)\b|\b(tail|journalctl|docker|kubectl)\b[^\n]*\s-f(\s|$)|\bwatch\b`)
var waveAgentGetCommandResult = wshclient.AgentGetCommandResultCommand

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

func isCriticalDangerousCommandText(command string) bool {
	return criticalDangerousCommandPattern.MatchString(strings.TrimSpace(command))
}

func isCriticalDangerousCommandInput(input any) bool {
	parsed, err := parseWaveRunCommandToolInput(input)
	if err != nil || parsed == nil {
		return true
	}
	return isCriticalDangerousCommandText(getWaveRunCommandDisplayText(parsed))
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
		"git clone",
		"git pull",
		"git push",
		"gh auth login",
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

func shouldUseInlineWaveRunCompletion(parsed *WaveRunCommandToolInput) bool {
	if parsed == nil {
		return false
	}
	if parsed.Interactive {
		return false
	}
	if isLikelyInteractiveWaveRunCommand(parsed) {
		return false
	}
	if isLikelyStreamingWaveRunCommand(parsed) {
		return false
	}
	return true
}

const waveRunCommandInlineWait = 700 * time.Millisecond

func waitForWaveCommandCompletion(rpcClient *wshutil.WshRpc, jobID string, timeout time.Duration) (*wshrpc.CommandAgentGetCommandResultRtnData, error) {
	deadline := time.Now().Add(timeout)
	pollInterval := 120 * time.Millisecond
	maxPollInterval := 320 * time.Millisecond
	for time.Now().Before(deadline) {
		result, err := waveAgentGetCommandResult(rpcClient, wshrpc.CommandAgentGetCommandResultData{
			JobId:     jobID,
			TailBytes: 8192,
		}, nil)
		if err != nil {
			return nil, err
		}
		if result == nil || result.Status != "running" {
			return result, nil
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		sleepFor := pollInterval
		if sleepFor > remaining {
			sleepFor = remaining
		}
		time.Sleep(sleepFor)
		if pollInterval < maxPollInterval {
			pollInterval += 80 * time.Millisecond
			if pollInterval > maxPollInterval {
				pollInterval = maxPollInterval
			}
		}
	}
	return nil, nil
}

func waveRunCommandResultSummary(snapshot *wshrpc.CommandAgentGetCommandResultRtnData) string {
	if snapshot == nil {
		return "Command is still running in the background."
	}
	outputFirstLine := strings.TrimSpace(strings.Split(strings.TrimSpace(snapshot.Output), "\n")[0])
	errorText := strings.TrimSpace(snapshot.Error)
	if snapshot.Status == "gone" {
		if errorText != "" {
			return errorText
		}
		return "Command result is unavailable."
	}
	if snapshot.Status == "running" {
		return "Command is still running in the background."
	}
	if snapshot.ExitCode != nil {
		if *snapshot.ExitCode == 0 {
			if outputFirstLine != "" {
				return outputFirstLine
			}
			return "Command completed successfully (exit 0)."
		}
		if errorText != "" {
			return fmt.Sprintf("Command failed with exit %d: %s", *snapshot.ExitCode, errorText)
		}
		return fmt.Sprintf("Command failed with exit %d.", *snapshot.ExitCode)
	}
	if errorText != "" {
		return errorText
	}
	if outputFirstLine != "" {
		return outputFirstLine
	}
	if snapshot.Status == "done" {
		return "Command completed."
	}
	if snapshot.Status == "error" {
		return "Command failed."
	}
	return "Command finished."
}

func waveRunCommandResultPayload(jobID string, snapshot *wshrpc.CommandAgentGetCommandResultRtnData) map[string]any {
	resultPayload := map[string]any{"jobid": jobID}
	if snapshot == nil {
		resultPayload["status"] = "running"
		resultPayload["summary"] = waveRunCommandResultSummary(nil)
		return resultPayload
	}
	resultPayload["status"] = snapshot.Status
	resultPayload["summary"] = waveRunCommandResultSummary(snapshot)
	resultPayload["exitcode"] = snapshot.ExitCode
	resultPayload["exitsignal"] = snapshot.ExitSignal
	resultPayload["durationms"] = snapshot.DurationMs
	if snapshot.OutputOffset > 0 {
		resultPayload["outputoffset"] = snapshot.OutputOffset
	}
	if snapshot.NextOffset > 0 {
		resultPayload["nextoffset"] = snapshot.NextOffset
	}
	if snapshot.Truncated {
		resultPayload["truncated"] = true
	}
	if strings.TrimSpace(snapshot.Output) != "" {
		resultPayload["output"] = snapshot.Output
	}
	if strings.TrimSpace(snapshot.Error) != "" {
		resultPayload["error"] = snapshot.Error
	}
	return resultPayload
}

func isWaveCommandTerminalTool(toolName string) bool {
	return toolName == "wave_run_command" || toolName == "term_command_output"
}

func getWaveCommandResultToolName(toolName string) string {
	if toolName == "wave_run_command" {
		return "wave_run_command"
	}
	return toolName
}

func getWaveCommandResultOutputText(toolName string, output string) string {
	return extractToolOutputText(getWaveCommandResultToolName(toolName), output)
}

func makeWaveCommandToolUseData(toolName string, toolCallID string, snapshot *wshrpc.CommandAgentGetCommandResultRtnData) uctypes.UIMessageDataToolUse {
	toolUse := uctypes.UIMessageDataToolUse{
		ToolCallId: toolCallID,
		ToolName:   getWaveCommandResultToolName(toolName),
	}
	if snapshot == nil {
		toolUse.Status = "running"
		return toolUse
	}
	toolUse.JobId = snapshot.JobId
	toolUse.DurationMs = snapshot.DurationMs
	toolUse.ExitCode = snapshot.ExitCode
	toolUse.ExitSignal = snapshot.ExitSignal
	toolUse.OutputText = getWaveCommandResultOutputText(toolName, snapshot.Output)
	if snapshot.Status == "running" {
		toolUse.Status = "running"
		return toolUse
	}
	if snapshot.Status == "gone" || snapshot.Status == "error" || strings.TrimSpace(snapshot.Error) != "" {
		toolUse.Status = uctypes.ToolUseStatusError
		toolUse.ErrorMessage = strings.TrimSpace(snapshot.Error)
		if toolUse.ErrorMessage == "" {
			toolUse.ErrorMessage = "command result is unavailable; rerun the command"
		}
		return toolUse
	}
	toolUse.Status = uctypes.ToolUseStatusCompleted
	return toolUse
}

func GetWaveRunCommandToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "wave_run_command",
		DisplayName: "Run Command via Wave RPC",
		Description: "Run a command on a Wave connection. Short non-interactive commands return inline results when available; long-running or interactive commands return a job id for background polling. If connection is omitted, Wave uses the current terminal in the same tab by default. When that terminal is already remote, run the target shell command directly there instead of wrapping it in ssh, unless the user explicitly asked for a nested SSH hop.",
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
			resultPayload := map[string]any{
				"jobid": result.JobId,
			}
			if shouldUseInlineWaveRunCompletion(parsed) {
				snapshot, pollErr := waitForWaveCommandCompletion(rpcClient, result.JobId, waveRunCommandInlineWait)
				if pollErr == nil {
					return waveRunCommandResultPayload(result.JobId, snapshot), nil
				}
				resultPayload["status"] = "running"
			}
			return resultPayload, nil
		},
		ToolApproval: func(input any) string {
			if isCriticalDangerousCommandInput(input) {
				return uctypes.ApprovalBlocked
			}
			if isDangerousWaveRunCommandInput(input) {
				return uctypes.ApprovalNeedsApproval
			}
			return uctypes.ApprovalAutoApproved
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
