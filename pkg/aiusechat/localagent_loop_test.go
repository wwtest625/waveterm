// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type testSSERecorder struct {
	*httptest.ResponseRecorder
}

func (r *testSSERecorder) SetWriteDeadline(time.Time) error {
	return nil
}

func TestLocalAgentLoop_ReadInjectWaitRead(t *testing.T) {
	origRunner := runLocalAgentCommandFn
	t.Cleanup(func() {
		runLocalAgentCommandFn = origRunner
	})

	runLocalAgentCommandFn = func(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
		onPhase(localAgentLoopPhase{ToolName: "wave_read_current_terminal_context", StatusLine: "Reading terminal context"})
		onPhase(localAgentLoopPhase{ToolName: "wave_inject_terminal_command", StatusLine: "Injecting command"})
		onPhase(localAgentLoopPhase{ToolName: "wave_wait_terminal_idle", StatusLine: "Waiting for terminal idle"})
		onPhase(localAgentLoopPhase{ToolName: "wave_read_terminal_scrollback", StatusLine: "Reading terminal output"})
		onDelta("loop complete")
		return "loop complete", nil
	}

	recorder := &testSSERecorder{ResponseRecorder: httptest.NewRecorder()}
	sseHandler := sse.MakeSSEHandlerCh(recorder, context.Background())
	req := &PostMessageRequest{
		ChatID:        "test-localagent-loop",
		LocalProvider: LocalProviderCodex,
		Msg: uctypes.AIMessage{
			MessageId: "msg-localagent-loop",
			Parts: []uctypes.AIMessagePart{
				{Type: uctypes.AIMessagePartTypeText, Text: "run pwd and tell me what happened"},
			},
		},
	}
	chatOpts := uctypes.WaveChatOpts{
		AgentMode: "default",
		Config: uctypes.AIOptsType{
			APIType: "openai-chat",
			Model:   "local-codex",
		},
	}

	if err := WaveAILocalAgentPostMessageWrap(context.Background(), sseHandler, req, chatOpts); err != nil {
		t.Fatalf("WaveAILocalAgentPostMessageWrap() error: %v", err)
	}
	sseHandler.Close()

	body := recorder.Body.String()
	expectedOrder := []string{
		`"toolname":"wave_read_current_terminal_context"`,
		`"toolname":"wave_inject_terminal_command"`,
		`"toolname":"wave_wait_terminal_idle"`,
		`"toolname":"wave_read_terminal_scrollback"`,
	}
	lastIdx := -1
	for _, marker := range expectedOrder {
		idx := strings.Index(body, marker)
		if idx == -1 {
			t.Fatalf("expected SSE body to contain %s, got:\n%s", marker, body)
		}
		if idx <= lastIdx {
			t.Fatalf("expected %s after previous loop phase, got:\n%s", marker, body)
		}
		lastIdx = idx
	}
	if !strings.Contains(body, `"type":"data-toolprogress"`) {
		t.Fatalf("expected loop phases to be emitted as data-toolprogress events, got:\n%s", body)
	}
	if !strings.Contains(body, `"type":"text-delta"`) || !strings.Contains(body, `"delta":"loop complete"`) {
		t.Fatalf("expected final assistant text delta, got:\n%s", body)
	}
}
