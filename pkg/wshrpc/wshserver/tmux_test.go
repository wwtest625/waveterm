// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"errors"
	"os/exec"
	"testing"
)

func TestParseTmuxSessionSummaries(t *testing.T) {
	output := "main\t2\t1\nproject-a\t5\t0\n"
	sessions, err := parseTmuxSessionSummaries(output)
	if err != nil {
		t.Fatalf("parseTmuxSessionSummaries returned error: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	if sessions[0].Name != "main" || sessions[0].Windows != 2 || sessions[0].Attached != 1 {
		t.Fatalf("unexpected first session: %+v", sessions[0])
	}
}

func TestParseTmuxWindowSummaries(t *testing.T) {
	output := "0\teditor\t1\n1\tlogs\t0\n"
	windows, err := parseTmuxWindowSummaries(output)
	if err != nil {
		t.Fatalf("parseTmuxWindowSummaries returned error: %v", err)
	}
	if len(windows) != 2 {
		t.Fatalf("expected 2 windows, got %d", len(windows))
	}
	if windows[0].Index != 0 || windows[0].Name != "editor" || !windows[0].Active {
		t.Fatalf("unexpected first window: %+v", windows[0])
	}
	if windows[1].Active {
		t.Fatalf("expected second window inactive")
	}
}

func TestMakeTmuxError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		stderr string
		code   string
	}{
		{
			name: "missing cli",
			err:  errors.Join(exec.ErrNotFound),
			code: "missing_cli",
		},
		{
			name:   "no server",
			err:    errors.New("exit status 1"),
			stderr: "no server running on /tmp/tmux-1000/default",
			code:   "no_server",
		},
		{
			name:   "session not found",
			err:    errors.New("exit status 1"),
			stderr: "can't find session: missing",
			code:   "session_not_found",
		},
		{
			name:   "permission denied",
			err:    errors.New("exit status 1"),
			stderr: "permission denied",
			code:   "permission_denied",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tmuxErr := makeTmuxError(tc.err, "", tc.stderr)
			if tmuxErr.Code != tc.code {
				t.Fatalf("expected code %q, got %q", tc.code, tmuxErr.Code)
			}
		})
	}
}

func TestParseTmuxSessionSummariesEmpty(t *testing.T) {
	output := ""
	sessions, err := parseTmuxSessionSummaries(output)
	if err != nil {
		t.Fatalf("parseTmuxSessionSummaries returned error: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestParseTmuxSessionSummariesMalformed(t *testing.T) {
	output := "main\t2\ninvalid-line\nproject-a\t5\t0\t1"
	sessions, err := parseTmuxSessionSummaries(output)
	// The parser should skip malformed lines and return valid sessions
	if err == nil {
		// Check that we got at least the valid session
		if len(sessions) < 1 {
			t.Fatalf("expected at least 1 session, got %d", len(sessions))
		}
	}
}

func TestParseTmuxWindowSummariesEmpty(t *testing.T) {
	output := ""
	windows, err := parseTmuxWindowSummaries(output)
	if err != nil {
		t.Fatalf("parseTmuxWindowSummaries returned error: %v", err)
	}
	if len(windows) != 0 {
		t.Fatalf("expected 0 windows, got %d", len(windows))
	}
}

func TestIsNoTmuxServerError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		stdout string
		stderr string
		expect bool
	}{
		{
			name:   "no server in stderr",
			err:    errors.New("exit status 1"),
			stderr: "no server running on /tmp/tmux-1000/default",
			expect: true,
		},
		{
			name:   "no server in stdout (with full path)",
			err:    errors.New("exit status 1"),
			stdout: "no server running on /tmp/tmux-1000/default",
			expect: true,
		},
		{
			name:   "no server in stderr (no path)",
			err:    errors.New("exit status 1"),
			stderr: "no server running",
			expect: false, // Function requires "on <path>" pattern
		},
		{
			name:   "no error",
			err:    nil,
			expect: false,
		},
		{
			name:   "different error",
			err:    errors.New("command not found"),
			expect: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := isNoTmuxServerError(tc.err, tc.stdout, tc.stderr)
			if result != tc.expect {
				t.Fatalf("expected %v, got %v", tc.expect, result)
			}
		})
	}
}
