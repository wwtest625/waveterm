// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestIsLocalEndpoint(t *testing.T) {
	tests := []struct {
		endpoint string
		want     bool
	}{
		{"", false},
		{"http://localhost:8080", true},
		{"http://127.0.0.1:3000", true},
		{"https://api.openai.com", false},
		{"http://LOCALHOST:9090", true},
		{"http://192.168.1.1:8080", false},
	}
	for _, tc := range tests {
		got := isLocalEndpoint(tc.endpoint)
		if got != tc.want {
			t.Fatalf("isLocalEndpoint(%q) = %v, want %v", tc.endpoint, got, tc.want)
		}
	}
}

func TestGetSystemPromptBuilderMode(t *testing.T) {
	result := getSystemPrompt("gpt-5", true, AgentModeDefault)
	if len(result) != 0 {
		t.Fatalf("expected empty slice in builder mode, got %v", result)
	}
}

func TestGetSystemPromptContainsBasePrompt(t *testing.T) {
	result := getSystemPrompt("gpt-5", false, AgentModeDefault)
	if len(result) < 1 {
		t.Fatalf("expected at least one prompt element, got %d", len(result))
	}
	if !strings.Contains(result[0], "You are") {
		t.Fatalf("expected first prompt element to contain 'You are', got %q", result[0])
	}
}

func TestGetSystemPromptStrictToolAddOn(t *testing.T) {
	models := []string{"mistral-large", "ollama", "qwen", "deepseek-v3"}
	for _, model := range models {
		result := getSystemPrompt(model, false, AgentModeDefault)
		if len(result) != 2 {
			t.Fatalf("model %q: expected 2 prompt elements, got %d", model, len(result))
		}
		if result[1] != SystemPromptText_StrictToolAddOn {
			t.Fatalf("model %q: expected second element to be SystemPromptText_StrictToolAddOn, got %q", model, result[1])
		}
	}
}

func TestGetGlobalRateLimitAndUpdateRateLimit(t *testing.T) {
	cm := NewChatManager()
	info := &uctypes.RateLimitInfo{PReq: 5, ResetEpoch: 9999999999}
	cm.updateRateLimit(info)
	got := cm.getRateLimit()
	if got == nil {
		t.Fatalf("expected non-nil RateLimitInfo, got nil")
	}
	if got.PReq != 5 {
		t.Fatalf("expected PReq=5, got %d", got.PReq)
	}
	if got.ResetEpoch != 9999999999 {
		t.Fatalf("expected ResetEpoch=9999999999, got %d", got.ResetEpoch)
	}
}
