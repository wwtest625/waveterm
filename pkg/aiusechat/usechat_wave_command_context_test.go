// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func resetWaveCommandJobContextForTest() {
	defaultChatManager.commandJobMu.Lock()
	defer defaultChatManager.commandJobMu.Unlock()
	defaultChatManager.commandJobs = make(map[string]waveCommandJobEntry)
}

func TestRememberAndLookupWaveCommandJob(t *testing.T) {
	resetWaveCommandJobContextForTest()
	defaultChatManager.rememberCommandJob("job-1", "ls -la")
	if got := defaultChatManager.lookupCommandJob("job-1"); got != "ls -la" {
		t.Fatalf("unexpected command text: got %q", got)
	}
}

func TestLookupWaveCommandJob_ExpiredEntry(t *testing.T) {
	resetWaveCommandJobContextForTest()
	defaultChatManager.commandJobMu.Lock()
	defaultChatManager.commandJobs["job-expired"] = waveCommandJobEntry{
		commandText: "echo hello",
		updatedAt:   time.Now().Add(-(waveCommandJobRetention + time.Minute)),
	}
	defaultChatManager.commandJobMu.Unlock()
	if got := defaultChatManager.lookupCommandJob("job-expired"); got != "" {
		t.Fatalf("expected expired entry to be dropped, got %q", got)
	}
	defaultChatManager.commandJobMu.Lock()
	_, exists := defaultChatManager.commandJobs["job-expired"]
	defaultChatManager.commandJobMu.Unlock()
	if exists {
		t.Fatal("expired entry should be removed from context map")
	}
}

func TestCleanupWaveCommandJobsLocked_EnforcesMaxCount(t *testing.T) {
	resetWaveCommandJobContextForTest()
	defaultChatManager.commandJobMu.Lock()
	base := time.Now().Add(-30 * time.Minute)
	for i := 0; i < waveCommandJobMaxCount+10; i++ {
		jobID := fmt.Sprintf("job-%04d", i)
		defaultChatManager.commandJobs[jobID] = waveCommandJobEntry{
			commandText: jobID,
			updatedAt:   base.Add(time.Duration(i) * time.Second),
		}
	}
	defaultChatManager.cleanupCommandJobsLocked(time.Now())
	currentCount := len(defaultChatManager.commandJobs)
	defaultChatManager.commandJobMu.Unlock()
	if currentCount > waveCommandJobMaxCount {
		t.Fatalf("context map should be capped at %d, got %d", waveCommandJobMaxCount, currentCount)
	}
}

func TestMergeWaveCommandOutputText_AppendsAndKeepsTail(t *testing.T) {
	existing := strings.Repeat("a", maxToolOutputTextLen-4)
	merged := mergeWaveCommandOutputText(existing, "bcdef")
	if len(merged) != maxToolOutputTextLen {
		t.Fatalf("expected capped merged output length %d, got %d", maxToolOutputTextLen, len(merged))
	}
	if !strings.HasSuffix(merged, "bcdef") {
		t.Fatalf("expected merged output to keep newest tail, got suffix %q", merged[len(merged)-5:])
	}
}

func TestNextWaveCommandPollInterval_CapsAtMax(t *testing.T) {
	interval := waveCommandPollFastInterval
	for i := 0; i < 10; i++ {
		interval = nextWaveCommandPollInterval(interval)
	}
	if interval != waveCommandPollMaxInterval {
		t.Fatalf("expected poll interval to cap at %s, got %s", waveCommandPollMaxInterval, interval)
	}
}
