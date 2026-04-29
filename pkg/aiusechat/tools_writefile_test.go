// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
)

func TestRequireRemoteFileTarget_RelativeRejected(t *testing.T) {
	_, err := requireRemoteFileTarget("notes/output.txt", nil)
	if err == nil {
		t.Fatalf("expected relative path to be rejected")
	}
	if !strings.Contains(err.Error(), "Linux absolute paths") {
		t.Fatalf("expected remote absolute-path validation error, got %q", err.Error())
	}
}

func TestRequireRemoteFileTarget_AbsolutePathNeedsRemoteContext(t *testing.T) {
	_, err := requireRemoteFileTarget("/home/ssl/verification.txt", nil)
	if err == nil {
		t.Fatalf("expected remote context requirement for linux absolute path")
	}
	if !strings.Contains(err.Error(), "current remote terminal connection") {
		t.Fatalf("expected remote-target resolution error, got %q", err.Error())
	}
}

func TestRemoteFileToolDefinitionsMentionRemoteLinuxPaths(t *testing.T) {
	writeDesc := GetWriteTextFileToolDefinition().Description
	if !strings.Contains(writeDesc, "Only Linux absolute paths are supported") {
		t.Fatalf("expected write_text_file description to mention remote Linux paths, got %q", writeDesc)
	}

	editDesc := GetEditTextFileToolDefinition().Description
	if !strings.Contains(editDesc, "Only Linux absolute paths are supported") {
		t.Fatalf("expected edit_text_file description to mention remote Linux paths, got %q", editDesc)
	}

	deleteDesc := GetDeleteTextFileToolDefinition().Description
	if !strings.Contains(deleteDesc, "Only Linux absolute paths are supported") {
		t.Fatalf("expected delete_text_file description to mention remote Linux paths, got %q", deleteDesc)
	}

	readDesc := GetReadTextFileToolDefinition().Description
	if !strings.Contains(readDesc, "Only Linux absolute paths are supported") {
		t.Fatalf("expected read_text_file description to mention remote Linux paths, got %q", readDesc)
	}
}
