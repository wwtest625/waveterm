// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type testWriteCloser struct{ io.Writer }

func (w testWriteCloser) Close() error { return nil }

func TestHandleCodexAppServerNotification_AgentMessageDelta(t *testing.T) {
	state := newCodexAppServerTurnState("")
	var gotDelta string
	done, err := handleCodexAppServerNotification(context.Background(), nil, nil, codexAppServerRPCMessage{Method: "item/agentMessage/delta", Params: []byte(`{"delta":"hello world"}`)}, state, func(delta string) { gotDelta += delta }, nil)
	if err != nil || done || gotDelta != "hello world" || state.output.String() != "hello world" {
		t.Fatalf("unexpected delta handling: done=%v err=%v delta=%q output=%q", done, err, gotDelta, state.output.String())
	}
}

func TestHandleCodexAppServerNotification_CommandExecutionPhaseAndTurnComplete(t *testing.T) {
	state := newCodexAppServerTurnState("")
	var phases []localAgentLoopPhase
	done, err := handleCodexAppServerNotification(context.Background(), nil, nil, codexAppServerRPCMessage{Method: "item/started", Params: []byte(`{"item":{"type":"commandExecution","command":["go","test","./pkg/aiusechat"]}}`)}, state, nil, func(phase localAgentLoopPhase) { phases = append(phases, phase) })
	if err != nil || done || len(phases) != 1 {
		t.Fatalf("unexpected item/started result: done=%v err=%v phases=%v", done, err, phases)
	}
	if phases[0].ToolName != "codex_command_execution" || phases[0].StatusLine != "go test ./pkg/aiusechat" {
		t.Fatalf("unexpected phase: %+v", phases[0])
	}
	done, err = handleCodexAppServerNotification(context.Background(), nil, nil, codexAppServerRPCMessage{Method: "turn/completed", Params: []byte(`{"turn":{"status":"completed"}}`)}, state, nil, nil)
	if err != nil || !done {
		t.Fatalf("unexpected turn completion: done=%v err=%v", done, err)
	}
}

func TestCodexAppServerClientReadLoop_RoutesServerRequestsToNotifyChannel(t *testing.T) {
	stdoutReader, stdoutWriter := io.Pipe()
	client := newCodexAppServerClient(testWriteCloser{Writer: io.Discard}, stdoutReader)
	respCh := make(chan codexAppServerRPCMessage, 1)
	client.pending["1"] = respCh
	client.start()
	_, _ = io.WriteString(stdoutWriter, "{\"id\":1,\"result\":{}}\n")
	_, _ = io.WriteString(stdoutWriter, "{\"id\":\"req-1\",\"method\":\"item/commandExecution/requestApproval\",\"params\":{\"itemId\":\"item-1\"}}\n")
	_ = stdoutWriter.Close()
	select {
	case resp := <-respCh:
		if string(resp.ID) != "1" {
			t.Fatalf("unexpected response id: %s", string(resp.ID))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for response")
	}
	select {
	case msg := <-client.notifyCh:
		if msg.Method != "item/commandExecution/requestApproval" || codexRPCIDKey(msg.ID) != "req-1" {
			t.Fatalf("unexpected routed request: method=%s id=%s", msg.Method, codexRPCIDKey(msg.ID))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for server request")
	}
}

func TestHandleCodexAppServerNotification_RequestApprovalBridge(t *testing.T) {
	recorder := &testSSERecorder{ResponseRecorder: httptest.NewRecorder()}
	sseHandler := sse.MakeSSEHandlerCh(recorder, context.Background())
	if err := sseHandler.SetupSSE(); err != nil {
		t.Fatalf("SetupSSE() error: %v", err)
	}
	defer sseHandler.Close()
	var outbound bytes.Buffer
	client := newCodexAppServerClient(testWriteCloser{Writer: &outbound}, io.NopCloser(strings.NewReader("")))
	state := newCodexAppServerTurnState("turn-1")
	if _, err := handleCodexAppServerNotification(context.Background(), client, sseHandler, codexAppServerRPCMessage{Method: "item/started", Params: []byte(`{"item":{"id":"item-1","type":"commandExecution","command":["go","test","./pkg/aiusechat"],"cwd":"/repo"}}`)}, state, nil, nil); err != nil {
		t.Fatalf("item/started error: %v", err)
	}
	errCh := make(chan error, 1)
	go func() {
		_, err := handleCodexAppServerNotification(context.Background(), client, sseHandler, codexAppServerRPCMessage{ID: json.RawMessage(`"req-1"`), Method: "item/commandExecution/requestApproval", Params: []byte(`{"threadId":"thr-1","turnId":"turn-1","itemId":"item-1","reason":"Need approval"}`)}, state, nil, nil)
		errCh <- err
	}()
	toolCallID := codexToolUseCallID("req-1")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, exists := getToolApprovalRequest(toolCallID); exists {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, exists := getToolApprovalRequest(toolCallID); !exists {
		t.Fatalf("approval request %s was not registered", toolCallID)
	}
	if err := UpdateToolApproval(toolCallID, uctypes.ApprovalUserApproved); err != nil {
		t.Fatalf("UpdateToolApproval() error: %v", err)
	}
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("approval bridge returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for approval bridge")
	}
	if _, err := handleCodexAppServerNotification(context.Background(), client, sseHandler, codexAppServerRPCMessage{Method: "item/completed", Params: []byte(`{"item":{"id":"item-1","type":"commandExecution","status":"completed"}}`)}, state, nil, nil); err != nil {
		t.Fatalf("item/completed error: %v", err)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, `"type":"data-tooluse"`) || !strings.Contains(body, `"toolcallid":"codex-approval:req-1"`) {
		t.Fatalf("expected tooluse SSE payloads, got:\n%s", body)
	}
	if !strings.Contains(body, `"approval":"needs-approval"`) || !strings.Contains(body, `"approval":"user-approved"`) || !strings.Contains(body, `"status":"completed"`) {
		t.Fatalf("expected approval lifecycle SSE updates, got:\n%s", body)
	}
	lines := strings.Split(strings.TrimSpace(outbound.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected one approval response line, got %d (%q)", len(lines), outbound.String())
	}
	var resp struct {
		ID     string `json:"id"`
		Result struct {
			Decision string `json:"decision"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &resp); err != nil {
		t.Fatalf("failed to decode approval response: %v", err)
	}
	if resp.ID != "req-1" || resp.Result.Decision != "accept" {
		t.Fatalf("unexpected approval response payload: %+v", resp)
	}
}
