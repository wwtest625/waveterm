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
	if strings.TrimSpace(result.Connection) == "" {
		return nil, fmt.Errorf("connection is required")
	}
	if strings.TrimSpace(result.Command) == "" {
		return nil, fmt.Errorf("command is required")
	}
	return result, nil
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
		return nil, fmt.Errorf("job_id is required")
	}
	return result, nil
}

func GetWaveRunCommandToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "wave_run_command",
		DisplayName: "Run Command via Wave RPC",
		Description: "Start a background command on a Wave connection using Wave RPC job execution.",
		ToolLogName: "wave:runcommand",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"connection": map[string]any{"type": "string"},
				"cwd":        map[string]any{"type": "string"},
				"command":    map[string]any{"type": "string"},
				"args": map[string]any{
					"type":  "array",
					"items": map[string]any{"type": "string"},
				},
				"env": map[string]any{
					"type":                 "object",
					"additionalProperties": map[string]any{"type": "string"},
				},
			},
			"required":             []string{"connection", "command"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWaveRunCommandToolInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			if cwd := strings.TrimSpace(parsed.Cwd); cwd != "" {
				return fmt.Sprintf("running %q on %s in %s", parsed.Command, parsed.Connection, cwd)
			}
			return fmt.Sprintf("running %q on %s", parsed.Command, parsed.Connection)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWaveRunCommandToolInput(input)
			if err != nil {
				return nil, err
			}
			rpcClient := wshclient.GetBareRpcClient()
			return wshclient.AgentRunCommandCommand(rpcClient, wshrpc.CommandAgentRunCommandData{
				ConnName: parsed.Connection,
				Cwd:      parsed.Cwd,
				Cmd:      parsed.Command,
				Args:     parsed.Args,
				Env:      parsed.Env,
			}, nil)
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
				"job_id": map[string]any{"type": "string"},
			},
			"required":             []string{"job_id"},
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
			for {
				result, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
					JobId:     parsed.JobId,
					TailBytes: 32768,
				}, nil)
				if err != nil {
					return nil, err
				}
				if result.Status != "running" || time.Now().After(deadline) {
					return result, nil
				}
				select {
				case <-context.Background().Done():
					return result, nil
				case <-time.After(500 * time.Millisecond):
				}
			}
		},
	}
}
