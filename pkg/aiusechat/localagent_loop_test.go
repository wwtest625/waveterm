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

func TestLocalAgentLoop_EmitsCommandExecutionProgress(t *testing.T) {
	origRunner := runLocalAgentCommandFn
	t.Cleanup(func() {
		runLocalAgentCommandFn = origRunner
	})

	runLocalAgentCommandFn = func(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
		onPhase(localAgentLoopPhase{ToolName: "codex_command_execution", StatusLine: "lscpu"})
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
		`"toolname":"codex_command_execution"`,
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

func TestLocalAgentLoop_RetriesWhenAgentClaimsHostPolicyButNoTerminalToolWasUsed(t *testing.T) {
	origRunner := runLocalAgentCommandFn
	t.Cleanup(func() {
		runLocalAgentCommandFn = origRunner
	})

	callCount := 0
	runLocalAgentCommandFn = func(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
		callCount++
		if callCount == 1 {
			return "当前我这边对终端的系统查询命令被宿主策略直接拦了。", nil
		}
		if !strings.Contains(prompt, "You must execute real terminal commands (prefer wsh) on this retry") {
			t.Fatalf("expected retry prompt to require real command execution, got:\n%s", prompt)
		}
		onPhase(localAgentLoopPhase{ToolName: "codex_command_execution", StatusLine: "lscpu"})
		onDelta("CPU result")
		return "CPU result", nil
	}

	recorder := &testSSERecorder{ResponseRecorder: httptest.NewRecorder()}
	sseHandler := sse.MakeSSEHandlerCh(recorder, context.Background())
	req := &PostMessageRequest{
		ChatID:        "test-localagent-retry",
		LocalProvider: LocalProviderCodex,
		Msg: uctypes.AIMessage{
			MessageId: "msg-localagent-retry",
			Parts: []uctypes.AIMessagePart{
				{Type: uctypes.AIMessagePartTypeText, Text: "帮我查询cpu 型号 频率 温度 整理成表格给我"},
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
	if callCount != 2 {
		t.Fatalf("expected local agent retry, got %d calls", callCount)
	}
	if !strings.Contains(body, `"toolname":"codex_command_execution"`) {
		t.Fatalf("expected retry path to emit command execution usage, got:\n%s", body)
	}
	if strings.Contains(body, "宿主策略直接拦了") && !strings.Contains(body, "CPU result") {
		t.Fatalf("expected retry result to replace first bogus refusal, got:\n%s", body)
	}
}

func TestLocalAgentLoop_DoesNotRetryWhenTerminalToolWasActuallyUsed(t *testing.T) {
	origRunner := runLocalAgentCommandFn
	t.Cleanup(func() {
		runLocalAgentCommandFn = origRunner
	})

	callCount := 0
	runLocalAgentCommandFn = func(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
		callCount++
		onPhase(localAgentLoopPhase{ToolName: "codex_command_execution", StatusLine: "lscpu"})
		return "当前我这边对终端的系统查询命令被宿主策略直接拦了。", nil
	}

	recorder := &testSSERecorder{ResponseRecorder: httptest.NewRecorder()}
	sseHandler := sse.MakeSSEHandlerCh(recorder, context.Background())
	req := &PostMessageRequest{
		ChatID:        "test-localagent-no-retry",
		LocalProvider: LocalProviderCodex,
		Msg: uctypes.AIMessage{
			MessageId: "msg-localagent-no-retry",
			Parts: []uctypes.AIMessagePart{
				{Type: uctypes.AIMessagePartTypeText, Text: "帮我查询cpu 型号 频率 温度 整理成表格给我"},
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

	if callCount != 1 {
		t.Fatalf("expected no retry once a terminal tool was observed, got %d calls", callCount)
	}
}

func TestLocalAgentLoop_CompressesInternalDebugWithoutTerminalToolUse(t *testing.T) {
	origRunner := runLocalAgentCommandFn
	t.Cleanup(func() {
		runLocalAgentCommandFn = origRunner
	})

	callCount := 0
	runLocalAgentCommandFn = func(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
		callCount++
		return "我刚刚尝试执行查询，但命令链路异常：CreateProcess failed.", nil
	}

	recorder := &testSSERecorder{ResponseRecorder: httptest.NewRecorder()}
	sseHandler := sse.MakeSSEHandlerCh(recorder, context.Background())
	req := &PostMessageRequest{
		ChatID:        "test-localagent-compress-debug",
		LocalProvider: LocalProviderCodex,
		Msg: uctypes.AIMessage{
			MessageId: "msg-localagent-compress-debug",
			Parts: []uctypes.AIMessagePart{
				{Type: uctypes.AIMessagePartTypeText, Text: "帮我查询远程终端 cpu 型号 频率 温度 整理成表格给我"},
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
	if callCount != 2 {
		t.Fatalf("expected one retry before summary compression, got %d calls", callCount)
	}
	if strings.Contains(body, "CreateProcess failed") {
		t.Fatalf("expected internal debug text to be compressed, got:\n%s", body)
	}
	if !strings.Contains(body, "未能通过当前终端执行命令完成这次查询") {
		t.Fatalf("expected concise terminal failure summary, got:\n%s", body)
	}
}
