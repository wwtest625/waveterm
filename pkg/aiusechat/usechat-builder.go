// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// CreateWriteTextFileDiff generates a diff for write_text_file or edit_text_file tool calls.
// Returns the original content, modified content, and any error.
// For Anthropic, this returns an unimplemented error.
func CreateWriteTextFileDiff(ctx context.Context, chatId string, toolCallId string) ([]byte, []byte, error) {
	aiChat := chatstore.DefaultChatStore.Get(chatId)
	if aiChat == nil {
		return nil, nil, fmt.Errorf("chat not found: %s", chatId)
	}

	backend, err := GetBackendByAPIType(aiChat.APIType)
	if err != nil {
		return nil, nil, err
	}

	funcCallInput := backend.GetFunctionCallInputByToolCallId(*aiChat, toolCallId)
	if funcCallInput == nil {
		return nil, nil, fmt.Errorf("tool call not found: %s", toolCallId)
	}

	toolName := funcCallInput.Name
	if toolName != "write_text_file" && toolName != "edit_text_file" {
		return nil, nil, fmt.Errorf("tool call %s is not a write_text_file or edit_text_file (got: %s)", toolCallId, toolName)
	}

	var backupFileName string
	if funcCallInput.ToolUseData != nil {
		backupFileName = funcCallInput.ToolUseData.WriteBackupFileName
	}

	var parsedArguments any
	if err := json.Unmarshal([]byte(funcCallInput.Arguments), &parsedArguments); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal arguments: %w", err)
	}

	if toolName == "edit_text_file" {
		var originalContentOverride []byte
		if backupFileName != "" {
			originalContentOverride, err = os.ReadFile(backupFileName)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to read backup file: %w", err)
			}
		} else {
			params, parseErr := parseEditTextFileInput(parsedArguments)
			if parseErr != nil {
				return nil, nil, fmt.Errorf("failed to parse edit_text_file input: %w", parseErr)
			}
			remoteTarget, targetErr := requireRemoteFileTarget(params.Filename, funcCallInput.ToolUseData)
			if targetErr != nil {
				return nil, nil, fmt.Errorf("failed to resolve remote file target: %w", targetErr)
			}
			originalText, readErr := rpcRemoteReadFile(remoteTarget, params.Filename)
			if readErr != nil {
				return nil, nil, fmt.Errorf("failed to read original remote file: %w", readErr)
			}
			originalContentOverride = []byte(originalText)
		}

		originalContent, modifiedContent, err := EditTextFileDryRun(parsedArguments, string(originalContentOverride))
		if err != nil {
			return nil, nil, fmt.Errorf("failed to generate diff: %w", err)
		}
		return originalContent, modifiedContent, nil
	}

	params, err := parseWriteTextFileInput(parsedArguments)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse write_text_file input: %w", err)
	}

	remoteTarget, err := requireRemoteFileTarget(params.Filename, funcCallInput.ToolUseData)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to resolve remote file target: %w", err)
	}

	var originalContent []byte
	originalText, err := rpcRemoteReadFile(remoteTarget, params.Filename)
	if err != nil {
		if !strings.Contains(strings.ToLower(err.Error()), "no such file") {
			return nil, nil, fmt.Errorf("failed to read original remote file: %w", err)
		}
	} else {
		originalContent = []byte(originalText)
	}

	modifiedContent := []byte(params.Contents)
	return originalContent, modifiedContent, nil
}

// StaticFileInfo describes a static asset bundled inside a Builder application.
type StaticFileInfo struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	Modified     string `json:"modified"`
	ModifiedTime string `json:"modified_time"`
}

// generateBuilderAppData reads the on-disk Builder application identified by appId
// and returns (app.go source, JSON of static/ file index, platform info string).
// Errors when reading individual parts are non-fatal; an empty default is returned
// and the caller proceeds without that data.
func generateBuilderAppData(appId string) (string, string, string, error) {
	appGoFile := ""
	fileData, err := waveappstore.ReadAppFile(appId, "app.go")
	if err == nil {
		appGoFile = string(fileData.Contents)
	}

	staticFilesJSON := ""
	allFiles, err := waveappstore.ListAllAppFiles(appId)
	if err == nil {
		var staticFiles []StaticFileInfo
		for _, entry := range allFiles.Entries {
			if strings.HasPrefix(entry.Name, "static/") {
				staticFiles = append(staticFiles, StaticFileInfo{
					Name:         entry.Name,
					Size:         entry.Size,
					Modified:     entry.Modified,
					ModifiedTime: entry.ModifiedTime,
				})
			}
		}

		if len(staticFiles) > 0 {
			staticFilesBytes, marshalErr := json.Marshal(staticFiles)
			if marshalErr == nil {
				staticFilesJSON = string(staticFilesBytes)
			}
		}
	}

	platformInfo := wavebase.GetSystemSummary()
	if currentUser, userErr := user.Current(); userErr == nil && currentUser.Username != "" {
		platformInfo = fmt.Sprintf("Host Machine: %s, User: %s", platformInfo, currentUser.Username)
	} else {
		platformInfo = fmt.Sprintf("Host Machine: %s", platformInfo)
	}

	return appGoFile, staticFilesJSON, platformInfo, nil
}
