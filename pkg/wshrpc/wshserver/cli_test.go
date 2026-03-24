// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import "testing"

func TestBuildShellCommand(t *testing.T) {
	cmd := buildShellCommand("tmux", []string{"new-window", "name with space", `$HOME`, `say "hi"`})
	expected := `tmux new-window "name with space" "\$HOME" "say \"hi\""`
	if cmd != expected {
		t.Fatalf("expected %q, got %q", expected, cmd)
	}
}
