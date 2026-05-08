// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/remote/fileshare/fsutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

const MaxEditFileSize = 100 * 1024 // 100KB

func isPosixAbsolutePath(filename string) bool {
	trimmed := strings.TrimSpace(filename)
	return strings.HasPrefix(trimmed, "/") && !strings.HasPrefix(trimmed, "//")
}

func requireRemoteFileTarget(filename string, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, error) {
	if !isPosixAbsolutePath(filename) {
		return nil, fmt.Errorf(
			"file tools only support Linux absolute paths on the current remote terminal connection; got %q",
			filename,
		)
	}
	if err := validateFilename(filename); err != nil {
		return nil, fmt.Errorf("invalid filename: %w", err)
	}
	resolved, _, err := resolveWaveRunCommandTarget(&WaveRunCommandToolInput{Command: "true"}, toolUseData)
	if err != nil || resolved == nil {
		if err != nil {
			return nil, fmt.Errorf("failed to resolve current remote terminal connection: %w", err)
		}
		return nil, fmt.Errorf("failed to resolve current remote terminal connection")
	}
	return resolved, nil
}

func resolveRemoteFileTarget(filename string, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, bool) {
	resolved, err := requireRemoteFileTarget(filename, toolUseData)
	return resolved, err == nil
}

func resolveRemoteWriteTarget(filename string, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, bool) {
	return resolveRemoteFileTarget(filename, toolUseData)
}

func validateFilename(filename string) error {
	for _, r := range filename {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("filename contains control characters (0x%02x), which are not allowed", r)
		}
	}
	return nil
}

func makeRemoteRpcOpts(target *WaveRunCommandToolInput, timeout int64) *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{
		Route:   wshutil.MakeConnectionRouteId(target.Connection),
		Timeout: timeout,
	}
}

func rpcRemoteWriteFile(target *WaveRunCommandToolInput, filename string, contents []byte) error {
	if target == nil {
		return fmt.Errorf("remote target is required")
	}
	rpcClient := wshclient.GetBareRpcClient()
	data := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: filename,
			Opts: &wshrpc.FileOpts{Truncate: true},
		},
		Data64: base64.StdEncoding.EncodeToString(contents),
	}
	opts := makeRemoteRpcOpts(target, 30000)
	return wshclient.RemoteWriteFileCommand(rpcClient, data, opts)
}

func rpcRemoteReadFile(target *WaveRunCommandToolInput, filename string) (string, error) {
	if target == nil {
		return "", fmt.Errorf("remote target is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rpcClient := wshclient.GetBareRpcClient()
	opts := makeRemoteRpcOpts(target, 30000)
	streamCh := wshclient.RemoteStreamFileCommand(rpcClient, wshrpc.CommandRemoteStreamFileData{
		Path: filename,
	}, opts)
	var buf bytes.Buffer
	if err := fsutil.ReadFileStreamToWriter(ctx, streamCh, &buf); err != nil {
		return "", fmt.Errorf("failed to read remote file %q: %w", filename, err)
	}
	return buf.String(), nil
}

func rpcRemoteDeleteFile(target *WaveRunCommandToolInput, filename string) error {
	if target == nil {
		return fmt.Errorf("remote target is required")
	}
	rpcClient := wshclient.GetBareRpcClient()
	opts := makeRemoteRpcOpts(target, 30000)
	return wshclient.RemoteFileDeleteCommand(rpcClient, wshrpc.CommandDeleteFileData{
		Path: filename,
	}, opts)
}

type writeTextFileParams struct {
	Filename string `json:"filename"`
	Contents string `json:"contents"`
}

func parseWriteTextFileInput(input any) (*writeTextFileParams, error) {
	result := &writeTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	if result.Contents == "" {
		return nil, fmt.Errorf("missing contents parameter")
	}

	return result, nil
}

func verifyWriteTextFileInput(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
	params, err := parseWriteTextFileInput(input)
	if err != nil {
		return err
	}

	if _, err := requireRemoteFileTarget(params.Filename, toolUseData); err != nil {
		return err
	}

	contentsBytes := []byte(params.Contents)
	if utilfn.HasBinaryData(contentsBytes) {
		return fmt.Errorf("contents appear to contain binary data")
	}

	toolUseData.InputFileName = params.Filename
	return nil
}

func writeTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseWriteTextFileInput(input)
	if err != nil {
		return nil, err
	}

	remoteTarget, err := requireRemoteFileTarget(params.Filename, toolUseData)
	if err != nil {
		return nil, err
	}

	contentsBytes := []byte(params.Contents)
	if utilfn.HasBinaryData(contentsBytes) {
		return nil, fmt.Errorf("contents appear to contain binary data")
	}
	if err := rpcRemoteWriteFile(remoteTarget, params.Filename, contentsBytes); err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully wrote %s (%d bytes) on remote host", params.Filename, len(contentsBytes)),
	}, nil
}

func GetWriteTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "write_text_file",
		DisplayName: "Write Text File",
		Description: "Write a text file on the current remote terminal connection. Only Linux absolute paths are supported. Will create or overwrite the file. Maximum file size: 100KB.",
		ToolLogName: "gen:writefile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Linux absolute path to the file to write on the current remote terminal connection. Relative paths are not supported.",
				},
				"contents": map[string]any{
					"type":        "string",
					"description": "The contents to write to the file",
				},
			},
			"required":             []string{"filename", "contents"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseWriteTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("writing %q", params.Filename)
		},
		ToolAnyCallback: writeTextFileCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalAutoApproved
		},
		ToolVerifyInput: verifyWriteTextFileInput,
	}
}

type editTextFileParams struct {
	Filename string              `json:"filename"`
	Edits    []fileutil.EditSpec `json:"edits"`
}

func parseEditTextFileInput(input any) (*editTextFileParams, error) {
	result := &editTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	if len(result.Edits) == 0 {
		return nil, fmt.Errorf("missing edits parameter")
	}

	return result, nil
}

func verifyEditTextFileInput(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
	params, err := parseEditTextFileInput(input)
	if err != nil {
		return err
	}

	if _, err := requireRemoteFileTarget(params.Filename, toolUseData); err != nil {
		return err
	}
	toolUseData.InputFileName = params.Filename
	return nil
}

// EditTextFileDryRun applies edits to a file and returns the original and modified content
// without writing to disk. Takes the same input format as editTextFileCallback.
func EditTextFileDryRun(input any, fileOverride string) ([]byte, []byte, error) {
	params, err := parseEditTextFileInput(input)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(fileOverride) == "" {
		return nil, nil, fmt.Errorf("remote edit dry run requires latest remote file contents")
	}
	originalContent := []byte(fileOverride)

	modifiedContent, _, err := applyEditBatch(originalContent, params.Edits)
	if err != nil {
		return nil, nil, err
	}

	return originalContent, modifiedContent, nil
}

func applyEditBatch(originalContent []byte, edits []fileutil.EditSpec) ([]byte, []fileutil.EditResult, error) {
	modifiedContent, results := fileutil.ApplyEditsPartial(originalContent, edits)
	for i, result := range results {
		if result.Applied {
			continue
		}
		appliedCount := i
		return nil, results, fmt.Errorf("edit %d/%d (%s) failed after %d applied edit(s): %s; reread the latest file and retry with a smaller replacement", i+1, len(edits), result.Desc, appliedCount, result.Error)
	}
	return modifiedContent, results, nil
}

func fileChecksum(data []byte) [sha256.Size]byte {
	return sha256.Sum256(data)
}

func editTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseEditTextFileInput(input)
	if err != nil {
		return nil, err
	}

	remoteTarget, err := requireRemoteFileTarget(params.Filename, toolUseData)
	if err != nil {
		return nil, err
	}
	remoteContent, err := rpcRemoteReadFile(remoteTarget, params.Filename)
	if err != nil {
		return nil, err
	}
	originalBytes := []byte(remoteContent)
	originalChecksum := fileChecksum(originalBytes)
	modifiedContent, _, err := applyEditBatch(originalBytes, params.Edits)
	if err != nil {
		return nil, err
	}
	preWriteContent, err := rpcRemoteReadFile(remoteTarget, params.Filename)
	if err != nil {
		return nil, fmt.Errorf("failed to re-read file before writing (TOCTOU check): %w", err)
	}
	preWriteChecksum := fileChecksum([]byte(preWriteContent))
	if preWriteChecksum != originalChecksum {
		return nil, fmt.Errorf("file %q was modified by another process after reading; please re-read the file and retry the edit", params.Filename)
	}
	if err := rpcRemoteWriteFile(remoteTarget, params.Filename, modifiedContent); err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully edited %s with %d changes on remote host", params.Filename, len(params.Edits)),
	}, nil
}

func GetEditTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "edit_text_file",
		DisplayName: "Edit Text File",
		Description: "Edit a text file on the current remote terminal connection using precise search and replace. Only Linux absolute paths are supported. Prefer small batches and reread the latest file before retrying. " +
			"Each old_str must appear EXACTLY ONCE in the file or the edit will fail. " +
			"All edits are applied atomically - if any single edit fails, the entire operation fails and no changes are made. " +
			"Maximum file size: 100KB.",
		ToolLogName: "gen:editfile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Linux absolute path to the file to edit on the current remote terminal connection. Relative paths are not supported.",
				},
				"edits": map[string]any{
					"type":        "array",
					"description": "Array of edit specifications. Prefer a few small replacements at a time, reread the latest file if one misses, and keep the edit narrow. All edits are applied atomically - if any edit fails, none are applied.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"old_str": map[string]any{
								"type":        "string",
								"description": "The exact string to find and replace. Use a narrow block from the latest file content. MUST appear exactly once in the file - if it appears zero times or multiple times, the entire edit operation will fail.",
							},
							"new_str": map[string]any{
								"type":        "string",
								"description": "The string to replace with",
							},
							"desc": map[string]any{
								"type":        "string",
								"description": "Description of what this edit does (keep it VERY short, one sentence max)",
							},
						},
						"required":             []string{"old_str", "new_str", "desc"},
						"additionalProperties": false,
					},
				},
			},
			"required":             []string{"filename", "edits"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseEditTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			editCount := len(params.Edits)
			editWord := "edits"
			if editCount == 1 {
				editWord = "edit"
			}
			return fmt.Sprintf("editing %q (%d %s)", params.Filename, editCount, editWord)
		},
		ToolAnyCallback: editTextFileCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalAutoApproved
		},
		ToolVerifyInput: verifyEditTextFileInput,
	}
}

type deleteTextFileParams struct {
	Filename string `json:"filename"`
}

func parseDeleteTextFileInput(input any) (*deleteTextFileParams, error) {
	result := &deleteTextFileParams{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}

	if result.Filename == "" {
		return nil, fmt.Errorf("missing filename parameter")
	}

	return result, nil
}

func verifyDeleteTextFileInput(input any, toolUseData *uctypes.UIMessageDataToolUse) error {
	params, err := parseDeleteTextFileInput(input)
	if err != nil {
		return err
	}

	if _, err := requireRemoteFileTarget(params.Filename, toolUseData); err != nil {
		return err
	}
	toolUseData.InputFileName = params.Filename
	return nil
}

func deleteTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseDeleteTextFileInput(input)
	if err != nil {
		return nil, err
	}

	remoteTarget, err := requireRemoteFileTarget(params.Filename, toolUseData)
	if err != nil {
		return nil, err
	}
	if err := rpcRemoteDeleteFile(remoteTarget, params.Filename); err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully deleted %s on remote host", params.Filename),
	}, nil
}

func GetDeleteTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "delete_text_file",
		DisplayName: "Delete Text File",
		Description: "Delete a text file on the current remote terminal connection. Only Linux absolute paths are supported. Maximum file size: 100KB.",
		ToolLogName: "gen:deletefile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Linux absolute path to the file to delete on the current remote terminal connection. Relative paths are not supported.",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseDeleteTextFileInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("deleting %q", params.Filename)
		},
		ToolAnyCallback: deleteTextFileCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalNeedsApproval
		},
		ToolVerifyInput: verifyDeleteTextFileInput,
	}
}
