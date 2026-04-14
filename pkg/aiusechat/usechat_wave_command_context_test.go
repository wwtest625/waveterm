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
	waveCommandJobContext.mu.Lock()
	defer waveCommandJobContext.mu.Unlock()
	waveCommandJobContext.commands = make(map[string]waveCommandJobEntry)
}

func TestRememberAndLookupWaveCommandJob(t *testing.T) {
	resetWaveCommandJobContextForTest()
	rememberWaveCommandJob("job-1", "ls -la")
	if got := lookupWaveCommandJob("job-1"); got != "ls -la" {
		t.Fatalf("unexpected command text: got %q", got)
	}
}

func TestLookupWaveCommandJob_ExpiredEntry(t *testing.T) {
	resetWaveCommandJobContextForTest()
	waveCommandJobContext.mu.Lock()
	waveCommandJobContext.commands["job-expired"] = waveCommandJobEntry{
		commandText: "echo hello",
		updatedAt:   time.Now().Add(-(waveCommandJobRetention + time.Minute)),
	}
	waveCommandJobContext.mu.Unlock()
	if got := lookupWaveCommandJob("job-expired"); got != "" {
		t.Fatalf("expected expired entry to be dropped, got %q", got)
	}
	waveCommandJobContext.mu.Lock()
	_, exists := waveCommandJobContext.commands["job-expired"]
	waveCommandJobContext.mu.Unlock()
	if exists {
		t.Fatal("expired entry should be removed from context map")
	}
}

func TestCleanupWaveCommandJobsLocked_EnforcesMaxCount(t *testing.T) {
	resetWaveCommandJobContextForTest()
	waveCommandJobContext.mu.Lock()
	base := time.Now().Add(-30 * time.Minute)
	for i := 0; i < waveCommandJobMaxCount+10; i++ {
		jobID := fmt.Sprintf("job-%04d", i)
		waveCommandJobContext.commands[jobID] = waveCommandJobEntry{
			commandText: jobID,
			updatedAt:   base.Add(time.Duration(i) * time.Second),
		}
	}
	cleanupWaveCommandJobsLocked(time.Now())
	currentCount := len(waveCommandJobContext.commands)
	waveCommandJobContext.mu.Unlock()
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
