// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"text/template"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type codexAppServerRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type codexAppServerRPCMessage struct {
	ID     json.RawMessage         `json:"id,omitempty"`
	Method string                  `json:"method,omitempty"`
	Params json.RawMessage         `json:"params,omitempty"`
	Result json.RawMessage         `json:"result,omitempty"`
	Error  *codexAppServerRPCError `json:"error,omitempty"`
}

type codexAppServerClient struct {
	stdin   io.WriteCloser
	stdout  io.ReadCloser
	writeMu sync.Mutex

	pendingMu sync.Mutex
	pending   map[string]chan codexAppServerRPCMessage
	notifyCh  chan codexAppServerRPCMessage

	nextID int64

	closedOnce sync.Once
	closedCh   chan struct{}
	closedErr  error
}

func newCodexAppServerClient(stdin io.WriteCloser, stdout io.ReadCloser) *codexAppServerClient {
	return &codexAppServerClient{
		stdin:    stdin,
		stdout:   stdout,
		pending:  make(map[string]chan codexAppServerRPCMessage),
		notifyCh: make(chan codexAppServerRPCMessage, 128),
		closedCh: make(chan struct{}),
	}
}

func (c *codexAppServerClient) start() {
	go c.readLoop()
}

func (c *codexAppServerClient) closeWithError(err error) {
	c.closedOnce.Do(func() {
		c.closedErr = err
		close(c.closedCh)
	})
}

func (c *codexAppServerClient) connectionError() error {
	select {
	case <-c.closedCh:
		if c.closedErr != nil {
			return c.closedErr
		}
		return io.EOF
	default:
		return nil
	}
}

func (c *codexAppServerClient) readLoop() {
	reader := bufio.NewReader(c.stdout)
	for {
		line, err := reader.ReadBytes('\n')
		trimmed := bytes.TrimSpace(line)
		if len(trimmed) > 0 {
			var msg codexAppServerRPCMessage
			if jsonErr := json.Unmarshal(trimmed, &msg); jsonErr != nil {
				c.closeWithError(fmt.Errorf("decode codex app-server message: %w", jsonErr))
				return
			}
			if msg.Method != "" {
				c.notifyCh <- msg
			} else if len(msg.ID) > 0 {
				idKey := string(msg.ID)
				c.pendingMu.Lock()
				respCh := c.pending[idKey]
				c.pendingMu.Unlock()
				if respCh != nil {
					respCh <- msg
				}
			}
		}
		if err != nil {
			if err == io.EOF || isExpectedPipeCloseError(err) {
				c.closeWithError(nil)
			} else {
				c.closeWithError(err)
			}
			return
		}
	}
}

func (c *codexAppServerClient) send(ctx context.Context, payload any) error {
	if err := c.connectionError(); err != nil {
		return err
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := c.stdin.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

func (c *codexAppServerClient) notify(ctx context.Context, method string, params any) error {
	payload := map[string]any{"method": method}
	if params != nil {
		payload["params"] = params
	}
	return c.send(ctx, payload)
}

func (c *codexAppServerClient) respond(ctx context.Context, id json.RawMessage, result any) error {
	payload := struct {
		ID     json.RawMessage `json:"id"`
		Result any             `json:"result,omitempty"`
	}{
		ID:     id,
		Result: result,
	}
	return c.send(ctx, payload)
}

func (c *codexAppServerClient) call(ctx context.Context, method string, params any, result any) error {
	id := atomic.AddInt64(&c.nextID, 1)
	idKey := strconv.FormatInt(id, 10)
	respCh := make(chan codexAppServerRPCMessage, 1)

	c.pendingMu.Lock()
	c.pending[idKey] = respCh
	c.pendingMu.Unlock()
	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, idKey)
		c.pendingMu.Unlock()
	}()

	payload := map[string]any{"id": id, "method": method}
	if params != nil {
		payload["params"] = params
	}
	if err := c.send(ctx, payload); err != nil {
		return err
	}

	select {
	case resp := <-respCh:
		if resp.Error != nil {
			return fmt.Errorf("codex app-server %s failed (%d): %s", method, resp.Error.Code, strings.TrimSpace(resp.Error.Message))
		}
		if result != nil && len(resp.Result) > 0 {
			if err := json.Unmarshal(resp.Result, result); err != nil {
				return fmt.Errorf("decode codex app-server %s result: %w", method, err)
			}
		}
		return nil
	case <-c.closedCh:
		return fmt.Errorf("codex app-server connection closed: %w", c.connectionError())
	case <-ctx.Done():
		return ctx.Err()
	}
}

type codexAppServerTurnState struct {
	output              strings.Builder
	turnID              string
	items               map[string]*codexAppServerItemState
	startedItemLogCount int
}

type codexAppServerItemState struct {
	ItemID      string
	ItemType    string
	ToolName    string
	Command     string
	Cwd         string
	Paths       []string
	ToolUseData *uctypes.UIMessageDataToolUse
}

func newCodexAppServerTurnState(turnID string) *codexAppServerTurnState {
	return &codexAppServerTurnState{
		turnID: turnID,
		items:  make(map[string]*codexAppServerItemState),
	}
}

func (s *codexAppServerTurnState) ensureItem(itemID string) *codexAppServerItemState {
	if strings.TrimSpace(itemID) == "" {
		return nil
	}
	if s.items == nil {
		s.items = make(map[string]*codexAppServerItemState)
	}
	itemState := s.items[itemID]
	if itemState == nil {
		itemState = &codexAppServerItemState{ItemID: itemID}
		s.items[itemID] = itemState
	}
	return itemState
}

func codexTruncateStatus(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	if len(s) <= 140 {
		return s
	}
	return s[:137] + "..."
}

func codexJSONPath(v any, path ...string) (any, bool) {
	cur := v
	for _, part := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = m[part]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}

func codexJSONString(v any, paths ...[]string) string {
	for _, path := range paths {
		if raw, ok := codexJSONPath(v, path...); ok {
			switch val := raw.(type) {
			case string:
				if strings.TrimSpace(val) != "" {
					return val
				}
			case []any:
				parts := make([]string, 0, len(val))
				for _, entry := range val {
					if s, ok := entry.(string); ok && s != "" {
						parts = append(parts, s)
					}
				}
				if len(parts) > 0 {
					return strings.Join(parts, " ")
				}
			}
		}
	}
	return ""
}

func codexJSONStringSlice(v any, path ...string) []string {
	raw, ok := codexJSONPath(v, path...)
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	parts := make([]string, 0, len(arr))
	for _, entry := range arr {
		if s, ok := entry.(string); ok && s != "" {
			parts = append(parts, s)
		}
	}
	return parts
}

func codexJSONArray(v any, path ...string) []any {
	raw, ok := codexJSONPath(v, path...)
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	return arr
}

func codexRPCIDKey(id json.RawMessage) string {
	id = bytes.TrimSpace(id)
	if len(id) == 0 {
		return ""
	}
	var idStr string
	if err := json.Unmarshal(id, &idStr); err == nil && strings.TrimSpace(idStr) != "" {
		return strings.TrimSpace(idStr)
	}
	return string(id)
}

func codexToolUseCallID(idKey string) string {
	idKey = strings.TrimSpace(idKey)
	if idKey == "" {
		return ""
	}
	return "codex-approval:" + idKey
}

func codexDecisionForApproval(approval string) string {
	switch approval {
	case uctypes.ApprovalUserApproved, uctypes.ApprovalAutoApproved:
		return "accept"
	case uctypes.ApprovalUserDenied:
		return "decline"
	default:
		return "cancel"
	}
}

func codexFileChangePaths(params map[string]any) []string {
	changes := codexJSONArray(params, "item", "changes")
	if len(changes) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	paths := make([]string, 0, len(changes))
	for _, raw := range changes {
		change, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		path := codexJSONString(change, []string{"path"}, []string{"targetPath"})
		if path == "" {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	return paths
}

func codexBuildApprovalDescription(method string, reason string, itemState *codexAppServerItemState) string {
	lines := make([]string, 0, 4)
	switch method {
	case "item/commandExecution/requestApproval":
		if itemState != nil && itemState.Command != "" {
			lines = append(lines, itemState.Command)
		}
		if itemState != nil && itemState.Cwd != "" {
			lines = append(lines, "cwd: "+itemState.Cwd)
		}
	case "item/fileChange/requestApproval":
		if itemState != nil {
			for _, path := range itemState.Paths {
				lines = append(lines, "change: "+path)
			}
		}
	}
	if strings.TrimSpace(reason) != "" {
		lines = append(lines, "reason: "+strings.TrimSpace(reason))
	}
	if len(lines) == 0 {
		lines = append(lines, "Codex app-server requested approval")
	}
	return strings.Join(lines, "\n")
}

func codexRecordStartedItem(state *codexAppServerTurnState, params map[string]any) *codexAppServerItemState {
	itemID := codexJSONString(params, []string{"item", "id"})
	itemType := codexJSONString(params, []string{"item", "type"})
	itemState := state.ensureItem(itemID)
	if itemState == nil {
		return nil
	}
	itemState.ItemType = itemType
	itemState.ToolName = codexJSONString(
		params,
		[]string{"item", "toolName"},
		[]string{"item", "tool", "name"},
		[]string{"item", "server", "toolName"},
		[]string{"item", "name"},
	)
	switch itemType {
	case "commandExecution":
		itemState.Command = strings.Join(codexJSONStringSlice(params, "item", "command"), " ")
		itemState.Cwd = codexJSONString(params, []string{"item", "cwd"})
	case "fileChange":
		itemState.Paths = codexFileChangePaths(params)
	}
	return itemState
}

func codexUpdateCompletedToolUse(itemState *codexAppServerItemState, params map[string]any) bool {
	if itemState == nil || itemState.ToolUseData == nil {
		return false
	}
	status := codexJSONString(params, []string{"item", "status"})
	switch status {
	case "completed":
		itemState.ToolUseData.Status = uctypes.ToolUseStatusCompleted
		itemState.ToolUseData.ErrorMessage = ""
	case "failed", "declined":
		itemState.ToolUseData.Status = uctypes.ToolUseStatusError
		if itemState.ToolUseData.ErrorMessage == "" {
			if status == "declined" {
				itemState.ToolUseData.ErrorMessage = "Codex action was declined"
			} else {
				itemState.ToolUseData.ErrorMessage = "Codex action failed"
			}
		}
	default:
		return false
	}
	return true
}

func codexExtractStartedToolName(itemState *codexAppServerItemState, params map[string]any) string {
	if itemState != nil && strings.TrimSpace(itemState.ToolName) != "" {
		return strings.TrimSpace(itemState.ToolName)
	}
	toolName := codexJSONString(
		params,
		[]string{"item", "toolName"},
		[]string{"item", "tool", "name"},
		[]string{"item", "server", "toolName"},
		[]string{"item", "name"},
		[]string{"toolName"},
		[]string{"name"},
	)
	if strings.TrimSpace(toolName) != "" {
		return strings.TrimSpace(toolName)
	}
	return ""
}

func handleCodexAppServerApprovalRequest(ctx context.Context, client *codexAppServerClient, sseHandler *sse.SSEHandlerCh, msg codexAppServerRPCMessage, state *codexAppServerTurnState, params map[string]any, onPhase func(localAgentLoopPhase)) error {
	if client == nil {
		return fmt.Errorf("codex approval request received without client")
	}
	if sseHandler == nil {
		return fmt.Errorf("%s requires SSE-backed Wave approval flow", msg.Method)
	}
	requestIDKey := codexRPCIDKey(msg.ID)
	if requestIDKey == "" {
		return fmt.Errorf("%s missing request id", msg.Method)
	}
	itemID := codexJSONString(params, []string{"itemId"})
	itemState := state.ensureItem(itemID)
	if itemState == nil {
		return fmt.Errorf("%s missing itemId", msg.Method)
	}
	reason := codexJSONString(params, []string{"reason"})
	toolName := "codex approval"
	if msg.Method == "item/commandExecution/requestApproval" {
		toolName = "codex command"
		if itemState.Command == "" {
			itemState.Command = strings.Join(codexJSONStringSlice(params, "command"), " ")
		}
		if itemState.Cwd == "" {
			itemState.Cwd = codexJSONString(params, []string{"cwd"})
		}
	} else if msg.Method == "item/fileChange/requestApproval" {
		toolName = "codex file change"
		if len(itemState.Paths) == 0 {
			itemState.Paths = codexFileChangePaths(params)
		}
	}
	itemState.ToolUseData = &uctypes.UIMessageDataToolUse{
		ToolCallId: codexToolUseCallID(requestIDKey),
		ToolName:   toolName,
		ToolDesc:   codexBuildApprovalDescription(msg.Method, reason, itemState),
		Status:     uctypes.ToolUseStatusPending,
		Approval:   uctypes.ApprovalNeedsApproval,
	}
	mode, _ := localAgentAgentModeFromContext(ctx)
	if err := validateCodexApprovalRequestForAgentMode(mode, msg.Method); err != nil {
		itemState.ToolUseData.Status = uctypes.ToolUseStatusError
		itemState.ToolUseData.Approval = uctypes.ApprovalUserDenied
		itemState.ToolUseData.ErrorMessage = err.Error()
		emitLocalAgentToolUse(sseHandler, *itemState.ToolUseData)
		codexEmitPhase(onPhase, "codex_waiting_approval", err.Error())
		return client.respond(ctx, msg.ID, map[string]any{"decision": codexDecisionForApproval(uctypes.ApprovalUserDenied)})
	}

	itemState.ToolUseData.Approval = applyAgentModeApprovalPolicyForCodexRequest(mode, msg.Method, itemState.ToolUseData.Approval)
	if itemState.ToolUseData.Approval == uctypes.ApprovalAutoApproved {
		itemState.ToolUseData.RunTs = time.Now().UnixMilli()
		emitLocalAgentToolUse(sseHandler, *itemState.ToolUseData)
		codexEmitPhase(onPhase, "codex_waiting_approval", "Auto-approved by agent mode")
		return client.respond(ctx, msg.ID, map[string]any{"decision": codexDecisionForApproval(itemState.ToolUseData.Approval)})
	}

	emitLocalAgentToolUse(sseHandler, *itemState.ToolUseData)
	RegisterToolApproval(itemState.ToolUseData.ToolCallId, sseHandler)
	defer UnregisterToolApproval(itemState.ToolUseData.ToolCallId)

	statusMsg := reason
	if statusMsg == "" {
		statusMsg = itemState.ToolUseData.ToolDesc
	}
	codexEmitPhase(onPhase, "codex_waiting_approval", statusMsg)

	approval, err := WaitForToolApproval(ctx, itemState.ToolUseData.ToolCallId)
	if err != nil || approval == "" {
		approval = uctypes.ApprovalCanceled
	}
	itemState.ToolUseData.Approval = approval
	if approval == uctypes.ApprovalUserApproved || approval == uctypes.ApprovalAutoApproved {
		itemState.ToolUseData.RunTs = time.Now().UnixMilli()
	} else {
		itemState.ToolUseData.Status = uctypes.ToolUseStatusError
		if approval == uctypes.ApprovalUserDenied {
			itemState.ToolUseData.ErrorMessage = "Codex action denied by user"
		} else {
			itemState.ToolUseData.ErrorMessage = "Codex action canceled"
		}
	}
	emitLocalAgentToolUse(sseHandler, *itemState.ToolUseData)
	return client.respond(ctx, msg.ID, map[string]any{"decision": codexDecisionForApproval(approval)})
}

func codexEmitPhase(onPhase func(localAgentLoopPhase), toolName string, status string) {
	if onPhase == nil || strings.TrimSpace(toolName) == "" {
		return
	}
	onPhase(localAgentLoopPhase{ToolName: toolName, StatusLine: codexTruncateStatus(status)})
}

func handleCodexAppServerNotification(ctx context.Context, client *codexAppServerClient, sseHandler *sse.SSEHandlerCh, msg codexAppServerRPCMessage, state *codexAppServerTurnState, onDelta func(string), onPhase func(localAgentLoopPhase)) (bool, error) {
	var params map[string]any
	if len(msg.Params) > 0 {
		if err := json.Unmarshal(msg.Params, &params); err != nil {
			return false, fmt.Errorf("decode %s params: %w", msg.Method, err)
		}
	}

	switch msg.Method {
	case "turn/started":
		state.turnID = codexJSONString(params, []string{"turn", "id"})
		codexEmitPhase(onPhase, "codex_thinking", "Codex turn started")
	case "item/agentMessage/delta":
		delta := codexJSONString(params,
			[]string{"delta"},
			[]string{"textDelta"},
			[]string{"item", "delta"},
			[]string{"item", "text"},
		)
		if delta != "" {
			state.output.WriteString(delta)
			if onDelta != nil {
				onDelta(delta)
			}
		}
	case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
		summary := codexJSONString(params, []string{"delta"}, []string{"textDelta"}, []string{"text"})
		if summary == "" {
			summary = "Codex is reasoning"
		}
		codexEmitPhase(onPhase, "codex_reasoning", summary)
	case "item/plan/delta", "turn/plan/updated":
		status := codexJSONString(params, []string{"delta"}, []string{"explanation"})
		if status == "" {
			status = "Codex updated its plan"
		}
		codexEmitPhase(onPhase, "codex_plan", status)
	case "thread/status/changed":
		flags := codexJSONStringSlice(params, "status", "activeFlags")
		for _, flag := range flags {
			if flag == "waitingOnApproval" {
				codexEmitPhase(onPhase, "codex_waiting_approval", "Waiting on approval")
				break
			}
		}
	case "item/started":
		itemState := codexRecordStartedItem(state, params)
		itemType := codexJSONString(params, []string{"item", "type"})
		startedToolName := codexExtractStartedToolName(itemState, params)
		if state != nil && state.startedItemLogCount < 6 {
			state.startedItemLogCount++
			log.Printf(
				"local-agent: codex app-server item/started #%d type=%q itemid=%q tool=%q\n",
				state.startedItemLogCount,
				itemType,
				codexJSONString(params, []string{"item", "id"}),
				startedToolName,
			)
		}
		switch itemType {
		case "commandExecution":
			command := strings.Join(codexJSONStringSlice(params, "item", "command"), " ")
			if itemState != nil && itemState.Command != "" {
				command = itemState.Command
			}
			if command == "" {
				command = "Executing command"
			}
			codexEmitPhase(onPhase, "codex_command_execution", command)
		case "fileChange":
			path := codexJSONString(params, []string{"item", "path"}, []string{"item", "targetPath"})
			if itemState != nil && len(itemState.Paths) > 0 {
				path = strings.Join(itemState.Paths, ", ")
			}
			if path == "" {
				path = "Preparing file changes"
			}
			codexEmitPhase(onPhase, "codex_file_change", path)
		case "dynamicToolCall":
			toolName := codexJSONString(params, []string{"item", "toolName"}, []string{"item", "tool", "name"})
			if toolName == "" {
				toolName = "dynamic tool"
			}
			codexEmitPhase(onPhase, "codex_dynamic_tool", toolName)
		}
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		if err := handleCodexAppServerApprovalRequest(ctx, client, sseHandler, msg, state, params, onPhase); err != nil {
			return false, err
		}
	case "item/completed":
		itemID := codexJSONString(params, []string{"item", "id"})
		itemState := state.ensureItem(itemID)
		if codexUpdateCompletedToolUse(itemState, params) {
			emitLocalAgentToolUse(sseHandler, *itemState.ToolUseData)
		}
	case "turn/completed":
		status := codexJSONString(params, []string{"turn", "status"})
		if status == "failed" || status == "interrupted" {
			errMsg := codexJSONString(params,
				[]string{"turn", "error", "message"},
				[]string{"turn", "error", "additionalDetails"},
			)
			if errMsg == "" {
				errMsg = "codex turn failed"
			}
			return true, errors.New(errMsg)
		}
		codexEmitPhase(onPhase, "codex_responding", "Codex completed the turn")
		return true, nil
	default:
		if msg.Method != "" && len(msg.ID) > 0 {
			return false, fmt.Errorf("unsupported codex app-server server request: %s", msg.Method)
		}
	}

	return false, nil
}

type codexAppServerSessionSpec struct {
	Req                       *PostMessageRequest
	ChatID                    string
	CmdName                   string
	Args                      []string
	WorkingDir                string
	BypassApprovalsAndSandbox bool
	SessionKey                string
}

type codexAppServerSessionRunner interface {
	runTurn(ctx context.Context, input localAgentCodexTurnInputs, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error)
	close() error
	threadID() string
	connectionError() error
}

type codexManagedSession struct {
	sessionKey string
	runner     codexAppServerSessionRunner
}

type codexAppServerSessionManager struct {
	mu       sync.Mutex
	sessions map[string]*codexManagedSession
	threads  map[string]string
}

type codexAppServerSession struct {
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stderrDone chan struct{}
	stderrBuf  bytes.Buffer
	client     *codexAppServerClient

	stateMu      sync.Mutex
	threadIDVal  string
	bootstrapped bool

	turnMu    sync.Mutex
	closeOnce sync.Once
	closeErr  error
}

var defaultCodexAppServerSessionManager = newCodexAppServerSessionManager()

var newCodexAppServerSessionRunnerFn = func(ctx context.Context, req *PostMessageRequest, spec codexAppServerSessionSpec, resumeThreadID string) (codexAppServerSessionRunner, error) {
	return newCodexAppServerSession(ctx, req, spec, resumeThreadID)
}

func newCodexAppServerSessionManager() *codexAppServerSessionManager {
	return &codexAppServerSessionManager{
		sessions: make(map[string]*codexManagedSession),
		threads:  make(map[string]string),
	}
}

func (m *codexAppServerSessionManager) rememberedThreadID(chatID string) string {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return ""
	}

	m.mu.Lock()
	threadID := strings.TrimSpace(m.threads[chatID])
	m.mu.Unlock()
	if threadID != "" {
		return threadID
	}
	return strings.TrimSpace(chatstore.DefaultChatStore.GetCodexThreadID(chatID))
}

func (m *codexAppServerSessionManager) rememberThreadID(chatID string, threadID string) {
	chatID = strings.TrimSpace(chatID)
	threadID = strings.TrimSpace(threadID)
	if chatID == "" || threadID == "" {
		return
	}
	m.mu.Lock()
	m.threads[chatID] = threadID
	m.mu.Unlock()
	chatstore.DefaultChatStore.SetCodexThreadID(chatID, threadID)
}

func (m *codexAppServerSessionManager) discardSession(chatID string, runner codexAppServerSessionRunner) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" || runner == nil {
		return
	}
	threadID := strings.TrimSpace(runner.threadID())
	m.mu.Lock()
	defer m.mu.Unlock()
	entry := m.sessions[chatID]
	if entry == nil || entry.runner != runner {
		return
	}
	if threadID != "" {
		m.threads[chatID] = threadID
	}
	delete(m.sessions, chatID)
	if threadID != "" {
		chatstore.DefaultChatStore.SetCodexThreadID(chatID, threadID)
	}
}

func (m *codexAppServerSessionManager) getOrCreateSession(ctx context.Context, req *PostMessageRequest, spec codexAppServerSessionSpec) (*codexManagedSession, bool, error) {
	resumeThreadID := m.rememberedThreadID(spec.ChatID)
	m.mu.Lock()
	entry := m.sessions[spec.ChatID]
	var stale codexAppServerSessionRunner
	if entry != nil {
		if entry.sessionKey == spec.SessionKey && entry.runner.connectionError() == nil {
			m.mu.Unlock()
			return entry, false, nil
		}
		stale = entry.runner
		delete(m.sessions, spec.ChatID)
	}
	m.mu.Unlock()
	if stale != nil {
		_ = stale.close()
	}

	runner, err := newCodexAppServerSessionRunnerFn(ctx, req, spec, resumeThreadID)
	if err != nil {
		return nil, false, err
	}
	newEntry := &codexManagedSession{sessionKey: spec.SessionKey, runner: runner}

	m.mu.Lock()
	existing := m.sessions[spec.ChatID]
	if existing != nil && existing.sessionKey == spec.SessionKey && existing.runner.connectionError() == nil {
		m.mu.Unlock()
		_ = runner.close()
		return existing, false, nil
	}
	var replaced codexAppServerSessionRunner
	if existing != nil {
		replaced = existing.runner
	}
	m.sessions[spec.ChatID] = newEntry
	if threadID := strings.TrimSpace(runner.threadID()); threadID != "" {
		m.threads[spec.ChatID] = threadID
	}
	m.mu.Unlock()
	if replaced != nil {
		_ = replaced.close()
	}
	return newEntry, true, nil
}

func (m *codexAppServerSessionManager) runTurn(ctx context.Context, req *PostMessageRequest, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
	timeout := getLocalAgentTimeout()
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	spec, err := buildCodexAppServerSessionSpec(req)
	if err != nil {
		return "", err
	}
	entry, created, err := m.getOrCreateSession(runCtx, req, spec)
	if err != nil {
		return "", err
	}
	if created {
		codexEmitPhase(onPhase, "codex_thinking", "Starting Codex app-server")
		codexEmitPhase(onPhase, "codex_wave_terminal_context_ok", "Connected terminal context (pure wsh mode)")
	}
	inputs, ok := localAgentCodexTurnInputsFromContext(runCtx)
	if !ok {
		inputs = localAgentCodexTurnInputs{BootstrapPrompt: prompt, IncrementalPrompt: prompt}
	}
	if strings.TrimSpace(inputs.BootstrapPrompt) == "" {
		inputs.BootstrapPrompt = prompt
	}
	if strings.TrimSpace(inputs.IncrementalPrompt) == "" {
		inputs.IncrementalPrompt = prompt
	}
	output, err := entry.runner.runTurn(runCtx, inputs, onDelta, onPhase)
	if err != nil {
		m.discardSession(req.ChatID, entry.runner)
		_ = entry.runner.close()
		return output, err
	}
	m.rememberThreadID(req.ChatID, entry.runner.threadID())
	return output, nil
}

func codexSummarizeSessionArgsForLog(args []string) string {
	if len(args) == 0 {
		return "(none)"
	}
	parts := make([]string, 0, 7)
	for i := 0; i < len(args) && len(parts) < 6; i++ {
		arg := strings.TrimSpace(args[i])
		if arg == "" {
			continue
		}
		if arg == "-c" {
			if i+1 >= len(args) {
				parts = append(parts, "-c")
				continue
			}
			parts = append(parts, "-c <config>")
			i++
			continue
		}
		if len(arg) > 64 {
			arg = arg[:61] + "..."
		}
		parts = append(parts, arg)
	}
	if len(args) > 6 {
		parts = append(parts, fmt.Sprintf("...(%d args total)", len(args)))
	}
	return strings.Join(parts, " ")
}

func codexAppServerBypassApprovalsAndSandboxEnabled() bool {
	return envEnabledByDefault(localCodexAppServerBypassEnv, true)
}

func codexAppServerReasoningEffortOverride() string {
	effort := strings.TrimSpace(strings.ToLower(os.Getenv(localCodexAppServerEffortEnv)))
	switch effort {
	case "":
		return ""
	case "minimal", "low", "medium", "high":
		return effort
	default:
		log.Printf("local-agent: ignoring invalid %s=%q (expected minimal|low|medium|high)\n", localCodexAppServerEffortEnv, effort)
		return ""
	}
}

func buildCodexAppServerSessionSpec(req *PostMessageRequest) (codexAppServerSessionSpec, error) {
	cmdName, args, err := resolveCodexAppServerCommand()
	if err != nil {
		return codexAppServerSessionSpec{}, err
	}
	args = append([]string{}, args...)
	bypassApprovalsAndSandbox := codexAppServerBypassApprovalsAndSandboxEnabled()
	reasoningEffort := codexAppServerReasoningEffortOverride()
	if reasoningEffort != "" {
		args = append([]string{
			"-c",
			fmt.Sprintf("model_reasoning_effort=%s", toTOMLString(reasoningEffort)),
		}, args...)
	}
	workingDir, wdErr := os.Getwd()
	if wdErr != nil {
		workingDir = ""
	}
	chatID := ""
	if req != nil {
		chatID = strings.TrimSpace(req.ChatID)
	}
	keyParts := append([]string{cmdName, workingDir, fmt.Sprintf("bypass=%t", bypassApprovalsAndSandbox)}, args...)
	log.Printf(
		"local-agent: codex app-server session spec chatid=%q cmd=%q cwd=%q arg_count=%d args=%s bypass=%v reasoning_effort=%q\n",
		chatID,
		cmdName,
		workingDir,
		len(args),
		codexSummarizeSessionArgsForLog(args),
		bypassApprovalsAndSandbox,
		reasoningEffort,
	)
	return codexAppServerSessionSpec{
		Req:                       req,
		ChatID:                    chatID,
		CmdName:                   cmdName,
		Args:                      args,
		WorkingDir:                workingDir,
		BypassApprovalsAndSandbox: bypassApprovalsAndSandbox,
		SessionKey:                strings.Join(keyParts, "\x00"),
	}, nil
}

func selectCodexTurnPrompt(input localAgentCodexTurnInputs, bootstrapped bool) string {
	bootstrap := strings.TrimSpace(input.BootstrapPrompt)
	incremental := strings.TrimSpace(input.IncrementalPrompt)
	if !bootstrapped && bootstrap != "" {
		return sanitizePromptForStdin(bootstrap)
	}
	if incremental != "" {
		return sanitizePromptForStdin(incremental)
	}
	if bootstrap != "" {
		return sanitizePromptForStdin(bootstrap)
	}
	return ""
}

func buildTerminalQuerySettingsInstructions(blockId string) string {
	templateStr := `You are running in Wave Terminal.
Current terminal block ID: {{.BlockID}}

## Available Tools
Use command execution to run real terminal commands. Prefer Wave RPC execution for terminal/system queries, and use wsh commands when you specifically need Wave-aware metadata or file operations.

### Core Commands
- Prefer direct shell commands for diagnostics and system inspection: lscpu, uname, ps, cat, top, df, free, lsblk, etc.
- For terminal/system queries, execute the real command first and base your answer on the actual output.
- Use this local Windows binary for Wave commands: ` + preferredWaveWSHPath + `
- Never run bare wsh inside the remote shell. Run ` + preferredWaveWSHPath + ` from the local Windows side.
- Read latest terminal output: ` + preferredWaveWSHPath + ` agent termscrollback -b {{.BlockID}} --lastcommand
- Get block metadata: ` + preferredWaveWSHPath + ` agent getmeta -b {{.BlockID}}
- Read file (local/remote): ` + preferredWaveWSHPath + ` file cat <path-or-uri>
- Write file from stdin: echo "content" | ` + preferredWaveWSHPath + ` file write <path-or-uri>
- Send to AI analysis: echo "content" | ` + preferredWaveWSHPath + ` ai -s -m "analyze this"
- Persistent variables: ` + preferredWaveWSHPath + ` setvar KEY=VALUE / ` + preferredWaveWSHPath + ` getvar KEY
- Run direct shell commands for diagnostics: lscpu, uname, ps, cat, top, etc.
- Create a new command block only when needed: ` + preferredWaveWSHPath + ` run -- <command>

### Current Block
Use "-b {{.BlockID}}" where supported.
For ordinary shell commands, execute directly in the current terminal session.

### Constraints
- File operations: max 10MB per operation
- Wave commands should go through ` + preferredWaveWSHPath + `
- Permissions handled automatically by Wave

### Important
- For terminal/system information requests, prefer real command execution over scrollback reads.
- Use scrollback mainly to inspect prior output or recover context, not as the primary substitute for command execution.
- Prefer wsh + real command output over invented tools
- Do NOT rely on legacy tool names; execute real commands instead
- Do NOT run direct ssh/scp from the local host for terminal-query tasks
- Do NOT answer terminal-query requests before executing commands
- If a command fails, report the real error briefly and try a fallback`
	data := struct {
		BlockID string
	}{
		BlockID: blockId,
	}
	var buf bytes.Buffer
	tmpl, err := template.New("codex-instructions").Parse(templateStr)
	if err != nil {
		log.Printf("local-agent: failed to parse codex instructions template: %v", err)
		return templateStr
	}
	if err := tmpl.Execute(&buf, data); err != nil {
		log.Printf("local-agent: failed to execute codex instructions template: %v", err)
		return templateStr
	}
	return buf.String()
}

func codexBuildThreadStartRequest(workingDir string, legacyEnums bool, bypassApprovalsAndSandbox bool) map[string]any {
	approvalPolicy := "unlessTrusted"
	sandbox := "workspaceWrite"
	if legacyEnums {
		approvalPolicy = "untrusted"
		sandbox = "workspace-write"
	}
	if bypassApprovalsAndSandbox {
		approvalPolicy = "never"
		if legacyEnums {
			sandbox = "danger-full-access"
		} else {
			sandbox = "dangerFullAccess"
		}
	}
	threadReq := map[string]any{
		"approvalPolicy": approvalPolicy,
		"sandbox":        sandbox,
		"serviceName":    "waveterm",
	}
	if strings.TrimSpace(workingDir) != "" {
		threadReq["cwd"] = workingDir
	}
	return threadReq
}

func codexInitializeUserAgent(initResp map[string]any) string {
	return codexJSONString(initResp, []string{"userAgent"})
}

func codexUserAgentPrefersLegacyEnums(userAgent string) bool {
	userAgent = strings.ToLower(strings.TrimSpace(userAgent))
	if userAgent == "" {
		return false
	}
	// Older app-server builds still advertise the vscode-flavored user agent
	// and only accept legacy thread/start enum spellings.
	return strings.Contains(userAgent, "codex_vscode/0.108.")
}

func codexShouldRetryThreadStartWithLegacyEnums(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	msg = strings.NewReplacer("`", "", "\"", "", "'", "").Replace(msg)
	if !strings.Contains(msg, "codex app-server thread/start failed") {
		return false
	}
	if !strings.Contains(msg, "invalid request") {
		return false
	}
	return strings.Contains(msg, "unknown variant unlesstrusted") ||
		strings.Contains(msg, "unknown variant workspacewrite") ||
		strings.Contains(msg, "unknown variant dangerfullaccess")
}

func codexThreadStartEnumModeLabel(legacy bool) string {
	if legacy {
		return "legacy"
	}
	return "modern"
}

func codexStartOrResumeThread(ctx context.Context, client *codexAppServerClient, workingDir string, resumeThreadID string, stderrText string, preferLegacyEnums bool, bypassApprovalsAndSandbox bool) (string, bool, error) {
	resumeThreadID = strings.TrimSpace(resumeThreadID)
	log.Printf(
		"local-agent: codex app-server thread handshake resume_thread=%q start_mode=%s bypass=%v cwd=%q\n",
		resumeThreadID,
		codexThreadStartEnumModeLabel(preferLegacyEnums),
		bypassApprovalsAndSandbox,
		strings.TrimSpace(workingDir),
	)
	if resumeThreadID != "" {
		log.Printf("local-agent: codex app-server attempting thread/resume threadid=%q\n", resumeThreadID)
		var resumeResp struct {
			Thread struct {
				ID string `json:"id"`
			} `json:"thread"`
		}
		if err := client.call(ctx, "thread/resume", map[string]any{"threadId": resumeThreadID}, &resumeResp); err == nil {
			threadID := strings.TrimSpace(resumeResp.Thread.ID)
			if threadID == "" {
				threadID = resumeThreadID
			}
			if threadID != "" {
				log.Printf("local-agent: codex app-server thread/resume succeeded threadid=%q\n", threadID)
				return threadID, true, nil
			}
		} else {
			log.Printf("local-agent: codex app-server thread/resume failed for %s: %v (falling back to thread/start)\n", resumeThreadID, err)
		}
	}

	var threadResp struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	startWithLegacy := preferLegacyEnums
	log.Printf("local-agent: codex app-server calling thread/start mode=%s\n", codexThreadStartEnumModeLabel(startWithLegacy))
	if err := client.call(ctx, "thread/start", codexBuildThreadStartRequest(workingDir, startWithLegacy, bypassApprovalsAndSandbox), &threadResp); err != nil {
		if codexShouldRetryThreadStartWithLegacyEnums(err) {
			log.Printf("local-agent: codex app-server rejected modern thread/start enums, retrying with legacy names: %v\n", err)
			startWithLegacy = true
			err = client.call(ctx, "thread/start", codexBuildThreadStartRequest(workingDir, true, bypassApprovalsAndSandbox), &threadResp)
		}
		if err != nil {
			return "", false, codexAppServerCommandError(err, stderrText)
		}
	}
	threadID := strings.TrimSpace(threadResp.Thread.ID)
	if threadID == "" {
		return "", false, codexAppServerCommandError(fmt.Errorf("codex app-server returned empty thread id"), stderrText)
	}
	log.Printf("local-agent: codex app-server thread/start succeeded threadid=%q mode=%s\n", threadID, codexThreadStartEnumModeLabel(startWithLegacy))
	return threadID, false, nil
}

func newCodexAppServerSession(ctx context.Context, _ *PostMessageRequest, spec codexAppServerSessionSpec, resumeThreadID string) (codexAppServerSessionRunner, error) {
	cmd := exec.Command(spec.CmdName, spec.Args...)
	cmd.Env = withLocalAgentPathEnv(os.Environ())
	jwtEnv, jwtErr := makeLocalAgentJWTEnv(spec.Req)
	if jwtErr != nil {
		return nil, jwtErr
	}
	for _, entry := range jwtEnv {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) == 2 {
			cmd.Env = withEnvVar(cmd.Env, parts[0], parts[1])
		}
	}
	if strings.TrimSpace(spec.WorkingDir) != "" {
		cmd.Dir = spec.WorkingDir
	}
	log.Printf(
		"local-agent: launching codex app-server cmd=%q cwd=%q arg_count=%d args=%s resume_thread=%q bypass=%v\n",
		spec.CmdName,
		strings.TrimSpace(spec.WorkingDir),
		len(spec.Args),
		codexSummarizeSessionArgsForLog(spec.Args),
		strings.TrimSpace(resumeThreadID),
		spec.BypassApprovalsAndSandbox,
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open codex app-server stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open codex app-server stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("open codex app-server stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start codex app-server: %w", err)
	}

	session := &codexAppServerSession{
		cmd:        cmd,
		stdin:      stdin,
		stderrDone: make(chan struct{}),
	}
	go func() {
		_, _ = io.Copy(&session.stderrBuf, stderr)
		close(session.stderrDone)
	}()
	client := newCodexAppServerClient(stdin, stdout)
	client.start()
	session.client = client

	defer func() {
		if err != nil {
			_ = session.close()
		}
	}()

	var initResp map[string]any
	if err = client.call(ctx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "waveterm",
			"title":   "Wave Terminal",
			"version": wavebase.WaveVersion,
		},
	}, &initResp); err != nil {
		return nil, codexAppServerCommandError(err, session.stderrBuf.String())
	}
	userAgent := codexInitializeUserAgent(initResp)
	preferLegacyEnums := codexUserAgentPrefersLegacyEnums(userAgent)
	log.Printf("local-agent: codex app-server initialize userAgent=%q prefer_legacy_enums=%v\n", userAgent, preferLegacyEnums)
	if err = client.notify(ctx, "initialized", map[string]any{}); err != nil {
		return nil, codexAppServerCommandError(err, session.stderrBuf.String())
	}

	threadID, bootstrapped, err := codexStartOrResumeThread(
		ctx,
		client,
		spec.WorkingDir,
		resumeThreadID,
		session.stderrBuf.String(),
		preferLegacyEnums,
		spec.BypassApprovalsAndSandbox,
	)
	if err != nil {
		return nil, err
	}
	log.Printf("local-agent: codex app-server thread ready threadid=%q resumed=%v\n", threadID, bootstrapped)
	session.stateMu.Lock()
	session.threadIDVal = threadID
	session.bootstrapped = bootstrapped
	session.stateMu.Unlock()
	return session, nil
}

func (s *codexAppServerSession) threadID() string {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.threadIDVal
}

func (s *codexAppServerSession) connectionError() error {
	if s == nil || s.client == nil {
		return io.EOF
	}
	return s.client.connectionError()
}

func (s *codexAppServerSession) close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		s.closeErr = codexShutdownAppServer(s.cmd, s.stdin, s.stderrDone)
	})
	return s.closeErr
}

func (s *codexAppServerSession) isBootstrapped() bool {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.bootstrapped
}

func (s *codexAppServerSession) setBootstrapped(bootstrapped bool) {
	s.stateMu.Lock()
	s.bootstrapped = bootstrapped
	s.stateMu.Unlock()
}

func (s *codexAppServerSession) runTurn(ctx context.Context, input localAgentCodexTurnInputs, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()

	if err := s.connectionError(); err != nil {
		return "", codexAppServerCommandError(fmt.Errorf("codex app-server connection unavailable: %w", err), s.stderrBuf.String())
	}
	threadID := strings.TrimSpace(s.threadID())
	if threadID == "" {
		return "", codexAppServerCommandError(fmt.Errorf("codex app-server thread is not initialized"), s.stderrBuf.String())
	}
	bootstrapped := s.isBootstrapped()
	prompt := selectCodexTurnPrompt(input, bootstrapped)
	if prompt == "" {
		return "", fmt.Errorf("codex turn prompt is empty")
	}

	var turnResp struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	turnStartParams := map[string]any{
		"threadId": threadID,
		"input": []map[string]any{{
			"type": "text",
			"text": prompt,
		}},
	}
	instructions := buildTerminalQuerySettingsInstructions(input.BlockId)
	turnStartParams["settings"] = map[string]any{
		"developer_instructions": instructions,
	}
	log.Printf("local-agent: codex app-server adding wsh instructions blockid=%q len=%d\n", strings.TrimSpace(input.BlockId), len(instructions))
	if err := s.client.call(ctx, "turn/start", turnStartParams, &turnResp); err != nil {
		return "", codexAppServerCommandError(err, s.stderrBuf.String())
	}
	if !bootstrapped {
		s.setBootstrapped(true)
	}

	sseHandler := localAgentSSEHandlerFromContext(ctx)
	state := newCodexAppServerTurnState(turnResp.Turn.ID)
	for {
		select {
		case msg := <-s.client.notifyCh:
			done, err := handleCodexAppServerNotification(ctx, s.client, sseHandler, msg, state, onDelta, onPhase)
			if err != nil {
				return state.output.String(), codexAppServerCommandError(err, s.stderrBuf.String())
			}
			if done {
				return state.output.String(), nil
			}
		case <-s.client.closedCh:
			return state.output.String(), codexAppServerCommandError(fmt.Errorf("codex app-server closed before turn completed: %w", s.connectionError()), s.stderrBuf.String())
		case <-ctx.Done():
			return state.output.String(), codexAppServerCommandError(ctx.Err(), s.stderrBuf.String())
		}
	}
}

func runCodexAppServerCommand(ctx context.Context, req *PostMessageRequest, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
	return defaultCodexAppServerSessionManager.runTurn(ctx, req, prompt, onDelta, onPhase)
}

func codexShutdownAppServer(cmd *exec.Cmd, stdin io.Closer, stderrDone <-chan struct{}) error {
	if stdin != nil {
		_ = stdin.Close()
	}
	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()
	select {
	case err := <-waitCh:
		if err == nil {
			<-stderrDone
			return nil
		}
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 0 {
			<-stderrDone
			return nil
		}
		<-stderrDone
		return nil
	case <-time.After(2 * time.Second):
		_ = cmd.Process.Kill()
		<-waitCh
		<-stderrDone
		return nil
	}
}

func codexAppServerCommandError(err error, stderrText string) error {
	if err == nil {
		return nil
	}
	stderrText = strings.TrimSpace(stderrText)
	if stderrText == "" {
		return err
	}
	return fmt.Errorf("%w (stderr: %s)", err, codexTruncateStatus(stderrText))
}
