// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/filebackup"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const MaxEditFileSize = 100 * 1024 // 100KB

func localAbsolutePathExample() string {
	if runtime.GOOS == "windows" {
		return `C:\Users\you\notes.txt`
	}
	return "/tmp/notes.txt"
}

func resolveAndValidateLocalAbsolutePath(filename string) (string, error) {
	trimmedInput := strings.TrimSpace(filename)
	if runtime.GOOS == "windows" && strings.HasPrefix(trimmedInput, "/") && !strings.HasPrefix(trimmedInput, "//") {
		return "", fmt.Errorf(
			"path %q looks like a Linux absolute path, but file tools write to local %s files only; use a local absolute path (for example %s), or use wave_run_command for remote paths",
			filename,
			runtime.GOOS,
			localAbsolutePathExample(),
		)
	}

	expandedPath, err := wavebase.ExpandHomeDir(filename)
	if err != nil {
		return "", fmt.Errorf("failed to expand path: %w", err)
	}

	if filepath.IsAbs(expandedPath) {
		return expandedPath, nil
	}

	trimmedPath := strings.TrimSpace(expandedPath)
	if runtime.GOOS == "windows" && strings.HasPrefix(trimmedPath, "/") && !strings.HasPrefix(trimmedPath, "//") {
		return "", fmt.Errorf(
			"path %q looks like a Linux absolute path, but file tools write to local %s files only; use a local absolute path (for example %s), or use wave_run_command for remote paths",
			filename,
			runtime.GOOS,
			localAbsolutePathExample(),
		)
	}

	return "", fmt.Errorf("path must be absolute, got relative path: %s", filename)
}

func isPosixAbsolutePath(filename string) bool {
	trimmed := strings.TrimSpace(filename)
	return strings.HasPrefix(trimmed, "/") && !strings.HasPrefix(trimmed, "//")
}

func resolveRemoteWriteTarget(filename string, toolUseData *uctypes.UIMessageDataToolUse) (*WaveRunCommandToolInput, bool) {
	if !isPosixAbsolutePath(filename) {
		return nil, false
	}
	resolved, _, err := resolveWaveRunCommandTarget(&WaveRunCommandToolInput{Command: "true"}, toolUseData)
	if err != nil || resolved == nil {
		return nil, false
	}
	return resolved, true
}

func quoteForSingleQuotedShell(value string) string {
	return strings.ReplaceAll(value, `'`, `'"'"'`)
}

func buildRemoteWriteCommand(filename string, contents string) string {
	marker := fmt.Sprintf("WAVE_WRITE_EOF_%d", time.Now().UnixNano())
	for strings.Contains(contents, "\n"+marker+"\n") || strings.HasSuffix(contents, "\n"+marker) {
		marker = fmt.Sprintf("WAVE_WRITE_EOF_%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("cat > '%s' <<'%s'\n%s\n%s", quoteForSingleQuotedShell(filename), marker, contents, marker)
}

func runRemoteWriteCommand(target *WaveRunCommandToolInput, command string) error {
	if target == nil {
		return fmt.Errorf("remote target is required")
	}
	result, err := runRemoteCommand(target, command, 30*time.Second, 32768)
	if err != nil {
		return err
	}
	if result.Status == "error" {
		return fmt.Errorf("remote write command failed: %s", strings.TrimSpace(result.Error))
	}
	if result.ExitCode != nil && *result.ExitCode != 0 {
		errText := strings.TrimSpace(result.Error)
		if errText == "" {
			errText = strings.TrimSpace(result.Output)
		}
		if errText == "" {
			errText = fmt.Sprintf("exit code %d", *result.ExitCode)
		}
		return fmt.Errorf("remote write command failed: %s", errText)
	}
	return nil
}

func runRemoteReadFileCommand(target *WaveRunCommandToolInput, filename string) (string, error) {
	if target == nil {
		return "", fmt.Errorf("remote target is required")
	}
	readCmd := fmt.Sprintf("cat -- '%s'", quoteForSingleQuotedShell(filename))
	result, err := runRemoteCommand(target, readCmd, 30*time.Second, 512*1024)
	if err != nil {
		return "", err
	}
	if result.Status == "error" {
		return "", fmt.Errorf("remote read command failed: %s", strings.TrimSpace(result.Error))
	}
	if result.ExitCode != nil && *result.ExitCode != 0 {
		errText := strings.TrimSpace(result.Error)
		if errText == "" {
			errText = strings.TrimSpace(result.Output)
		}
		if errText == "" {
			errText = fmt.Sprintf("exit code %d", *result.ExitCode)
		}
		return "", fmt.Errorf("remote read command failed: %s", errText)
	}
	return result.Output, nil
}

func runRemoteCommand(
	target *WaveRunCommandToolInput,
	command string,
	timeout time.Duration,
	tailBytes int64,
) (*wshrpc.CommandAgentGetCommandResultRtnData, error) {
	rpcClient := wshclient.GetBareRpcClient()
	started, err := wshclient.AgentRunCommandCommand(rpcClient, wshrpc.CommandAgentRunCommandData{
		ConnName:    target.Connection,
		Cwd:         target.Cwd,
		Cmd:         "sh",
		Args:        []string{"-lc", command},
		Interactive: false,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to start remote command: %w", err)
	}
	deadline := time.Now().Add(timeout)
	for {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out waiting for remote command result")
		}
		result, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
			JobId:     started.JobId,
			TailBytes: tailBytes,
		}, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to read remote command result: %w", err)
		}
		if result.Status == "running" {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		return result, nil
	}
}

func isBlockedFile(expandedPath string) (bool, string) {
	homeDir := os.Getenv("HOME")
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}

	cleanPath := filepath.Clean(expandedPath)
	baseName := filepath.Base(cleanPath)

	exactPaths := []struct {
		path   string
		reason string
	}{
		{filepath.Join(homeDir, ".aws", "credentials"), "AWS credentials file"},
		{filepath.Join(homeDir, ".git-credentials"), "Git credentials file"},
		{filepath.Join(homeDir, ".netrc"), "netrc credentials file"},
		{filepath.Join(homeDir, ".pgpass"), "PostgreSQL password file"},
		{filepath.Join(homeDir, ".my.cnf"), "MySQL credentials file"},
		{filepath.Join(homeDir, ".kube", "config"), "Kubernetes config file"},
		{"/etc/shadow", "system password file"},
		{"/etc/sudoers", "system sudoers file"},
	}

	for _, ep := range exactPaths {
		if cleanPath == ep.path {
			return true, ep.reason
		}
	}

	dirPrefixes := []struct {
		prefix string
		reason string
	}{
		{filepath.Join(homeDir, ".gnupg") + string(filepath.Separator), "GPG directory"},
		{filepath.Join(homeDir, ".password-store") + string(filepath.Separator), "password store directory"},
		{"/etc/sudoers.d/", "system sudoers directory"},
		{"/Library/Keychains/", "macOS keychain directory"},
		{filepath.Join(homeDir, "Library", "Keychains") + string(filepath.Separator), "macOS keychain directory"},
	}

	for _, dp := range dirPrefixes {
		if strings.HasPrefix(cleanPath, dp.prefix) {
			return true, dp.reason
		}
	}

	if strings.Contains(cleanPath, filepath.Join(homeDir, ".secrets")) {
		return true, "secrets directory"
	}

	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		credPath := filepath.Join(localAppData, "Microsoft", "Credentials")
		if strings.HasPrefix(cleanPath, credPath) {
			return true, "Windows credentials"
		}
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		credPath := filepath.Join(appData, "Microsoft", "Credentials")
		if strings.HasPrefix(cleanPath, credPath) {
			return true, "Windows credentials"
		}
	}

	if strings.HasPrefix(baseName, "id_") && strings.Contains(cleanPath, ".ssh") {
		return true, "SSH private key"
	}
	if strings.Contains(baseName, "id_rsa") {
		return true, "SSH private key"
	}
	if strings.HasPrefix(baseName, "ssh_host_") && strings.Contains(baseName, "key") {
		return true, "SSH host key"
	}

	extensions := map[string]string{
		".pem":      "certificate/key file",
		".p12":      "certificate file",
		".key":      "key file",
		".pfx":      "certificate file",
		".pkcs12":   "certificate file",
		".keystore": "Java keystore file",
		".jks":      "Java keystore file",
	}

	if reason, exists := extensions[filepath.Ext(baseName)]; exists {
		return true, reason
	}

	if baseName == ".git-credentials" {
		return true, "Git credentials file"
	}

	return false, ""
}

func validateTextFile(expandedPath string, verb string, mustExist bool) (os.FileInfo, error) {
	if blocked, reason := isBlockedFile(expandedPath); blocked {
		return nil, fmt.Errorf("access denied: potentially sensitive file: %s", reason)
	}

	fileInfo, err := os.Lstat(expandedPath)
	if err != nil {
		if os.IsNotExist(err) {
			if mustExist {
				return nil, fmt.Errorf("file does not exist: %s", expandedPath)
			}
			return nil, nil
		}
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if fileInfo.Mode()&os.ModeSymlink != 0 {
		target, _ := os.Readlink(expandedPath)
		if target == "" {
			target = "(unknown)"
		}
		return nil, fmt.Errorf("cannot %s symlinks (target: %s). %s the target file directly if needed", verb, utilfn.MarshalJSONString(target), verb)
	}

	if fileInfo.IsDir() {
		return nil, fmt.Errorf("path is a directory, cannot %s it", verb)
	}

	if !fileInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("path is not a regular file (devices, pipes, sockets not supported)")
	}

	if fileInfo.Size() > MaxEditFileSize {
		return nil, fmt.Errorf("file is too large (%d bytes, max %d bytes)", fileInfo.Size(), MaxEditFileSize)
	}

	fileData, err := os.ReadFile(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	if utilfn.HasBinaryData(fileData) {
		return nil, fmt.Errorf("file appears to contain binary data")
	}

	dirPath := filepath.Dir(expandedPath)
	dirInfo, err := os.Stat(dirPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to stat directory: %w", err)
	}
	if err == nil && dirInfo.Mode().Perm()&0222 == 0 {
		return nil, fmt.Errorf("directory is not writable (no write permission)")
	}

	return fileInfo, nil
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

	if _, isRemoteTarget := resolveRemoteWriteTarget(params.Filename, toolUseData); isRemoteTarget {
		contentsBytes := []byte(params.Contents)
		if utilfn.HasBinaryData(contentsBytes) {
			return fmt.Errorf("contents appear to contain binary data")
		}
		toolUseData.InputFileName = params.Filename
		return nil
	}

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return err
	}

	contentsBytes := []byte(params.Contents)
	if utilfn.HasBinaryData(contentsBytes) {
		return fmt.Errorf("contents appear to contain binary data")
	}

	_, err = validateTextFile(expandedPath, "write to", false)
	if err != nil {
		return err
	}

	toolUseData.InputFileName = params.Filename
	return nil
}

func writeTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseWriteTextFileInput(input)
	if err != nil {
		return nil, err
	}

	if remoteTarget, isRemoteTarget := resolveRemoteWriteTarget(params.Filename, toolUseData); isRemoteTarget {
		contentsBytes := []byte(params.Contents)
		if utilfn.HasBinaryData(contentsBytes) {
			return nil, fmt.Errorf("contents appear to contain binary data")
		}
		if err := runRemoteWriteCommand(remoteTarget, buildRemoteWriteCommand(params.Filename, params.Contents)); err != nil {
			return nil, err
		}
		return map[string]any{
			"success": true,
			"message": fmt.Sprintf("Successfully wrote %s (%d bytes) on remote host", params.Filename, len(contentsBytes)),
		}, nil
	}

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return nil, err
	}

	contentsBytes := []byte(params.Contents)
	if utilfn.HasBinaryData(contentsBytes) {
		return nil, fmt.Errorf("contents appear to contain binary data")
	}

	fileInfo, err := validateTextFile(expandedPath, "write to", false)
	if err != nil {
		return nil, err
	}

	dirPath := filepath.Dir(expandedPath)
	err = os.MkdirAll(dirPath, 0755)
	if err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	if fileInfo != nil {
		backupPath, err := filebackup.MakeFileBackup(expandedPath)
		if err != nil {
			return nil, fmt.Errorf("failed to create backup: %w", err)
		}
		toolUseData.WriteBackupFileName = backupPath
	}

	err = os.WriteFile(expandedPath, contentsBytes, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully wrote %s (%d bytes)", params.Filename, len(contentsBytes)),
	}, nil
}

func GetWriteTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "write_text_file",
		DisplayName: "Write Text File",
		Description: "Write a text file to the filesystem. Will create or overwrite the file. Maximum file size: 100KB.",
		ToolLogName: "gen:writefile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Absolute path to the file to write. Supports '~' for the user's home directory. Relative paths are not supported.",
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
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
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

	if _, isRemoteTarget := resolveRemoteWriteTarget(params.Filename, toolUseData); isRemoteTarget {
		toolUseData.InputFileName = params.Filename
		return nil
	}

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return err
	}

	_, err = validateTextFile(expandedPath, "edit", true)
	if err != nil {
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

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return nil, nil, err
	}

	_, err = validateTextFile(expandedPath, "edit", true)
	if err != nil {
		return nil, nil, err
	}

	readPath := expandedPath
	if fileOverride != "" {
		readPath = fileOverride
	}

	originalContent, err := os.ReadFile(readPath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read file: %w", err)
	}

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

func editTextFileCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseEditTextFileInput(input)
	if err != nil {
		return nil, err
	}

	if remoteTarget, isRemoteTarget := resolveRemoteWriteTarget(params.Filename, toolUseData); isRemoteTarget {
		remoteContent, err := runRemoteReadFileCommand(remoteTarget, params.Filename)
		if err != nil {
			return nil, err
		}
		modifiedContent, _, err := applyEditBatch([]byte(remoteContent), params.Edits)
		if err != nil {
			return nil, err
		}
		if err := runRemoteWriteCommand(remoteTarget, buildRemoteWriteCommand(params.Filename, string(modifiedContent))); err != nil {
			return nil, err
		}
		return map[string]any{
			"success": true,
			"message": fmt.Sprintf("Successfully edited %s with %d changes on remote host", params.Filename, len(params.Edits)),
		}, nil
	}

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return nil, err
	}

	_, err = validateTextFile(expandedPath, "edit", true)
	if err != nil {
		return nil, err
	}

	originalContent, err := os.ReadFile(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	modifiedContent, _, err := applyEditBatch(originalContent, params.Edits)
	if err != nil {
		return nil, err
	}

	fileInfo, err := os.Stat(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file before writing: %w", err)
	}

	backupPath, err := filebackup.MakeFileBackup(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup: %w", err)
	}
	toolUseData.WriteBackupFileName = backupPath

	err = os.WriteFile(expandedPath, modifiedContent, fileInfo.Mode())
	if err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully edited %s with %d changes", params.Filename, len(params.Edits)),
	}, nil
}

func GetEditTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "edit_text_file",
		DisplayName: "Edit Text File",
		Description: "Edit a text file using precise search and replace. Prefer small batches and reread the latest file before retrying. " +
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
					"description": "Absolute path to the file to edit. Supports '~' for the user's home directory. Relative paths are not supported.",
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
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
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

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return err
	}

	_, err = validateTextFile(expandedPath, "delete", true)
	if err != nil {
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

	expandedPath, err := resolveAndValidateLocalAbsolutePath(params.Filename)
	if err != nil {
		return nil, err
	}

	_, err = validateTextFile(expandedPath, "delete", true)
	if err != nil {
		return nil, err
	}

	backupPath, err := filebackup.MakeFileBackup(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create backup: %w", err)
	}
	toolUseData.WriteBackupFileName = backupPath

	err = os.Remove(expandedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to delete file: %w", err)
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Successfully deleted %s", params.Filename),
	}, nil
}

func GetDeleteTextFileToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "delete_text_file",
		DisplayName: "Delete Text File",
		Description: "Delete a text file from the filesystem. A backup is created before deletion. Maximum file size: 100KB.",
		ToolLogName: "gen:deletefile",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Absolute path to the file to delete. Supports '~' for the user's home directory. Relative paths are not supported.",
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
		ToolApproval: func(input any) string {
			return uctypes.ApprovalNeedsApproval
		},
		ToolVerifyInput: verifyDeleteTextFileInput,
	}
}
