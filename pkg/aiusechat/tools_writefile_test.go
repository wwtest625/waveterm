// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"runtime"
	"strings"
	"testing"
)

func TestResolveAndValidateLocalAbsolutePath_RelativeRejected(t *testing.T) {
	_, err := resolveAndValidateLocalAbsolutePath("notes/output.txt")
	if err == nil {
		t.Fatalf("expected relative path to be rejected")
	}
	if !strings.Contains(err.Error(), "path must be absolute") {
		t.Fatalf("expected absolute-path validation error, got %q", err.Error())
	}
}

func TestResolveAndValidateLocalAbsolutePath_PosixPathHintOnWindows(t *testing.T) {
	_, err := resolveAndValidateLocalAbsolutePath("/home/ssl/verification.txt")
	if runtime.GOOS == "windows" {
		if err == nil {
			t.Fatalf("expected linux absolute path to be rejected on windows")
		}
		if !strings.Contains(err.Error(), "looks like a Linux absolute path") {
			t.Fatalf("expected linux path hint error, got %q", err.Error())
		}
		return
	}
	if err != nil {
		t.Fatalf("expected posix absolute path to pass on %s, got %v", runtime.GOOS, err)
	}
}

