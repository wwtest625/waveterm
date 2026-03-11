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
	"time"

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
			if err == io.EOF {
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
	output strings.Builder
	turnID string
	items  map[string]*codexAppServerItemState
}

type codexAppServerItemState struct {
	ItemID      string
	ItemType    string
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
		case "mcpToolCall":
			toolName := codexJSONString(params, []string{"item", "toolName"}, []string{"item", "server", "name"})
			if toolName == "" {
				toolName = "mcp tool"
			}
			codexEmitPhase(onPhase, "codex_mcp_tool", toolName)
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

func runCodexAppServerCommand(ctx context.Context, req *PostMessageRequest, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
	cmdName, args, err := resolveCodexAppServerCommand()
	if err != nil {
		return "", err
	}
	if envEnabledByDefault(localCodexEnableMcpEnvName, true) {
		codexMCPArgs, mcpErr := createCodexMCPConfigArgs(req)
		if mcpErr != nil {
			log.Printf("local-agent: wave mcp disabled for codex app-server, config build failed: %v\n", mcpErr)
		} else {
			args = append(codexMCPArgs, args...)
		}
	}

	timeout := getLocalAgentTimeout()
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, cmdName, args...)
	workingDir, wdErr := os.Getwd()
	if wdErr == nil && strings.TrimSpace(workingDir) != "" {
		cmd.Dir = workingDir
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("open codex app-server stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("open codex app-server stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("open codex app-server stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start codex app-server: %w", err)
	}
	var stderrBuf bytes.Buffer
	stderrDone := make(chan struct{})
	shutdownDone := false
	defer func() {
		if !shutdownDone {
			_ = codexShutdownAppServer(cmd, stdin, stderrDone)
		}
	}()
	go func() {
		_, _ = io.Copy(&stderrBuf, stderr)
		close(stderrDone)
	}()

	client := newCodexAppServerClient(stdin, stdout)
	client.start()
	codexEmitPhase(onPhase, "codex_thinking", "Starting Codex app-server")

	var initResp map[string]any
	if err := client.call(runCtx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "waveterm",
			"title":   "Wave Terminal",
			"version": wavebase.WaveVersion,
		},
	}, &initResp); err != nil {
		return "", codexAppServerCommandError(err, stderrBuf.String())
	}
	if err := client.notify(runCtx, "initialized", map[string]any{}); err != nil {
		return "", codexAppServerCommandError(err, stderrBuf.String())
	}

	threadReq := map[string]any{
		"approvalPolicy": "unlessTrusted",
		"sandbox":        "workspaceWrite",
		"serviceName":    "waveterm",
	}
	if workingDir != "" {
		threadReq["cwd"] = workingDir
	}
	var threadResp struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := client.call(runCtx, "thread/start", threadReq, &threadResp); err != nil {
		return "", codexAppServerCommandError(err, stderrBuf.String())
	}
	if strings.TrimSpace(threadResp.Thread.ID) == "" {
		return "", codexAppServerCommandError(fmt.Errorf("codex app-server returned empty thread id"), stderrBuf.String())
	}

	var turnResp struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := client.call(runCtx, "turn/start", map[string]any{
		"threadId": threadResp.Thread.ID,
		"input": []map[string]any{{
			"type": "text",
			"text": prompt,
		}},
	}, &turnResp); err != nil {
		return "", codexAppServerCommandError(err, stderrBuf.String())
	}

	sseHandler := localAgentSSEHandlerFromContext(ctx)
	state := newCodexAppServerTurnState(turnResp.Turn.ID)
	for {
		select {
		case msg := <-client.notifyCh:
			done, err := handleCodexAppServerNotification(runCtx, client, sseHandler, msg, state, onDelta, onPhase)
			if err != nil {
				return state.output.String(), codexAppServerCommandError(err, stderrBuf.String())
			}
			if done {
				shutdownErr := codexShutdownAppServer(cmd, stdin, stderrDone)
				shutdownDone = true
				return state.output.String(), shutdownErr
			}
		case <-client.closedCh:
			return state.output.String(), codexAppServerCommandError(fmt.Errorf("codex app-server closed before turn completed: %w", client.connectionError()), stderrBuf.String())
		case <-runCtx.Done():
			return state.output.String(), codexAppServerCommandError(runCtx.Err(), stderrBuf.String())
		}
	}
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
