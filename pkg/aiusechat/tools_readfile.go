// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
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

func resolveReadFilePath(filename string) (string, error) {
	trimmedInput := strings.TrimSpace(filename)
	if runtime.GOOS == "windows" && strings.HasPrefix(trimmedInput, "/") && !strings.HasPrefix(trimmedInput, "//") {
		return "", fmt.Errorf(
			"path %q looks like a Linux absolute path, but file tools operate on local %s files only; use a local absolute path (for example C:\\Users\\you\\notes.txt), or use wave_run_command for remote paths",
			filename,
			runtime.GOOS,
		)
	}

	expandedPath, err := wavebase.ExpandHomeDir(filename)
	if err != nil {
		return "", fmt.Errorf("failed to expand path: %w", err)
	}

	if filepath.IsAbs(expandedPath) {
		return expandedPath, nil
	}

	return "", fmt.Errorf("path must be absolute, got relative path: %s", filename)
}

func readLocalTextFile(expandedPath string, offset int, limit int) (string, int, bool, error) {
	file, err := os.Open(expandedPath)
	if err != nil {
		return "", 0, false, err
	}
	defer file.Close()

	var lines []string
	totalLines := 0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		totalLines++
		lineIdx := totalLines - 1
		if lineIdx < offset {
			continue
		}
		lines = append(lines, scanner.Text())
		if len(lines) >= limit {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return "", 0, false, fmt.Errorf("error reading file: %w", err)
	}

	truncated := false
	if totalLines > offset+len(lines) {
		truncated = true
	}

	return strings.Join(lines, "\n"), totalLines, truncated, nil
}

func verifyReadTextFileInput(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
	params, err := parseReadTextFileInput(input)
	if err != nil {
		return err
	}

	if _, isRemoteTarget := resolveRemoteReadFileTarget(params.Filename, toolUseData); isRemoteTarget {
		toolUseData.InputFileName = params.Filename
		return nil
	}

	expandedPath, err := resolveReadFilePath(params.Filename)
	if err != nil {
		return err
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file does not exist: %s", expandedPath)
		}
		return fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.IsDir() {
		return fmt.Errorf("path is a directory, cannot read it")
	}

	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("path is not a regular file")
	}

	if fileInfo.Size() > MaxReadFileSize {
		return fmt.Errorf("file is too large (%d bytes, max %d bytes)", fileInfo.Size(), MaxReadFileSize)
	}

	toolUseData.InputFileName = params.Filename
	return nil
}

func resolveRemoteReadFileTarget(filename string, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, bool) {
	if !isPosixAbsolutePath(filename) {
		return nil, false
	}
	resolved, _, err := resolveWaveRunCommandTarget(&WaveRunCommandToolInput{Command: "true"}, toolUseData)
	if err != nil || resolved == nil {
		return nil, false
	}
	return resolved, true
}

func readTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseReadTextFileInput(input)
	if err != nil {
		return nil, err
	}

	if remoteTarget, isRemoteTarget := resolveRemoteReadFileTarget(params.Filename, toolUseData); isRemoteTarget {
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

		content, err := runRemoteReadFileCommand(remoteTarget, readCmd)
		if err != nil {
			return nil, err
		}

		truncated := false
		if totalLines > params.Offset+strings.Count(content, "\n")+1 {
			truncated = true
		}

		return map[string]any{
			"content":     content,
			"total_lines": totalLines,
			"offset":      params.Offset,
			"truncated":   truncated,
		}, nil
	}

	expandedPath, err := resolveReadFilePath(params.Filename)
	if err != nil {
		return nil, err
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("file does not exist: %s", expandedPath)
		}
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.IsDir() {
		return nil, fmt.Errorf("path is a directory, cannot read it")
	}

	if !fileInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("path is not a regular file")
	}

	if fileInfo.Size() > MaxReadFileSize {
		return nil, fmt.Errorf("file is too large (%d bytes, max %d bytes)", fileInfo.Size(), MaxReadFileSize)
	}

	content, totalLines, truncated, err := readLocalTextFile(expandedPath, params.Offset, params.Limit)
	if err != nil {
		return nil, err
	}

	if content == "" {
		content = "(empty file)"
	}

	return map[string]any{
		"content":     content,
		"total_lines": totalLines,
		"offset":      params.Offset,
		"truncated":   truncated,
		"bytes":       fileInfo.Size(),
	}, nil
}

func GetReadTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "read_text_file",
		DisplayName: "Read Text File",
		Description: "Read the contents of a text file from the filesystem. Supports line-based offset and limit for reading specific portions of large files. Returns total line count and whether there's more content.",
		ToolLogName: "gen:readfile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Absolute path to the file to read. Supports '~' for the user's home directory.",
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