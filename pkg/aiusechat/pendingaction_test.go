// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestPendingActionRegistry_WaitAndResolve(t *testing.T) {
	registry := &PendingActionRegistry{
		requests: make(map[string]*PendingActionRequest),
	}
	registry.Register("action-1", PendingActionRequest{
		Kind:     uctypes.PendingActionToolApproval,
		doneChan: make(chan struct{}),
	})

	done := make(chan PendingActionResult, 1)
	go func() {
		result, err := registry.Wait(context.Background(), "action-1")
		if err != nil {
			t.Errorf("Wait returned error: %v", err)
			return
		}
		done <- result
	}()

	if err := registry.Update("action-1", PendingActionResult{
		Status: uctypes.ApprovalUserApproved,
		Value:  "approved",
	}); err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	select {
	case result := <-done:
		if result.Status != uctypes.ApprovalUserApproved || result.Value != "approved" {
			t.Fatalf("unexpected wait result: %#v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for registry result")
	}
}

func TestPendingActionRegistry_UnregisterCancelsWaiter(t *testing.T) {
	registry := &PendingActionRegistry{
		requests: make(map[string]*PendingActionRequest),
	}
	registry.Register("action-2", PendingActionRequest{
		Kind:     uctypes.PendingActionCommandConfirmation,
		doneChan: make(chan struct{}),
	})

	done := make(chan PendingActionResult, 1)
	go func() {
		result, err := registry.Wait(context.Background(), "action-2")
		if err != nil {
			t.Errorf("Wait returned error: %v", err)
			return
		}
		done <- result
	}()

	registry.Unregister("action-2")

	select {
	case result := <-done:
		if result.Status != uctypes.PendingActionCanceled {
			t.Fatalf("expected canceled result, got %#v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for canceled result")
	}
}
