// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestTerminalStatus_EmptyAndRunning(t *testing.T) {
	controllerStatus := &blockcontroller.BlockControllerRuntimeStatus{
		ShellProcStatus: blockcontroller.Status_Running,
	}

	empty := buildTerminalCommandStatusData("tab-1", "block-1", controllerStatus, nil)
	if empty == nil {
		t.Fatalf("expected status data")
	}
	if empty.Status != "idle" {
		t.Fatalf("expected idle status for empty shell info, got %q", empty.Status)
	}
	if empty.LastCommand != "" {
		t.Fatalf("expected empty last command, got %q", empty.LastCommand)
	}
	if empty.ExitCode != nil {
		t.Fatalf("expected nil exit code for empty shell info")
	}

	running := buildTerminalCommandStatusData("tab-1", "block-1", controllerStatus, &waveobj.ObjRTInfo{
		ShellIntegration: true,
		ShellState:       "running-command",
		ShellLastCmd:     "sleep 5",
	})
	if running == nil {
		t.Fatalf("expected running status data")
	}
	if running.Status != "running" {
		t.Fatalf("expected running status, got %q", running.Status)
	}
	if running.LastCommand != "sleep 5" {
		t.Fatalf("expected last command sleep 5, got %q", running.LastCommand)
	}
	if running.ExitCode != nil {
		t.Fatalf("expected nil exit code while command is running")
	}
}

func TestTerminalStatus_RequiresTabID(t *testing.T) {
	bs := &BlockService{}
	_, err := bs.GetTerminalCommandStatus(context.Background(), "", "")
	if err == nil {
		t.Fatalf("expected error when tabId is empty")
	}
	if err.Error() != "tabId is required" {
		t.Fatalf("unexpected error: %v", err)
	}
}
