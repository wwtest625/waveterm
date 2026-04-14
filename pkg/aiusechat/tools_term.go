// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type CommandInfo struct {
	Command  string `json:"command"`
	Status   string `json:"status"`
	ExitCode *int   `json:"exitcode,omitempty"`
}

type TermGetScrollbackToolOutput struct {
	TotalLines         int          `json:"totallines"`
	LineStart          int          `json:"linestart"`
	LineEnd            int          `json:"lineend"`
	ReturnedLines      int          `json:"returnedlines"`
	Content            string       `json:"content"`
	SinceLastOutputSec *int         `json:"sincelastoutputsec,omitempty"`
	HasMore            bool         `json:"hasmore"`
	NextStart          *int         `json:"nextstart"`
	LastCommand        *CommandInfo `json:"lastcommand,omitempty"`
}

func getTermScrollbackOutput(tabId string, widgetId string, rpcData wshrpc.CommandTermGetScrollbackLinesData) (*TermGetScrollbackToolOutput, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, widgetId)
	if err != nil {
		return nil, err
	}

	rpcClient := wshclient.GetBareRpcClient()
	result, err := wshclient.TermGetScrollbackLinesCommand(
		rpcClient,
		rpcData,
		&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(fullBlockId)},
	)
	if err != nil {
		return nil, err
	}

	content := strings.Join(result.Lines, "\n")
	var effectiveLineEnd int
	if rpcData.LastCommand {
		effectiveLineEnd = result.LineStart + len(result.Lines)
	} else {
		effectiveLineEnd = min(rpcData.LineEnd, result.TotalLines)
	}
	hasMore := effectiveLineEnd < result.TotalLines

	var sinceLastOutputSec *int
	if result.LastUpdated > 0 {
		sec := max(0, int((time.Now().UnixMilli()-result.LastUpdated)/1000))
		sinceLastOutputSec = &sec
	}

	var nextStart *int
	if hasMore {
		nextStart = &effectiveLineEnd
	}

	blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
	rtInfo := wstore.GetRTInfo(blockORef)

	var lastCommand *CommandInfo
	if rtInfo != nil && rtInfo.ShellIntegration && rtInfo.ShellLastCmd != "" {
		cmdInfo := &CommandInfo{
			Command: rtInfo.ShellLastCmd,
		}
		if rtInfo.ShellState == "running-command" {
			cmdInfo.Status = "running"
		} else if rtInfo.ShellState == "ready" {
			cmdInfo.Status = "completed"
			exitCode := rtInfo.ShellLastCmdExitCode
			cmdInfo.ExitCode = &exitCode
		}
		lastCommand = cmdInfo
	}

	return &TermGetScrollbackToolOutput{
		TotalLines:         result.TotalLines,
		LineStart:          result.LineStart,
		LineEnd:            effectiveLineEnd,
		ReturnedLines:      len(result.Lines),
		Content:            content,
		SinceLastOutputSec: sinceLastOutputSec,
		HasMore:            hasMore,
		NextStart:          nextStart,
		LastCommand:        lastCommand,
	}, nil
}

type TermCommandOutputToolInput struct {
	WidgetId string `json:"widget_id"`
}

func parseTermCommandOutputInput(input any) (*TermCommandOutputToolInput, error) {
	result := &TermCommandOutputToolInput{}

	if input == nil {
		return nil, fmt.Errorf("widget_id is required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}

	return result, nil
}

func GetTermCommandOutputToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_command_output",
		DisplayName: "Get Last Command Output",
		Description: "Retrieve output from the most recent command in a terminal widget. Requires shell integration to be enabled. Returns the command text, exit code, and up to 1000 lines of output.",
		ToolLogName: "term:commandoutput",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermCommandOutputInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading last command output from %s", parsed.WidgetId)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermCommandOutputInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo == nil || !rtInfo.ShellIntegration {
				return nil, fmt.Errorf("shell integration is not enabled for this terminal")
			}

			output, err := getTermScrollbackOutput(
				tabId,
				parsed.WidgetId,
				wshrpc.CommandTermGetScrollbackLinesData{
					LastCommand: true,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get command output: %w", err)
			}
			return output, nil
		},
	}
}
