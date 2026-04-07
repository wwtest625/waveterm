// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

func TestReadTextFileCallbackReadsRequestedRangeFromStart(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "sample.txt")
	err := os.WriteFile(testFile, []byte("line1\nline2\nline3\nline4\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := readTextFileCallback(map[string]any{
		"filename": testFile,
		"offset":   1,
		"count":    2,
	}, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("readTextFileCallback returned error: %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("expected map result, got %T", result)
	}
	if resultMap["data"] != "line2\nline3" {
		t.Fatalf("expected line2/line3 slice, got %#v", resultMap["data"])
	}
}

func TestReadTextFileCallbackReadsRequestedRangeFromEnd(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "tail.txt")
	err := os.WriteFile(testFile, []byte("line1\nline2\nline3\nline4\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := readTextFileCallback(map[string]any{
		"filename": testFile,
		"origin":   "end",
		"count":    2,
	}, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("readTextFileCallback returned error: %v", err)
	}

	resultMap := result.(map[string]any)
	if resultMap["data"] != "line3\nline4" {
		t.Fatalf("expected last two lines, got %#v", resultMap["data"])
	}
}

func TestReadTextFileCallbackRejectsRelativePath(t *testing.T) {
	_, err := readTextFileCallback(map[string]any{
		"filename": "relative.txt",
	}, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatal("expected relative path to fail")
	}
	if !strings.Contains(err.Error(), "path must be absolute") {
		t.Fatalf("expected absolute path error, got %v", err)
	}
}

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
