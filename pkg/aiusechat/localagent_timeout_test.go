// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"
	"time"
)

func TestGetLocalAgentIdleTimeout_DefaultsByProvider(t *testing.T) {
	t.Setenv(localAgentIdleEnvName, "")
	t.Setenv(localAgentTimeoutEnvName, "")

	overallTimeout := getLocalAgentTimeout()
	if overallTimeout != defaultLocalAgentTimeoutMs*time.Millisecond {
		t.Fatalf("expected default overall timeout %s, got %s", defaultLocalAgentTimeoutMs*time.Millisecond, overallTimeout)
	}

	gotCodex := getLocalAgentIdleTimeout(LocalProviderCodex, overallTimeout)
	if gotCodex != overallTimeout {
		t.Fatalf("expected codex idle timeout to match overall timeout %s, got %s", overallTimeout, gotCodex)
	}

	gotClaude := getLocalAgentIdleTimeout(LocalProviderClaudeCode, overallTimeout)
	wantClaude := defaultLocalAgentIdleMs * time.Millisecond
	if gotClaude != wantClaude {
		t.Fatalf("expected claude idle timeout %s, got %s", wantClaude, gotClaude)
	}
}

func TestGetLocalAgentIdleTimeout_EnvOverride(t *testing.T) {
	t.Setenv(localAgentIdleEnvName, "45000")
	t.Setenv(localAgentTimeoutEnvName, "")

	overallTimeout := getLocalAgentTimeout()
	want := 45 * time.Second

	gotCodex := getLocalAgentIdleTimeout(LocalProviderCodex, overallTimeout)
	if gotCodex != want {
		t.Fatalf("expected codex idle timeout override %s, got %s", want, gotCodex)
	}

	gotClaude := getLocalAgentIdleTimeout(LocalProviderClaudeCode, overallTimeout)
	if gotClaude != want {
		t.Fatalf("expected claude idle timeout override %s, got %s", want, gotClaude)
	}
}

func TestGetLocalAgentIdleTimeout_InvalidEnvFallsBack(t *testing.T) {
	t.Setenv(localAgentIdleEnvName, "not-a-number")
	t.Setenv(localAgentTimeoutEnvName, "240000")

	overallTimeout := getLocalAgentTimeout()
	if overallTimeout != 240*time.Second {
		t.Fatalf("expected overridden overall timeout 240s, got %s", overallTimeout)
	}

	gotCodex := getLocalAgentIdleTimeout(LocalProviderCodex, overallTimeout)
	if gotCodex != overallTimeout {
		t.Fatalf("expected codex idle timeout fallback to overall timeout %s, got %s", overallTimeout, gotCodex)
	}

	gotClaude := getLocalAgentIdleTimeout(LocalProviderClaudeCode, overallTimeout)
	wantClaude := defaultLocalAgentIdleMs * time.Millisecond
	if gotClaude != wantClaude {
		t.Fatalf("expected claude idle timeout fallback %s, got %s", wantClaude, gotClaude)
	}
}

func TestShouldUseCodexAppServer_DefaultsEnabled(t *testing.T) {
	t.Setenv(localCodexUseAppServerEnvName, "")
	if !shouldUseCodexAppServer() {
		t.Fatalf("expected codex app-server to be enabled by default")
	}
	t.Setenv(localCodexUseAppServerEnvName, "0")
	if shouldUseCodexAppServer() {
		t.Fatalf("expected codex app-server env override to disable app-server")
	}
}
