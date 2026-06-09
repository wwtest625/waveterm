// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
	"time"
)

func TestMergeWaveCommandOutputText(t *testing.T) {
	// merge("", "hello") → "hello"
	if got := mergeWaveCommandOutputText("", "hello"); got != "hello" {
		t.Fatalf("merge empty + hello: got %q, want %q", got, "hello")
	}

	// merge("hello", " world") → "hello world"
	if got := mergeWaveCommandOutputText("hello", " world"); got != "hello world" {
		t.Fatalf("merge hello + world: got %q, want %q", got, "hello world")
	}

	// merge existing + chunk that exceeds maxToolOutputTextLen → truncated from front (keep tail)
	existing := strings.Repeat("x", maxToolOutputTextLen-100)
	chunk := strings.Repeat("y", 200)
	merged := mergeWaveCommandOutputText(existing, chunk)
	if len(merged) != maxToolOutputTextLen {
		t.Fatalf("truncated length: got %d, want %d", len(merged), maxToolOutputTextLen)
	}
	if !strings.HasSuffix(merged, chunk) {
		t.Fatalf("truncated output should keep newest tail; suffix got %q", merged[len(merged)-10:])
	}
}

func TestNextWaveCommandPollInterval(t *testing.T) {
	// nextWaveCommandPollInterval(0) → waveCommandPollFastInterval (50ms)
	if got := nextWaveCommandPollInterval(0); got != waveCommandPollFastInterval {
		t.Fatalf("interval(0): got %s, want %s", got, waveCommandPollFastInterval)
	}

	// nextWaveCommandPollInterval(50ms) → 100ms
	if got := nextWaveCommandPollInterval(50 * time.Millisecond); got != 100*time.Millisecond {
		t.Fatalf("interval(50ms): got %s, want %s", got, 100*time.Millisecond)
	}

	// nextWaveCommandPollInterval(1s) → 2s (waveCommandPollMaxInterval)
	if got := nextWaveCommandPollInterval(1 * time.Second); got != waveCommandPollMaxInterval {
		t.Fatalf("interval(1s): got %s, want %s", got, waveCommandPollMaxInterval)
	}

	// nextWaveCommandPollInterval(2s) → 2s (capped at max)
	if got := nextWaveCommandPollInterval(2 * time.Second); got != waveCommandPollMaxInterval {
		t.Fatalf("interval(2s): got %s, want %s", got, waveCommandPollMaxInterval)
	}

	// nextWaveCommandPollInterval(5s) → 2s (capped at max)
	if got := nextWaveCommandPollInterval(5 * time.Second); got != waveCommandPollMaxInterval {
		t.Fatalf("interval(5s): got %s, want %s", got, waveCommandPollMaxInterval)
	}
}
