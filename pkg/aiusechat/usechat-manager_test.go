// Copyright 2025, Command Plane Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestNewChatManager(t *testing.T) {
	cm := NewChatManager()
	if cm == nil {
		t.Fatalf("NewChatManager() returned nil")
	}
	if cm.rateLimitInfo == nil {
		t.Fatalf("rateLimitInfo is nil")
	}
	if !cm.rateLimitInfo.Unknown {
		t.Errorf("rateLimitInfo.Unknown = %v, want true", cm.rateLimitInfo.Unknown)
	}
	if cm.activeChats == nil {
		t.Fatalf("activeChats is nil")
	}
	if cm.tuiAutoCancelledJobs == nil {
		t.Fatalf("tuiAutoCancelledJobs is nil")
	}
	if len(cm.tuiAutoCancelledJobs) != 0 {
		t.Errorf("tuiAutoCancelledJobs len = %d, want 0", len(cm.tuiAutoCancelledJobs))
	}
	if cm.commandPollers == nil {
		t.Fatalf("commandPollers is nil")
	}
	if len(cm.commandPollers) != 0 {
		t.Errorf("commandPollers len = %d, want 0", len(cm.commandPollers))
	}
	if cm.commandJobs == nil {
		t.Fatalf("commandJobs is nil")
	}
	if len(cm.commandJobs) != 0 {
		t.Errorf("commandJobs len = %d, want 0", len(cm.commandJobs))
	}
}

func TestRememberAndLookupCommandJob(t *testing.T) {
	cm := NewChatManager()

	// Remember a job and look it up.
	cm.rememberCommandJob("job-1", "ls -la")
	got := cm.lookupCommandJob("job-1")
	if got != "ls -la" {
		t.Errorf("lookupCommandJob(\"job-1\") = %q, want %q", got, "ls -la")
	}

	// Lookup a non-existent job.
	got = cm.lookupCommandJob("job-2")
	if got != "" {
		t.Errorf("lookupCommandJob(\"job-2\") = %q, want %q", got, "")
	}

	// Remember with empty commandText should delete the entry.
	cm.rememberCommandJob("job-1", "")
	got = cm.lookupCommandJob("job-1")
	if got != "" {
		t.Errorf("lookupCommandJob(\"job-1\") after delete = %q, want %q", got, "")
	}
}

func TestCleanupCommandJobsLocked(t *testing.T) {
	cm := NewChatManager()
	now := time.Now()

	// Add old jobs (older than retention) and recent jobs.
	oldTime := now.Add(-2 * waveCommandJobRetention)
	recentTime := now.Add(-10 * time.Minute)

	cm.commandJobMu.Lock()
	cm.commandJobs["old-job-1"] = waveCommandJobEntry{commandText: "echo old1", updatedAt: oldTime}
	cm.commandJobs["old-job-2"] = waveCommandJobEntry{commandText: "echo old2", updatedAt: oldTime}
	cm.commandJobs["recent-job-1"] = waveCommandJobEntry{commandText: "echo recent1", updatedAt: recentTime}
	cm.commandJobs["recent-job-2"] = waveCommandJobEntry{commandText: "echo recent2", updatedAt: recentTime}
	cm.cleanupCommandJobsLocked(now)
	cm.commandJobMu.Unlock()

	// Old jobs should be removed, recent ones should survive.
	if _, ok := cm.commandJobs["old-job-1"]; ok {
		t.Errorf("old-job-1 should have been cleaned up")
	}
	if _, ok := cm.commandJobs["old-job-2"]; ok {
		t.Errorf("old-job-2 should have been cleaned up")
	}
	if _, ok := cm.commandJobs["recent-job-1"]; !ok {
		t.Errorf("recent-job-1 should still exist")
	}
	if _, ok := cm.commandJobs["recent-job-2"]; !ok {
		t.Errorf("recent-job-2 should still exist")
	}
}

func TestUpdateAndGetRateLimit(t *testing.T) {
	cm := NewChatManager()

	// Update with a valid RateLimitInfo.
	info := &uctypes.RateLimitInfo{
		PReq:       10,
		PReqLimit:  50,
		ResetEpoch: 12345,
	}
	cm.updateRateLimit(info)

	got := cm.getRateLimit()
	if got.PReq != 10 {
		t.Errorf("getRateLimit().PReq = %d, want 10", got.PReq)
	}
	if got.ResetEpoch != 12345 {
		t.Errorf("getRateLimit().ResetEpoch = %d, want 12345", got.ResetEpoch)
	}

	// Update with nil should be a no-op.
	cm.updateRateLimit(nil)
	got2 := cm.getRateLimit()
	if got2.PReq != 10 {
		t.Errorf("getRateLimit() after nil update: PReq = %d, want 10", got2.PReq)
	}
	if got2.ResetEpoch != 12345 {
		t.Errorf("getRateLimit() after nil update: ResetEpoch = %d, want 12345", got2.ResetEpoch)
	}
}

func TestLookupWaveCommandJob(t *testing.T) {
	// Test the package-level wrapper functions using defaultChatManager.
	jobID := "test-wave-job-1"
	commandText := "cat /etc/hosts"

	rememberWaveCommandJob(jobID, commandText)
	got := lookupWaveCommandJob(jobID)
	if got != commandText {
		t.Errorf("lookupWaveCommandJob(%q) = %q, want %q", jobID, got, commandText)
	}

	// Lookup non-existent job.
	got = lookupWaveCommandJob("nonexistent-wave-job")
	if got != "" {
		t.Errorf("lookupWaveCommandJob(\"nonexistent-wave-job\") = %q, want %q", got, "")
	}

	// Delete by remembering empty command.
	rememberWaveCommandJob(jobID, "")
	got = lookupWaveCommandJob(jobID)
	if got != "" {
		t.Errorf("lookupWaveCommandJob(%q) after delete = %q, want %q", jobID, got, "")
	}
}
