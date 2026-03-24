// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type testWriteCloser struct{ io.Writer }

func (w testWriteCloser) Close() error { return nil }

type fakeCodexAppServerSessionRunner struct {
	threadIDVal   string
	connectionErr error
	prompts       []string
	closeCount    int
	bootstrapped  bool
}

func (f *fakeCodexAppServerSessionRunner) runTurn(ctx context.Context, input localAgentCodexTurnInputs, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
	prompt := selectCodexTurnPrompt(input, f.bootstrapped)
	f.prompts = append(f.prompts, prompt)
	f.bootstrapped = true
	return prompt, nil
}

func (f *fakeCodexAppServerSessionRunner) close() error {
	f.closeCount++
	f.connectionErr = io.EOF
	return nil
}

func (f *fakeCodexAppServerSessionRunner) threadID() string {
	return f.threadIDVal
}

func (f *fakeCodexAppServerSessionRunner) connectionError() error {
	return f.connectionErr
}

func TestHandleCodexAppServerNotification_AgentMessageDelta(t *testing.T) {
	state := newCodexAppServerTurnState("")
	var gotDelta string
	done, err := handleCodexAppServerNotification(context.Background(), nil, nil, codexAppServerRPCMessage{Method: "item/agentMessage/delta", Params: []byte(`{"delta":"hello world"}`)}, state, func(delta string) { gotDelta += delta }, nil)
	if err != nil || done || gotDelta != "hello world" || state.output.String() != "hello world" {
		t.Fatalf("unexpected delta handling: done=%v err=%v delta=%q output=%q", done, err, gotDelta, state.output.String())
	}
}

func TestCodexBuildThreadStartRequest_UsesModernAndLegacyEnumVariants(t *testing.T) {
	modern := codexBuildThreadStartRequest("/repo", false, false)
	if got := modern["approvalPolicy"]; got != "unlessTrusted" {
		t.Fatalf("modern approvalPolicy = %v, want unlessTrusted", got)
	}
	if got := modern["sandbox"]; got != "workspaceWrite" {
		t.Fatalf("modern sandbox = %v, want workspaceWrite", got)
	}

	legacy := codexBuildThreadStartRequest("/repo", true, false)
	if got := legacy["approvalPolicy"]; got != "untrusted" {
		t.Fatalf("legacy approvalPolicy = %v, want untrusted", got)
	}
	if got := legacy["sandbox"]; got != "workspace-write" {
		t.Fatalf("legacy sandbox = %v, want workspace-write", got)
	}

	modernBypass := codexBuildThreadStartRequest("/repo", false, true)
	if got := modernBypass["approvalPolicy"]; got != "never" {
		t.Fatalf("modern bypass approvalPolicy = %v, want never", got)
	}
	if got := modernBypass["sandbox"]; got != "dangerFullAccess" {
		t.Fatalf("modern bypass sandbox = %v, want dangerFullAccess", got)
	}

	legacyBypass := codexBuildThreadStartRequest("/repo", true, true)
	if got := legacyBypass["approvalPolicy"]; got != "never" {
		t.Fatalf("legacy bypass approvalPolicy = %v, want never", got)
	}
	if got := legacyBypass["sandbox"]; got != "danger-full-access" {
		t.Fatalf("legacy bypass sandbox = %v, want danger-full-access", got)
	}
}

func TestCodexUserAgentPrefersLegacyEnums(t *testing.T) {
	if !codexUserAgentPrefersLegacyEnums("codex_vscode/0.108.0-alpha.12 (Windows 10.0.26100; x86_64)") {
		t.Fatalf("expected legacy enums for older vscode app-server user agent")
	}
	if codexUserAgentPrefersLegacyEnums("codex_cli/0.114.0 (Windows 10.0.26100; x86_64)") {
		t.Fatalf("did not expect legacy enums for current cli user agent")
	}
	if got := codexInitializeUserAgent(map[string]any{"userAgent": "codex_vscode/0.108.0-alpha.12"}); got != "codex_vscode/0.108.0-alpha.12" {
		t.Fatalf("unexpected userAgent extraction: %q", got)
	}
}

func TestBuildTerminalQuerySettingsInstructions_UsesPureWSHCommands(t *testing.T) {
	instructions := buildTerminalQuerySettingsInstructions("block-123")
	if !strings.Contains(instructions, preferredWaveWSHPath+" agent termscrollback -b block-123 --lastcommand") {
		t.Fatalf("expected termscrollback command guidance, got:\n%s", instructions)
	}
	if !strings.Contains(instructions, "Never run bare wsh inside the remote shell") {
		t.Fatalf("expected local wsh path guidance, got:\n%s", instructions)
	}
	if !strings.Contains(instructions, "echo \"content\" | "+preferredWaveWSHPath+" file write <path-or-uri>") {
		t.Fatalf("expected stdin-based wsh file write guidance, got:\n%s", instructions)
	}
	if strings.Contains(instructions, "wsh blocks scrollback") {
		t.Fatalf("did not expect deprecated blocks scrollback guidance, got:\n%s", instructions)
	}
}

func TestCodexShouldRetryThreadStartWithLegacyEnums(t *testing.T) {
	err := io.EOF
	if codexShouldRetryThreadStartWithLegacyEnums(err) {
		t.Fatalf("unexpected retry for non-rpc error")
	}

	err = context.DeadlineExceeded
	if codexShouldRetryThreadStartWithLegacyEnums(err) {
		t.Fatalf("unexpected retry for timeout error")
	}

	err = errors.New("codex app-server thread/start failed (-32600): Invalid request: unknown variant unlessTrusted, expected one of untrusted, on-failure, on-request, reject, never")
	if !codexShouldRetryThreadStartWithLegacyEnums(err) {
		t.Fatalf("expected retry for legacy approvalPolicy mismatch")
	}

	err = errors.New("codex app-server thread/start failed (-32600): Invalid request: unknown variant `unlessTrusted`, expected one of `untrusted`, `on-failure`, `on-request`, `reject`, `never`")
	if !codexShouldRetryThreadStartWithLegacyEnums(err) {
		t.Fatalf("expected retry for quoted legacy approvalPolicy mismatch")
	}

	err = errors.New("codex app-server thread/start failed (-32600): Invalid request: unknown variant workspaceWrite, expected one of read-only, workspace-write, danger-full-access")
	if !codexShouldRetryThreadStartWithLegacyEnums(err) {
		t.Fatalf("expected retry for legacy sandbox mismatch")
	}

	err = errors.New("codex app-server thread/start failed (-32600): Invalid request: unknown variant dangerFullAccess, expected one of read-only, workspace-write, danger-full-access")
	if !codexShouldRetryThreadStartWithLegacyEnums(err) {
		t.Fatalf("expected retry for danger-full-access sandbox mismatch")
	}
}

func TestBuildCodexAppServerSessionSpec_DoesNotInjectLegacyToolConfig(t *testing.T) {
	spec, err := buildCodexAppServerSessionSpec(&PostMessageRequest{
		ChatID:        "chat-pure-wsh",
		LocalProvider: LocalProviderCodex,
	})
	if err != nil {
		t.Fatalf("buildCodexAppServerSessionSpec() error: %v", err)
	}
	for _, arg := range spec.Args {
		if strings.Contains(arg, "mcp_servers.") {
			t.Fatalf("did not expect legacy MCP config args in pure wsh mode, got %#v", spec.Args)
		}
	}
}

func TestBuildCodexAppServerSessionSpec_BypassAndReasoningOverrides(t *testing.T) {
	t.Setenv(localCodexAppServerBypassEnv, "1")
	t.Setenv(localCodexAppServerEffortEnv, "medium")
	spec, err := buildCodexAppServerSessionSpec(&PostMessageRequest{
		ChatID:        "chat-bypass",
		LocalProvider: LocalProviderCodex,
	})
	if err != nil {
		t.Fatalf("buildCodexAppServerSessionSpec() error: %v", err)
	}
	if !spec.BypassApprovalsAndSandbox {
		t.Fatalf("expected bypass flag to be enabled in session spec")
	}
	if len(spec.Args) < 2 || spec.Args[0] != "-c" || !strings.Contains(spec.Args[1], `model_reasoning_effort="medium"`) {
		t.Fatalf("expected medium reasoning override in args, got %#v", spec.Args)
	}
	if !strings.Contains(spec.SessionKey, "bypass=true") {
		t.Fatalf("expected session key to encode bypass flag, got %q", spec.SessionKey)
	}
}

func TestCodexAppServerSessionManager_ReusesSessionAndUsesIncrementalPrompt(t *testing.T) {
	manager := newCodexAppServerSessionManager()
	origFactory := newCodexAppServerSessionRunnerFn
	t.Cleanup(func() {
		newCodexAppServerSessionRunnerFn = origFactory
	})

	createCount := 0
	var runner *fakeCodexAppServerSessionRunner
	newCodexAppServerSessionRunnerFn = func(ctx context.Context, req *PostMessageRequest, spec codexAppServerSessionSpec, resumeThreadID string) (codexAppServerSessionRunner, error) {
		createCount++
		runner = &fakeCodexAppServerSessionRunner{threadIDVal: "thr-1"}
		return runner, nil
	}

	req := &PostMessageRequest{ChatID: "chat-reuse", LocalProvider: LocalProviderCodex}
	ctx := localAgentContextWithCodexTurnInputs(context.Background(), localAgentCodexTurnInputs{
		BootstrapPrompt:   "FULL-1 history",
		IncrementalPrompt: "USER-1 only",
	})
	if _, err := manager.runTurn(ctx, req, "FULL-1 history", nil, nil); err != nil {
		t.Fatalf("first runTurn() error: %v", err)
	}

	ctx = localAgentContextWithCodexTurnInputs(context.Background(), localAgentCodexTurnInputs{
		BootstrapPrompt:   "FULL-2 history",
		IncrementalPrompt: "USER-2 only",
	})
	if _, err := manager.runTurn(ctx, req, "FULL-2 history", nil, nil); err != nil {
		t.Fatalf("second runTurn() error: %v", err)
	}

	if createCount != 1 {
		t.Fatalf("expected one session creation, got %d", createCount)
	}
	if got := runner.prompts; len(got) != 2 || got[0] != "FULL-1 history" || got[1] != "USER-2 only" {
		t.Fatalf("unexpected prompts: %#v", got)
	}
}

func TestCodexAppServerSessionManager_RecreatesSessionAndResumesThread(t *testing.T) {
	chatstore.DefaultChatStore.Delete("chat-resume")
	t.Cleanup(func() {
		chatstore.DefaultChatStore.Delete("chat-resume")
	})
	manager := newCodexAppServerSessionManager()
	origFactory := newCodexAppServerSessionRunnerFn
	t.Cleanup(func() {
		newCodexAppServerSessionRunnerFn = origFactory
	})

	var created []*fakeCodexAppServerSessionRunner
	var resumeIDs []string
	newCodexAppServerSessionRunnerFn = func(ctx context.Context, req *PostMessageRequest, spec codexAppServerSessionSpec, resumeThreadID string) (codexAppServerSessionRunner, error) {
		resumeIDs = append(resumeIDs, resumeThreadID)
		runner := &fakeCodexAppServerSessionRunner{threadIDVal: "thr-persist"}
		created = append(created, runner)
		return runner, nil
	}
	if err := chatstore.DefaultChatStore.PostMessage("chat-resume", &uctypes.AIOptsType{APIType: uctypes.APIType_OpenAIResponses, Model: "gpt-5-mini"}, &openaichat.StoredChatMessage{MessageId: "msg-1", Message: openaichat.ChatRequestMessage{Role: "user", Content: "hello"}}); err != nil {
		t.Fatalf("PostMessage() error: %v", err)
	}

	req := &PostMessageRequest{ChatID: "chat-resume", LocalProvider: LocalProviderCodex}
	ctx := localAgentContextWithCodexTurnInputs(context.Background(), localAgentCodexTurnInputs{
		BootstrapPrompt:   "FULL-1",
		IncrementalPrompt: "USER-1",
	})
	if _, err := manager.runTurn(ctx, req, "FULL-1", nil, nil); err != nil {
		t.Fatalf("first runTurn() error: %v", err)
	}

	t.Setenv(localCodexAppServerCmdEnvName, "codex app-server --new-session")
	ctx = localAgentContextWithCodexTurnInputs(context.Background(), localAgentCodexTurnInputs{
		BootstrapPrompt:   "FULL-2",
		IncrementalPrompt: "USER-2",
	})
	if _, err := manager.runTurn(ctx, req, "FULL-2", nil, nil); err != nil {
		t.Fatalf("second runTurn() error: %v", err)
	}

	if len(created) != 2 {
		t.Fatalf("expected two session creations, got %d", len(created))
	}
	if created[0].closeCount != 1 {
		t.Fatalf("expected first session to be closed once, got %d", created[0].closeCount)
	}
	if len(resumeIDs) != 2 || resumeIDs[0] != "" || resumeIDs[1] != "thr-persist" {
		t.Fatalf("unexpected resume ids: %#v", resumeIDs)
	}
	if got := chatstore.DefaultChatStore.GetCodexThreadID("chat-resume"); got != "thr-persist" {
		t.Fatalf("expected persisted thread id, got %q", got)
	}
	if chat := chatstore.DefaultChatStore.Get("chat-resume"); chat == nil || chat.CodexThreadId != "thr-persist" {
		t.Fatalf("expected chat metadata to include thread id, got %#v", chat)
	}
	newManager := newCodexAppServerSessionManager()
	ctx = localAgentContextWithCodexTurnInputs(context.Background(), localAgentCodexTurnInputs{
		BootstrapPrompt:   "FULL-3",
		IncrementalPrompt: "USER-3",
	})
	if _, err := newManager.runTurn(ctx, req, "FULL-3", nil, nil); err != nil {
		t.Fatalf("third runTurn() error: %v", err)
	}
	if len(resumeIDs) != 3 || resumeIDs[2] != "thr-persist" {
		t.Fatalf("expected new manager to resume persisted thread, got %#v", resumeIDs)
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
	deadline = time.Now().Add(2 * time.Second)
	body := recorder.Body.String()
	for time.Now().Before(deadline) && !strings.Contains(body, `"status":"completed"`) {
		time.Sleep(10 * time.Millisecond)
		body = recorder.Body.String()
	}
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

func TestHandleCodexAppServerNotification_RequestApprovalBridgeAutoApprove(t *testing.T) {
	recorder := &testSSERecorder{ResponseRecorder: httptest.NewRecorder()}
	sseHandler := sse.MakeSSEHandlerCh(recorder, context.Background())
	if err := sseHandler.SetupSSE(); err != nil {
		t.Fatalf("SetupSSE() error: %v", err)
	}
	defer sseHandler.Close()
	var outbound bytes.Buffer
	client := newCodexAppServerClient(testWriteCloser{Writer: &outbound}, io.NopCloser(strings.NewReader("")))
	state := newCodexAppServerTurnState("turn-1")
	if _, err := handleCodexAppServerNotification(context.Background(), client, sseHandler, codexAppServerRPCMessage{Method: "item/started", Params: []byte(`{"item":{"id":"item-1","type":"commandExecution","command":["uname","-a"],"cwd":"/repo"}}`)}, state, nil, nil); err != nil {
		t.Fatalf("item/started error: %v", err)
	}
	ctx := localAgentContextWithAgentMode(context.Background(), AgentModeAutoApprove)
	if _, err := handleCodexAppServerNotification(ctx, client, sseHandler, codexAppServerRPCMessage{ID: json.RawMessage(`"req-1"`), Method: "item/commandExecution/requestApproval", Params: []byte(`{"threadId":"thr-1","turnId":"turn-1","itemId":"item-1","reason":"Need approval"}`)}, state, nil, nil); err != nil {
		t.Fatalf("approval bridge returned error: %v", err)
	}
	if _, exists := getToolApprovalRequest(codexToolUseCallID("req-1")); exists {
		t.Fatalf("expected auto-approve flow to avoid manual approval registration")
	}
	deadline := time.Now().Add(2 * time.Second)
	body := recorder.Body.String()
	for time.Now().Before(deadline) && !strings.Contains(body, `"approval":"auto-approved"`) {
		time.Sleep(10 * time.Millisecond)
		body = recorder.Body.String()
	}
	if !strings.Contains(body, `"approval":"auto-approved"`) {
		t.Fatalf("expected auto-approved SSE payload, got:\n%s", body)
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
