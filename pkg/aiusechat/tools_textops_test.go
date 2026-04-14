// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestWriteTextFileCallbackCreatesNestedFile(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "nested", "created.txt")
	toolUseData := &uctypes.UIMessageDataToolUse{}

	result, err := writeTextFileCallback(map[string]any{
		"filename": targetFile,
		"contents": "hello\nworld\n",
	}, toolUseData)
	if err != nil {
		t.Fatalf("writeTextFileCallback returned error: %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("expected map result, got %T", result)
	}
	if resultMap["success"] != true {
		t.Fatalf("expected success flag, got %#v", resultMap["success"])
	}

	content, err := os.ReadFile(targetFile)
	if err != nil {
		t.Fatalf("failed to read written file: %v", err)
	}
	if string(content) != "hello\nworld\n" {
		t.Fatalf("unexpected file contents: %q", string(content))
	}
}

func TestVerifyWriteTextFileInputStoresInputFileName(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "write.txt")
	toolUseData := &uctypes.UIMessageDataToolUse{}

	err := verifyWriteTextFileInput(map[string]any{
		"filename": targetFile,
		"contents": "hello",
	}, toolUseData)
	if err != nil {
		t.Fatalf("verifyWriteTextFileInput returned error: %v", err)
	}
	if toolUseData.InputFileName != targetFile {
		t.Fatalf("expected InputFileName to be recorded, got %q", toolUseData.InputFileName)
	}
}

func TestEditTextFileDryRunAppliesEdit(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "edit.txt")
	err := os.WriteFile(targetFile, []byte("alpha\nbeta\ngamma\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	original, modified, err := EditTextFileDryRun(map[string]any{
		"filename": targetFile,
		"edits": []map[string]any{
			{
				"old_str": "beta",
				"new_str": "delta",
				"desc":    "rename middle line",
			},
		},
	}, "")
	if err != nil {
		t.Fatalf("EditTextFileDryRun returned error: %v", err)
	}

	if string(original) != "alpha\nbeta\ngamma\n" {
		t.Fatalf("unexpected original content: %q", string(original))
	}
	if string(modified) != "alpha\ndelta\ngamma\n" {
		t.Fatalf("unexpected modified content: %q", string(modified))
	}
}

func TestEditTextFileDryRunFailsWhenOldStringAppearsMultipleTimes(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "duplicate.txt")
	err := os.WriteFile(targetFile, []byte("repeat\nrepeat\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, _, err = EditTextFileDryRun(map[string]any{
		"filename": targetFile,
		"edits": []fileutil.EditSpec{
			{
				OldStr: "repeat",
				NewStr: "once",
				Desc:   "replace duplicate",
			},
		},
	}, "")
	if err == nil {
		t.Fatal("expected duplicate match to fail")
	}
	if !strings.Contains(err.Error(), "must appear exactly once") {
		t.Fatalf("expected duplicate match error, got %v", err)
	}
}

func TestEditTextFileDryRunReportsAppliedEditCountOnFailure(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "count.txt")
	err := os.WriteFile(targetFile, []byte("alpha\nbeta\ngamma\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, _, err = EditTextFileDryRun(map[string]any{
		"filename": targetFile,
		"edits": []map[string]any{
			{
				"old_str": "beta",
				"new_str": "delta",
				"desc":    "rename middle line",
			},
			{
				"old_str": "missing",
				"new_str": "epsilon",
				"desc":    "second change",
			},
		},
	}, "")
	if err == nil {
		t.Fatal("expected second edit to fail")
	}
	if !strings.Contains(err.Error(), "after 1 applied edit(s)") {
		t.Fatalf("expected applied edit count in error, got %v", err)
	}
	if !strings.Contains(err.Error(), "retry with a smaller replacement") {
		t.Fatalf("expected retry hint in error, got %v", err)
	}
}

func TestEditTextFileToolDefinitionMentionsSmallBatchesAndLatestFile(t *testing.T) {
	def := GetEditTextFileToolDefinition()
	if !strings.Contains(def.Description, "Prefer small batches") {
		t.Fatalf("expected edit tool description to encourage small batches, got %q", def.Description)
	}

	inputSchema, ok := def.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected object properties schema, got %T", def.InputSchema["properties"])
	}
	editsSchema, ok := inputSchema["edits"].(map[string]any)
	if !ok {
		t.Fatalf("expected edits schema, got %T", inputSchema["edits"])
	}
	editsDesc, ok := editsSchema["description"].(string)
	if !ok {
		t.Fatalf("expected edits schema description to be a string, got %T", editsSchema["description"])
	}
	if !strings.Contains(editsDesc, "latest file") {
		t.Fatalf("expected edits schema to mention latest file, got %q", editsDesc)
	}
	itemsSchema, ok := editsSchema["items"].(map[string]any)
	if !ok {
		t.Fatalf("expected edits items schema, got %T", editsSchema["items"])
	}
	propertiesSchema, ok := itemsSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected edits properties schema, got %T", itemsSchema["properties"])
	}
	oldStrSchema, ok := propertiesSchema["old_str"].(map[string]any)
	if !ok {
		t.Fatalf("expected old_str schema, got %#v", itemsSchema["properties"])
	}
	oldStrDesc, ok := oldStrSchema["description"].(string)
	if !ok {
		t.Fatalf("expected old_str description to be a string, got %T", oldStrSchema["description"])
	}
	if !strings.Contains(oldStrDesc, "latest file content") {
		t.Fatalf("expected old_str schema to mention latest file content, got %q", oldStrDesc)
	}
}

func TestEditTextFileDryRunSupportsLineEndingFallback(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "crlf.txt")
	err := os.WriteFile(targetFile, []byte("alpha\r\nbeta\r\ngamma\r\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, modified, err := EditTextFileDryRun(map[string]any{
		"filename": targetFile,
		"edits": []map[string]any{
			{
				"old_str": "beta\ngamma\n",
				"new_str": "BETA\nGAMMA\n",
				"desc":    "line ending fallback replacement",
			},
		},
	}, "")
	if err != nil {
		t.Fatalf("EditTextFileDryRun should succeed with line-ending fallback, got: %v", err)
	}

	if string(modified) != "alpha\r\nBETA\r\nGAMMA\r\n" {
		t.Fatalf("unexpected modified content: %q", string(modified))
	}
}

func TestGenerateTabStateAndTools_AlwaysIncludesFileToolsWithoutWidgetAccess(t *testing.T) {
	toolsState, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	if !strings.Contains(toolsState, "The user has chosen not to share widget context") {
		t.Fatalf("expected non-widget tab state fallback, got %q", toolsState)
	}
	toolNames := make(map[string]bool)
	for _, tool := range tools {
		toolNames[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !toolNames[name] {
			t.Fatalf("expected %s to stay exposed without widget access, got %#v", name, toolNames)
		}
	}
}

func TestGetSystemPrompt_PrefersRemoteTerminalExecutionByDefault(t *testing.T) {
	basePrompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(basePrompt, "When the current terminal is already remote, run the command there by default") {
		t.Fatalf("expected prompt to prefer current remote terminal by default, got %q", basePrompt)
	}
	if !strings.Contains(basePrompt, "Do not fall back to bash heredocs or shell redirection for file writes when file tools are available") {
		t.Fatalf("expected prompt to forbid shell heredoc fallback when file tools are available, got %q", basePrompt)
	}
}

func TestWaveRunCommandResultPayload_UsesHumanReadableSummaryForModel(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:      "job-123",
		Status:     "done",
		DurationMs: 8,
		ExitCode:   &exitCode,
	})
	if payload["status"] != "done" {
		t.Fatalf("expected done status, got %#v", payload["status"])
	}
	if payload["summary"] != "Command completed successfully (exit 0)." {
		t.Fatalf("expected human-readable summary, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_RunningIncludesReadableSummary(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["status"] != "running" {
		t.Fatalf("expected running status, got %#v", payload["status"])
	}
	if payload["summary"] != "Command is still running in the background." {
		t.Fatalf("expected running summary, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorIncludesReadableSummary(t *testing.T) {
	exitCode := 2
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:      "job-123",
		Status:     "error",
		DurationMs: 15,
		ExitCode:   &exitCode,
		Error:      "permission denied",
	})
	if payload["summary"] != "Command failed with exit 2: permission denied" {
		t.Fatalf("expected error summary, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_UsesOutputAsSummaryFallback(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:    "job-123",
		Status:   "done",
		ExitCode: &exitCode,
		Output:   "Linux version 6.8.0",
	})
	if payload["summary"] != "Linux version 6.8.0" {
		t.Fatalf("expected output summary fallback, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandToolResultUsesSummaryInsteadOfRawJSON(t *testing.T) {
	payload := map[string]any{
		"jobid":    "job-123",
		"status":   "done",
		"summary":  "Command completed successfully (exit 0).",
		"durationms": int64(8),
	}
	resultBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	result := uctypes.AIToolResult{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(resultBytes)}
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{result})
	if err != nil {
		t.Fatalf("ConvertToolResultsToNativeChatMessage returned error: %v", err)
	}
	stored, ok := msgs[0].(*openaichat.StoredChatMessage)
	if !ok {
		t.Fatalf("expected StoredChatMessage, got %T", msgs[0])
	}
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("expected summary content, got %q", stored.Message.Content)
	}
}

func TestWaveRunCommandOpenAIOutputUsesSummaryInsteadOfRawJSON(t *testing.T) {
	payload := map[string]any{
		"jobid":   "job-123",
		"status":  "done",
		"summary": "Command completed successfully (exit 0).",
	}
	resultBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(resultBytes)}})
	if err != nil {
		t.Fatalf("ConvertToolResultsToOpenAIChatMessage returned error: %v", err)
	}
	if msgs[0].FunctionCallOutput == nil {
		t.Fatal("expected function call output")
	}
	if output, ok := msgs[0].FunctionCallOutput.Output.(string); !ok || output != "Command completed successfully (exit 0)." {
		t.Fatalf("expected summary string output, got %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestGetToolCapabilityPrompt_AlwaysMentionsFileToolsWhenProvided(t *testing.T) {
	prompt := getToolCapabilityPrompt([]uctypes.ToolDefinition{
		GetWriteTextFileToolDefinition(),
		GetEditTextFileToolDefinition(),
		GetDeleteTextFileToolDefinition(),
	})
	if !strings.Contains(prompt, "file tools: write, edit, or delete local files") {
		t.Fatalf("expected file tools capability prompt, got %q", prompt)
	}
}

func TestGetToolCapabilityPrompt_AlwaysMentionsWaveRunCommandDefaultTerminalTarget(t *testing.T) {
	prompt := getToolCapabilityPrompt([]uctypes.ToolDefinition{GetWaveRunCommandToolDefinition()})
	if !strings.Contains(prompt, "current Wave connection or current terminal target") {
		t.Fatalf("expected wave_run_command capability prompt to mention current terminal target, got %q", prompt)
	}
}

func TestWaveRunCommandToolDefinitionDescription_PrefersRemoteCurrentTerminal(t *testing.T) {
	def := GetWaveRunCommandToolDefinition()
	if !strings.Contains(def.Description, "When that terminal is already remote, run the target shell command directly there") {
		t.Fatalf("expected remote-terminal preference in tool description, got %q", def.Description)
	}
}

func TestGenerateTabStateAndTools_EmptyTabStillKeepsTextOpsAvailable(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	if len(tools) == 0 {
		t.Fatal("expected text tools even without tab context")
	}
}

func TestWaveRunCommandResultPayload_CompletionSummaryDoesNotExposeRawJSONShape(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:    "job-123",
		Status:   "done",
		ExitCode: &exitCode,
	})
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary field to exist")
	}
	if payload["summary"] == payload["status"] {
		t.Fatalf("expected summary to be more descriptive than raw status, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_RunningKeepsJobId(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["jobid"] != "job-123" {
		t.Fatalf("expected jobid to be preserved, got %#v", payload["jobid"])
	}
}

func TestWaveRunCommandResultPayload_ErrorKeepsJobId(t *testing.T) {
	payload := waveRunCommandResultPayload("job-456", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-456", Status: "error", Error: "boom"})
	if payload["jobid"] != "job-456" {
		t.Fatalf("expected jobid to be preserved, got %#v", payload["jobid"])
	}
}

func TestWaveRunCommandResultPayload_OutputSummaryUsesFirstMeaningfulLine(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-789", &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:    "job-789",
		Status:   "done",
		ExitCode: &exitCode,
		Output:   "\nLinux version 6.8.0\nsecond line\n",
	})
	if payload["summary"] != "Linux version 6.8.0" {
		t.Fatalf("expected first meaningful output line as summary, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_GoneUsesReadableSummary(t *testing.T) {
	payload := waveRunCommandResultPayload("job-999", &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:  "job-999",
		Status: "gone",
		Error:  "job result is unavailable (job may have been cleaned up, deleted, or never existed)",
	})
	if !strings.Contains(payload["summary"].(string), "unavailable") {
		t.Fatalf("expected gone summary to mention unavailable, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_RunningSummaryNotEmpty(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if strings.TrimSpace(payload["summary"].(string)) == "" {
		t.Fatal("expected non-empty running summary")
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryNotEmpty(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "permission denied"})
	if strings.TrimSpace(payload["summary"].(string)) == "" {
		t.Fatal("expected non-empty error summary")
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryNotEmpty(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if strings.TrimSpace(payload["summary"].(string)) == "" {
		t.Fatal("expected non-empty done summary")
	}
}

func TestWaveRunCommandResultPayload_UsesErrorTextBeforeGenericDoneMessage(t *testing.T) {
	exitCode := 1
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode, Error: "permission denied"})
	if payload["summary"] != "Command failed with exit 1: permission denied" {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoneWithoutOutputUsesSuccessMessage(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if payload["summary"] != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_NonZeroExitWithoutErrorUsesExitMessage(t *testing.T) {
	exitCode := 2
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode})
	if payload["summary"] != "Command failed with exit 2." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_RunningDoesNotDropStatus(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["status"] != "running" {
		t.Fatalf("unexpected status: %#v", payload["status"])
	}
}

func TestWaveRunCommandResultPayload_DoneDoesNotDropStatus(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if payload["status"] != "done" {
		t.Fatalf("unexpected status: %#v", payload["status"])
	}
}

func TestWaveRunCommandResultPayload_ErrorDoesNotDropStatus(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "boom"})
	if payload["status"] != "error" {
		t.Fatalf("unexpected status: %#v", payload["status"])
	}
}

func TestWaveRunCommandResultPayload_StillCarriesRawFieldsForFrontend(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, DurationMs: 8, Output: "ok"})
	if payload["durationms"] != int64(8) {
		t.Fatalf("expected durationms, got %#v", payload["durationms"])
	}
	if payload["output"] != "ok" {
		t.Fatalf("expected output, got %#v", payload["output"])
	}
}

func TestWriteAndEditToolDefinitionsRemainAutoApproved(t *testing.T) {
	if GetWriteTextFileToolDefinition().ToolApproval(nil) != uctypes.ApprovalAutoApproved {
		t.Fatal("expected write tool to stay auto-approved")
	}
	if GetEditTextFileToolDefinition().ToolApproval(nil) != uctypes.ApprovalAutoApproved {
		t.Fatal("expected edit tool to stay auto-approved")
	}
}

func TestGetSystemPrompt_PrefersToolWritesOverShellRedirects(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection for file writes when file tools are available") {
		t.Fatalf("expected shell redirect warning, got %q", prompt)
	}
}

func TestGetSystemPrompt_PrefersCurrentRemoteTerminal(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "current terminal is already remote") {
		t.Fatalf("expected remote terminal preference, got %q", prompt)
	}
}

func TestGenerateTabStateAndTools_EmptyTabDoesNotRequireWidgetAccessForFileTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := make(map[string]bool)
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("expected write/edit/delete tools, got %#v", seen)
	}
}

func TestWaveRunCommandResultPayload_SummaryIsForModelsRawFieldsForUI(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "ok"})
	if payload["summary"] != "ok" {
		t.Fatalf("expected summary to mirror meaningful output, got %#v", payload["summary"])
	}
	if payload["output"] != "ok" {
		t.Fatalf("expected raw output to stay present, got %#v", payload["output"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotLoseJobIdOnSummaryAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["jobid"] != "job-123" {
		t.Fatalf("expected jobid, got %#v", payload["jobid"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotLoseExitCodeOnSummaryAdaptation(t *testing.T) {
	exitCode := 7
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode})
	if payload["exitcode"] != &exitCode {
		t.Fatalf("expected exitcode pointer to stay present, got %#v", payload["exitcode"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotLoseErrorOnSummaryAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "boom"})
	if payload["error"] != "boom" {
		t.Fatalf("expected error to stay present, got %#v", payload["error"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotLoseDurationOnSummaryAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", DurationMs: 11})
	if payload["durationms"] != int64(11) {
		t.Fatalf("expected durationms to stay present, got %#v", payload["durationms"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotLoseExitSignalOnSummaryAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitSignal: "TERM"})
	if payload["exitsignal"] != "TERM" {
		t.Fatalf("expected exitsignal to stay present, got %#v", payload["exitsignal"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotLoseStatusOnSummaryAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["status"] != "running" {
		t.Fatalf("expected status to stay present, got %#v", payload["status"])
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryUsesOutputBeforeGenericText(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "uname output"})
	if payload["summary"] != "uname output" {
		t.Fatalf("expected output summary, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryUsesErrorBeforeGenericText(t *testing.T) {
	exitCode := 1
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode, Error: "permission denied", Output: "ignored"})
	if payload["summary"] != "Command failed with exit 1: permission denied" {
		t.Fatalf("expected error summary, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_GoneSummaryUsesErrorText(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "gone", Error: "job result is unavailable"})
	if payload["summary"] != "job result is unavailable" {
		t.Fatalf("expected gone summary from error text, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_RunningSummaryStable(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["summary"] != "Command is still running in the background." {
		t.Fatalf("unexpected running summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryStable(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if payload["summary"] != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected done summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryStable(t *testing.T) {
	exitCode := 3
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode})
	if payload["summary"] != "Command failed with exit 3." {
		t.Fatalf("unexpected error summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_UsesTrimmedFirstLineForOutputSummary(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "\n  first line  \nsecond line"})
	if payload["summary"] != "first line" {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorWithoutExitCodeUsesErrorText(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "permission denied"})
	if payload["summary"] != "permission denied" {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoneWithoutExitCodeUsesOutput(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "ok"})
	if payload["summary"] != "ok" {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoneWithoutAnythingUsesGenericText(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done"})
	if payload["summary"] != "Command completed." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorWithoutAnythingUsesGenericText(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error"})
	if payload["summary"] != "Command failed." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_GoneWithoutAnythingUsesGenericText(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "gone"})
	if payload["summary"] != "Command result is unavailable." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_RunningWithoutAnythingUsesGenericText(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["summary"] != "Command is still running in the background." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoesNotDropOutputOnSummaryAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "ok"})
	if payload["output"] != "ok" {
		t.Fatalf("expected output to stay present, got %#v", payload["output"])
	}
}

func TestWaveRunCommandResultPayload_SummaryAlwaysString(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if _, ok := payload["summary"].(string); !ok {
		t.Fatalf("expected summary string, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryAlwaysString(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if _, ok := payload["summary"].(string); !ok {
		t.Fatalf("expected summary string, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryAlwaysString(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "boom"})
	if _, ok := payload["summary"].(string); !ok {
		t.Fatalf("expected summary string, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_GoneSummaryAlwaysString(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "gone", Error: "job result is unavailable"})
	if _, ok := payload["summary"].(string); !ok {
		t.Fatalf("expected summary string, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_PreservesStructuredFieldsWhileAddingSummary(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "ok", DurationMs: 9})
	if payload["summary"] != "ok" {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
	if payload["status"] != "done" || payload["output"] != "ok" || payload["durationms"] != int64(9) {
		t.Fatalf("expected structured fields to remain, got %#v", payload)
	}
}

func TestGetSystemPrompt_RemotePreferenceAndFileToolRuleAreDocumented(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "When the current terminal is already remote, run the command there by default") {
		t.Fatalf("expected remote preference, got %q", prompt)
	}
	if !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection for file writes when file tools are available") {
		t.Fatalf("expected file tool preference, got %q", prompt)
	}
}

func TestGenerateTabStateAndTools_NoWidgetAccessStillExposesTextTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := make(map[string]bool)
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("expected text tools without widget access, got %#v", seen)
	}
}

func TestWaveRunCommandResultAdaptation_ForModelUsesSummary(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if msgs[0].FunctionCallOutput.Output != "Command completed successfully (exit 0)." {
		t.Fatalf("expected summary string output, got %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestWaveRunCommandResultAdaptation_ForChatCompletionsUsesSummary(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("expected summary content, got %q", stored.Message.Content)
	}
}

func TestGenerateTabStateAndTools_WithoutWidgetAccessStillReturnsToolSlice(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	if tools == nil {
		t.Fatal("expected non-nil tools slice")
	}
}

func TestWaveRunCommandResultPayload_ProvidesSummaryField(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary field")
	}
}

func TestGetSystemPrompt_StillMentionsWaveRunCommand(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "wave_run_command") {
		t.Fatalf("expected wave_run_command in prompt, got %q", prompt)
	}
}

func TestGenerateTabStateAndTools_WithoutWidgetAccessStillExposesDeleteTool(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	foundDelete := false
	for _, tool := range tools {
		if tool.Name == "delete_text_file" {
			foundDelete = true
		}
	}
	if !foundDelete {
		t.Fatal("expected delete_text_file tool")
	}
}

func TestWaveRunCommandResultPayload_SummaryUsesFirstLineOfOutput(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "first\nsecond"})
	if payload["summary"] != "first" {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestGetSystemPrompt_DiscouragesShellRedirectionWhenFileToolsAvailable(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "shell redirection") {
		t.Fatalf("expected shell redirection guidance, got %q", prompt)
	}
}

func TestGetSystemPrompt_DocumentsRemoteCurrentTerminalDefault(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "already remote") {
		t.Fatalf("expected remote current terminal guidance, got %q", prompt)
	}
}

func TestWaveRunCommandResultPayload_RunningSummaryMentionsBackground(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if !strings.Contains(payload["summary"].(string), "background") {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryMentionsExitWhenExitCodePresent(t *testing.T) {
	exitCode := 4
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode})
	if !strings.Contains(payload["summary"].(string), "exit 4") {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryMentionsExitWhenExitCodePresent(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if !strings.Contains(payload["summary"].(string), "exit 0") {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestGenerateTabStateAndTools_WithoutWidgetAccessStillExposesWriteTool(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	foundWrite := false
	for _, tool := range tools {
		if tool.Name == "write_text_file" {
			foundWrite = true
		}
	}
	if !foundWrite {
		t.Fatal("expected write_text_file tool")
	}
}

func TestGenerateTabStateAndTools_WithoutWidgetAccessStillExposesEditTool(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	foundEdit := false
	for _, tool := range tools {
		if tool.Name == "edit_text_file" {
			foundEdit = true
		}
	}
	if !foundEdit {
		t.Fatal("expected edit_text_file tool")
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryFallsBackToCommandCompleted(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done"})
	if payload["summary"] != "Command completed." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryFallsBackToCommandFailed(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error"})
	if payload["summary"] != "Command failed." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_GoneSummaryFallsBackToUnavailable(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "gone"})
	if payload["summary"] != "Command result is unavailable." {
		t.Fatalf("unexpected summary: %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_PreservesOutputEvenWhenSummaryUsesFirstLine(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "first\nsecond"})
	if payload["output"] != "first\nsecond" {
		t.Fatalf("expected full output preserved, got %#v", payload["output"])
	}
}

func TestGetSystemPrompt_DocumentsToolWritesAndRemoteTerminalDefault(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "shell redirection") || !strings.Contains(prompt, "already remote") {
		t.Fatalf("expected both guidance lines, got %q", prompt)
	}
}

func TestWaveRunCommandResultPayload_StillIncludesStructuredStatusFields(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["status"] != "running" || payload["jobid"] != "job-123" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_StillIncludesStructuredCompletionFields(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, DurationMs: 3})
	if payload["exitcode"] != &exitCode || payload["durationms"] != int64(3) {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_StillIncludesStructuredErrorFields(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "boom"})
	if payload["error"] != "boom" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_SummaryExistsForAllStates(t *testing.T) {
	cases := []map[string]any{
		waveRunCommandResultPayload("job-1", nil),
		waveRunCommandResultPayload("job-2", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-2", Status: "done"}),
		waveRunCommandResultPayload("job-3", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-3", Status: "error"}),
	}
	for _, payload := range cases {
		if _, ok := payload["summary"]; !ok {
			t.Fatalf("missing summary in payload %#v", payload)
		}
	}
}

func TestGenerateTabStateAndTools_WithoutWidgetAccessStillExposesCoreMutationTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("expected %s in %#v", name, seen)
		}
	}
}

func TestGetSystemPrompt_ExplicitlyPrefersRemoteCurrentTerminalAndFileTools(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "run the command there by default") || !strings.Contains(prompt, "Do not fall back to bash heredocs") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandResultPayload_SummaryNotEqualToRawStatusForDone(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if payload["summary"] == "done" {
		t.Fatalf("summary should be descriptive, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_SummaryNotEqualToRawStatusForError(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", Error: "boom"})
	if payload["summary"] == "error" {
		t.Fatalf("summary should be descriptive, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_SummaryNotEqualToRawStatusForRunning(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["summary"] == "running" {
		t.Fatalf("summary should be descriptive, got %#v", payload["summary"])
	}
}

func TestWaveRunCommandResultPayload_SummaryNotEqualToRawStatusForGone(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "gone", Error: "job result is unavailable"})
	if payload["summary"] == "gone" {
		t.Fatalf("summary should be descriptive, got %#v", payload["summary"])
	}
}

func TestGetSystemPrompt_MentionsRemoteTerminalDefault(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "current terminal is already remote") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestGetSystemPrompt_MentionsNoHeredocFallbackWhenFileToolsAvailable(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "Do not fall back to bash heredocs") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestGenerateTabStateAndTools_NoWidgetAccessStillExposesWriteEditDelete(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("unexpected tool set: %#v", seen)
	}
}

func TestWaveRunCommandResultPayload_ForModelHasSummaryAndRawFields(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "ok"})
	if payload["summary"] != "ok" || payload["status"] != "done" || payload["jobid"] != "job-123" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_RunningModelSummaryIsReadable(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["summary"] != "Command is still running in the background." {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_ErrorModelSummaryIsReadable(t *testing.T) {
	exitCode := 2
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode})
	if payload["summary"] != "Command failed with exit 2." {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_DoneModelSummaryIsReadable(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if payload["summary"] != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_DoesNotBreakRawFrontendFields(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode, Output: "ok", DurationMs: 8})
	if payload["output"] != "ok" || payload["durationms"] != int64(8) || payload["exitcode"] != &exitCode {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGetSystemPrompt_CoversRemoteExecutionAndFileToolPreference(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "already remote") || !strings.Contains(prompt, "shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestGenerateTabStateAndTools_NoWidgetAccessStillExposesMutationTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	if len(tools) < 3 {
		t.Fatalf("expected at least write/edit/delete tools, got %#v", tools)
	}
}

func TestWaveRunCommandResultPayload_SummaryReadableButRawDataPreserved(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "gone", Error: "job result is unavailable"})
	if payload["summary"] != "job result is unavailable" || payload["error"] != "job result is unavailable" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGetSystemPrompt_DocumentsRemoteDefaultAndNoShellWriteFallback(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "run the command there by default") || !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestGenerateTabStateAndTools_NoWidgetAccessStillExposesCoreWriteTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("unexpected tool set: %#v", seen)
	}
}

func TestWaveRunCommandResultPayload_DoneSummaryReadableAndStatusPreserved(t *testing.T) {
	exitCode := 0
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", ExitCode: &exitCode})
	if payload["summary"] != "Command completed successfully (exit 0)." || payload["status"] != "done" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_RunningSummaryReadableAndStatusPreserved(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if payload["summary"] != "Command is still running in the background." || payload["status"] != "running" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWaveRunCommandResultPayload_ErrorSummaryReadableAndStatusPreserved(t *testing.T) {
	exitCode := 2
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "error", ExitCode: &exitCode})
	if payload["summary"] != "Command failed with exit 2." || payload["status"] != "error" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGetSystemPrompt_DocumentsRemoteExecutionPreference(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "current terminal is already remote") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestGetSystemPrompt_DocumentsFileToolPreferenceOverShellRedirects(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestGenerateTabStateAndTools_WithoutWidgetAccessStillExposesWriteEditDeleteTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("missing %s in %#v", name, seen)
		}
	}
}

func TestWaveRunCommandResultPayload_ReadableSummaryPreventsRawModelJsonLeak(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary to exist")
	}
}

func TestWaveRunCommandModelAdaptationUsesSummaryText(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "running", "summary": "Command is still running in the background."}
	bytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if msgs[0].FunctionCallOutput.Output != "Command is still running in the background." {
		t.Fatalf("unexpected output: %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestWaveRunCommandChatCompletionsAdaptationUsesSummaryText(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "running", "summary": "Command is still running in the background."}
	bytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command is still running in the background." {
		t.Fatalf("unexpected output: %q", stored.Message.Content)
	}
}

func TestGenerateTabStateAndTools_FileToolsNotBlockedByWidgetAccess(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	toolNames := map[string]bool{}
	for _, tool := range tools {
		toolNames[tool.Name] = true
	}
	if !toolNames["write_text_file"] || !toolNames["edit_text_file"] || !toolNames["delete_text_file"] {
		t.Fatalf("unexpected tool names: %#v", toolNames)
	}
}

func TestPromptReassertsRemoteDefaultAndFileToolPreference(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "run the command there by default") || !strings.Contains(prompt, "Do not fall back to bash heredocs") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandReadableSummaryExistsForModelAdaptation(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done"})
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary field")
	}
}

func TestWaveRunCommandReadableSummaryDoesNotRemoveRawFields(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "ok"})
	if payload["output"] != "ok" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGenerateTabStateAndTools_WriteToolsRemainAvailableWithoutWidgetAccess(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("unexpected tool set: %#v", seen)
	}
}

func TestPromptMentionsRemoteDefaultAndNoShellWriteFallback(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "already remote") || !strings.Contains(prompt, "shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandSummaryGetsUsedForModelFacingText(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, _ := json.Marshal(payload)
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %q", stored.Message.Content)
	}
}

func TestWaveRunCommandSummaryGetsUsedForOpenAIResponses(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, _ := json.Marshal(payload)
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if msgs[0].FunctionCallOutput.Output != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestWaveRunCommandResultPayload_HasSummaryForRunningDoneError(t *testing.T) {
	cases := []map[string]any{
		waveRunCommandResultPayload("job-1", nil),
		waveRunCommandResultPayload("job-2", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-2", Status: "done"}),
		waveRunCommandResultPayload("job-3", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-3", Status: "error"}),
	}
	for _, c := range cases {
		if _, ok := c["summary"]; !ok {
			t.Fatalf("missing summary in %#v", c)
		}
	}
}

func TestGenerateTabStateAndTools_AlwaysExposeFileMutationTools(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("missing %s in %#v", name, seen)
		}
	}
}

func TestPromptKeepsRemoteDefaultAndForbidsShellWriteFallback(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "run the command there by default") || !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandModelLeakRegression_UsesSummaryInsteadOfRawJSON(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0).", "durationms": int64(8), "exitcode": 0}
	bytes, _ := json.Marshal(payload)
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if msgs[0].FunctionCallOutput.Output != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestWaveRunCommandChatCompletionsLeakRegression_UsesSummaryInsteadOfRawJSON(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0).", "durationms": int64(8), "exitcode": 0}
	bytes, _ := json.Marshal(payload)
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %q", stored.Message.Content)
	}
}

func TestGenerateTabStateAndTools_FileToolsRemainWhenWidgetAccessFalse(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("missing %s in %#v", name, seen)
		}
	}
}

func TestPromptRestoresRemoteExecutionDefaultAndFileToolPreference(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "current terminal is already remote") || !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandPayloadSummaryExistsAndIsUsedForModels(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done"})
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary field")
	}
}

func TestWaveRunCommandPayloadSummaryKeepsRawUIFields(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "ok"})
	if payload["output"] != "ok" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGenerateTabStateAndTools_AlwaysExposeWriteEditDeleteRegardlessOfWidgetAccess(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("missing %s in %#v", name, seen)
		}
	}
}

func TestPromptRestoresRemoteCurrentTerminalDefaultAndNoShellWriteFallback(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "run the command there by default") || !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandModelFacingResultUsesSummaryNotRawJson(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, _ := json.Marshal(payload)
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if msgs[0].FunctionCallOutput.Output != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestWaveRunCommandChatMessageUsesSummaryNotRawJson(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, _ := json.Marshal(payload)
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %q", stored.Message.Content)
	}
}

func TestGenerateTabStateAndTools_FileToolsAlwaysExposed(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("unexpected tool set: %#v", seen)
	}
}

func TestPromptRestoresBothMissingRules(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "current terminal is already remote") || !strings.Contains(prompt, "Do not fall back to bash heredocs") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandSummaryStopsJsonLeakForModelText(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0).", "durationms": int64(8), "exitcode": 0}
	bytes, _ := json.Marshal(payload)
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %q", stored.Message.Content)
	}
}

func TestGenerateTabStateAndTools_FileMutationToolsNoLongerDependOnWidgetAccess(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("missing %s in %#v", name, seen)
		}
	}
}

func TestPromptRestoresRemoteTerminalDefaultRuleAndFileToolRule(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "run the command there by default") || !strings.Contains(prompt, "shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandSummaryFieldEnablesModelFriendlyResult(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary field")
	}
}

func TestWaveRunCommandSummaryFieldDoesNotBreakUiFields(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "ok"})
	if payload["output"] != "ok" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestGenerateTabStateAndTools_AlwaysExposeWriteEditDeleteToolsRegardlessOfWidgetAccess(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"write_text_file", "edit_text_file", "delete_text_file"} {
		if !seen[name] {
			t.Fatalf("missing %s in %#v", name, seen)
		}
	}
}

func TestPromptRestoresRemoteDefaultRuleAndFileToolRule(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "current terminal is already remote") || !strings.Contains(prompt, "Do not fall back to bash heredocs or shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandSummaryFixesModelFacingJsonLeak(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, _ := json.Marshal(payload)
	msgs, err := openai.ConvertToolResultsToOpenAIChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if msgs[0].FunctionCallOutput.Output != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %#v", msgs[0].FunctionCallOutput.Output)
	}
}

func TestWaveRunCommandSummaryFixesChatCompletionsJsonLeak(t *testing.T) {
	payload := map[string]any{"jobid": "job-123", "status": "done", "summary": "Command completed successfully (exit 0)."}
	bytes, _ := json.Marshal(payload)
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult{{ToolUseID: "call-1", ToolName: "wave_run_command", Text: string(bytes)}})
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	stored := msgs[0].(*openaichat.StoredChatMessage)
	if stored.Message.Content != "Command completed successfully (exit 0)." {
		t.Fatalf("unexpected output: %q", stored.Message.Content)
	}
}

func TestGenerateTabStateAndTools_WriteEditDeleteAlwaysExposed(t *testing.T) {
	_, tools, err := GenerateTabStateAndTools(t.Context(), "", false, nil)
	if err != nil {
		t.Fatalf("GenerateTabStateAndTools returned error: %v", err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		seen[tool.Name] = true
	}
	if !seen["write_text_file"] || !seen["edit_text_file"] || !seen["delete_text_file"] {
		t.Fatalf("unexpected tool set: %#v", seen)
	}
}

func TestPromptRestoresRemoteTerminalAndNoShellWriteFallback(t *testing.T) {
	prompt := strings.Join(getSystemPrompt("gpt-5", false, AgentModeDefault), " ")
	if !strings.Contains(prompt, "already remote") || !strings.Contains(prompt, "shell redirection") {
		t.Fatalf("unexpected prompt: %q", prompt)
	}
}

func TestWaveRunCommandSummaryExistsToAvoidRawJsonLeak(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", nil)
	if _, ok := payload["summary"]; !ok {
		t.Fatal("expected summary field")
	}
}

func TestWaveRunCommandSummaryKeepsUiPayloadFields(t *testing.T) {
	payload := waveRunCommandResultPayload("job-123", &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-123", Status: "done", Output: "ok"})
	if payload["output"] != "ok" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}
func TestEditTextFileDryRunLineEndingFallbackStillRequiresUniqueMatch(t *testing.T) {
	tmpDir := t.TempDir()
	targetFile := filepath.Join(tmpDir, "ambiguous-crlf.txt")
	err := os.WriteFile(targetFile, []byte("x\r\ny\r\nx\r\ny\r\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, _, err = EditTextFileDryRun(map[string]any{
		"filename": targetFile,
		"edits": []map[string]any{
			{
				"old_str": "x\ny\n",
				"new_str": "z\n",
				"desc":    "ambiguous line ending fallback",
			},
		},
	}, "")
	if err == nil {
		t.Fatal("expected ambiguous line-ending fallback to fail")
	}
	if !strings.Contains(err.Error(), "after normalizing line endings") {
		t.Fatalf("expected line-ending normalization error, got %v", err)
	}
}
