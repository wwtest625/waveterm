// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"strings"
	"testing"
)

func TestBuildTerminalCommandResult_UsesNewOutputSinceOffset(t *testing.T) {
	oldOutput := "prompt> pwd\n/old/path\n"
	newOutput := "prompt> git status\nOn branch main\nnothing to commit\n"
	combined := oldOutput + newOutput
	startOffset := int64(len(oldOutput))

	result := buildTerminalCommandResultData(
		"tab-1",
		"block-1",
		"git status",
		"completed",
		nil,
		startOffset,
		startOffset,
		int64(len(combined)),
		[]byte(combined[startOffset:]),
		false,
		defaultTerminalTailLines,
	)
	if result == nil {
		t.Fatalf("expected command result data")
	}
	if result.CaptureStatus != "ready" {
		t.Fatalf("expected capture status ready, got %q", result.CaptureStatus)
	}
	if result.ReadOffset != startOffset {
		t.Fatalf("expected read offset %d, got %d", startOffset, result.ReadOffset)
	}
	if result.StartOffset != startOffset {
		t.Fatalf("expected start offset %d, got %d", startOffset, result.StartOffset)
	}
	if strings.Contains(result.Text, "/old/path") {
		t.Fatalf("expected old output to be excluded, got %q", result.Text)
	}
	if !strings.Contains(result.Text, "On branch main") {
		t.Fatalf("expected command result text to include new output, got %q", result.Text)
	}
	if len(result.Lines) != 3 {
		t.Fatalf("expected 3 output lines, got %d (%v)", len(result.Lines), result.Lines)
	}
}
