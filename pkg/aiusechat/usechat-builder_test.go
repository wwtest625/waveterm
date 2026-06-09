// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"
)

func TestStaticFileInfoFields(t *testing.T) {
	info := StaticFileInfo{
		Name:         "static/main.js",
		Size:         1024,
		Modified:     "2025-01-01",
		ModifiedTime: "2025-01-01T00:00:00Z",
	}

	if info.Name != "static/main.js" {
		t.Fatalf("expected Name=%q, got %q", "static/main.js", info.Name)
	}
	if info.Size != 1024 {
		t.Fatalf("expected Size=1024, got %d", info.Size)
	}
	if info.Modified != "2025-01-01" {
		t.Fatalf("expected Modified=%q, got %q", "2025-01-01", info.Modified)
	}
	if info.ModifiedTime != "2025-01-01T00:00:00Z" {
		t.Fatalf("expected ModifiedTime=%q, got %q", "2025-01-01T00:00:00Z", info.ModifiedTime)
	}
}

func TestCreateWriteTextFileDiffMissingChat(t *testing.T) {
	_, _, err := CreateWriteTextFileDiff(nil, "nonexistent-chat-id", "some-toolcall-id")
	if err == nil {
		t.Fatal("expected error for missing chat, got nil")
	}
}
