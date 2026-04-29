// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const MaxReadFileSize = 100 * 1024 // 100KB
const DefaultReadFileLimit = 200   // default line limit

type readTextFileParams struct {
	Filename string `json:"filename"`
	Offset   int    `json:"offset"`
	Limit    int    `json:"limit"`
}

func parseReadTextFileInput(input any) (*readTextFileParams, error) {
	result := &readTextFileParams{Offset: 0, Limit: DefaultReadFileLimit}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if m, ok := input.(map[string]any); ok {
		if fn, ok := m["filename"].(string); ok {
			result.Filename = fn
		}
		if offset, ok := m["offset"].(float64); ok {
			result.Offset = int(offset)
		}
		if limit, ok := m["limit"].(float64); ok {
			result.Limit = int(limit)
		}
	} else {
		return nil, fmt.Errorf("invalid input format")
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	if result.Offset < 0 {
		result.Offset = 0
	}
	if result.Limit <= 0 {
		result.Limit = DefaultReadFileLimit
	}

	return result, nil
}

func verifyReadTextFileInput(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
	params, err := parseReadTextFileInput(input)
	if err != nil {
		return err
	}
	if _, err := requireRemoteFileTarget(params.Filename, toolUseData); err != nil {
		return err
	}
	toolUseData.InputFileName = params.Filename
	return nil
}

func resolveRemoteReadFileTarget(filename string, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, bool) {
	return resolveRemoteFileTarget(filename, toolUseData)
}

func readTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseReadTextFileInput(input)
	if err != nil {
		return nil, err
	}

	remoteTarget, err := requireRemoteFileTarget(params.Filename, toolUseData)
	if err != nil {
		return nil, err
	}

	limitCmd := fmt.Sprintf("wc -l < %s", quoteForSingleQuotedShell(params.Filename))
	totalResult, err := runRemoteCommand(remoteTarget, limitCmd, 30*time.Second, 1024)
	if err != nil {
		return nil, err
	}
	totalLines := 0
	if totalResult.Output != "" {
		fmt.Sscanf(strings.TrimSpace(totalResult.Output), "%d", &totalLines)
	}

	var readCmd string
	if params.Limit > 0 {
		readCmd = fmt.Sprintf("sed -n '%d,%dp' %s", params.Offset+1, params.Offset+params.Limit, quoteForSingleQuotedShell(params.Filename))
	} else {
		readCmd = fmt.Sprintf("tail -n +%d %s", params.Offset+1, quoteForSingleQuotedShell(params.Filename))
	}

	content, err := runRemoteShellCommandForText(remoteTarget, readCmd, 30*time.Second, 512*1024)
	if err != nil {
		return nil, err
	}

	truncated := false
	if totalLines > params.Offset+strings.Count(content, "\n")+1 {
		truncated = true
	}

	if content == "" {
		content = "(empty file)"
	}

	return map[string]any{
		"content":     content,
		"total_lines": totalLines,
		"offset":      params.Offset,
		"truncated":   truncated,
	}, nil
}

func GetReadTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_text_file",
		DisplayName: "Read Text File",
		Description: "Read a text file on the current remote terminal connection. Only Linux absolute paths are supported. Supports line-based offset and limit for reading specific portions of large files. Returns total line count and whether there's more content.",
		ToolLogName: "gen:readfile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Linux absolute path to the file to read on the current remote terminal connection.",
				},
				"offset": map[string]any{
					"type":        "integer",
					"description": fmt.Sprintf("Line offset to start reading from (0-based, default: 0). Use this to skip to a specific position in the file.",),
				},
				"limit": map[string]any{
					"type":        "integer",
					"description": fmt.Sprintf("Maximum number of lines to read (default: %d). Use offset and limit to read specific portions of large files.", DefaultReadFileLimit),
				},
			},
			"required":             []string{"filename", "offset", "limit"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseReadTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			desc := fmt.Sprintf("reading %q", params.Filename)
			if params.Offset > 0 || params.Limit != DefaultReadFileLimit {
				desc += fmt.Sprintf(" (offset=%d, limit=%d)", params.Offset, params.Limit)
			}
			return desc
		},
		ToolAnyCallback: readTextFileCallback,
		ToolApproval: func(input any) string {
			return uctypes.ApprovalAutoApproved
		},
		ToolVerifyInput: verifyReadTextFileInput,
	}
}
