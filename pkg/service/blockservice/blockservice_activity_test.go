// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestActivity_UserRecentlyActiveWindow(t *testing.T) {
	now := time.Unix(1700000000, 0)
	rtInfo := &waveobj.ObjRTInfo{
		TermLastUserInputTs: now.Add(-2 * time.Second).UnixMilli(),
	}

	state := buildTerminalUserActivityState("tab-1", "block-1", rtInfo, now)
	if state == nil {
		t.Fatalf("expected user activity state")
	}
	if !state.IsUserActive {
		t.Fatalf("expected user activity to be considered active")
	}
	if state.LastActivityTs != rtInfo.TermLastUserInputTs {
		t.Fatalf("expected last activity ts %d, got %d", rtInfo.TermLastUserInputTs, state.LastActivityTs)
	}
}

func TestActivity_InjectTerminalCommandBlockedWhenRecentlyActive(t *testing.T) {
	now := time.Unix(1700000000, 0)
	rtInfo := &waveobj.ObjRTInfo{
		TermLastUserInputTs: now.Add(-3 * time.Second).UnixMilli(),
	}

	err := validateTerminalInjectAllowed(rtInfo, false, now)
	if err == nil {
		t.Fatalf("expected recent user activity to block terminal injection")
	}
	if !strings.Contains(err.Error(), "user is currently typing") {
		t.Fatalf("expected typing error, got %v", err)
	}
}

func TestActivity_InjectTerminalCommandAllowsForceOverride(t *testing.T) {
	now := time.Unix(1700000000, 0)
	rtInfo := &waveobj.ObjRTInfo{
		TermLastUserInputTs: now.Add(-1 * time.Second).UnixMilli(),
	}

	if err := validateTerminalInjectAllowed(rtInfo, true, now); err != nil {
		t.Fatalf("expected force override to bypass activity protection, got %v", err)
	}
}
