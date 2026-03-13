// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

const (
	LocalProviderCodex      = "codex"
	LocalProviderClaudeCode = "claude-code"

	defaultLocalAgentTimeoutMs = 180000
	defaultLocalAgentIdleMs    = 30000
	localAgentOutputLimitBytes = 10 * 1024 * 1024
	localAgentTimeoutEnvName   = "WAVETERM_LOCAL_AGENT_TIMEOUT_MS"
	localAgentIdleEnvName      = "WAVETERM_LOCAL_AGENT_IDLE_TIMEOUT_MS"

	localCodexCmdEnvName          = "WAVETERM_LOCAL_AGENT_CODEX_CMD"
	localCodexAppServerCmdEnvName = "WAVETERM_LOCAL_AGENT_CODEX_APP_SERVER_CMD"
	localCodexUseAppServerEnvName = "WAVETERM_LOCAL_AGENT_CODEX_USE_APP_SERVER"
	localCodexAppServerBypassEnv  = "WAVETERM_LOCAL_AGENT_CODEX_APP_SERVER_BYPASS_APPROVALS_AND_SANDBOX"
	localCodexAppServerEffortEnv  = "WAVETERM_LOCAL_AGENT_CODEX_APP_SERVER_REASONING_EFFORT"
	localClaudeCmdEnvName         = "WAVETERM_LOCAL_AGENT_CLAUDE_CMD"
)

type LocalAgentHealthResponse struct {
	Ok        bool   `json:"ok"`
	Provider  string `json:"provider"`
	Available bool   `json:"available"`
	Message   string `json:"message"`
	Command   string `json:"command,omitempty"`
}

func normalizeLocalProvider(provider string) string {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case LocalProviderClaudeCode:
		return LocalProviderClaudeCode
	case LocalProviderCodex:
		return LocalProviderCodex
	default:
		return LocalProviderCodex
	}
}

func getLocalAgentTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv(localAgentTimeoutEnvName))
	if raw == "" {
		return defaultLocalAgentTimeoutMs * time.Millisecond
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return defaultLocalAgentTimeoutMs * time.Millisecond
	}
	return time.Duration(ms) * time.Millisecond
}

func getLocalAgentIdleTimeout(provider string, overallTimeout time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(localAgentIdleEnvName))
	if raw != "" {
		ms, err := strconv.Atoi(raw)
		if err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}

	if normalizeLocalProvider(provider) == LocalProviderCodex {
		if overallTimeout > 0 {
			return overallTimeout
		}
		return defaultLocalAgentTimeoutMs * time.Millisecond
	}
	return defaultLocalAgentIdleMs * time.Millisecond
}

func parseCommandOverride(raw string) (string, []string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil, false
	}
	parts := strings.Fields(raw)
	if len(parts) == 0 {
		return "", nil, false
	}
	return parts[0], parts[1:], true
}

func resolveLocalAgentCommand(provider string) (string, []string, error) {
	switch normalizeLocalProvider(provider) {
	case LocalProviderClaudeCode:
		if cmd, args, ok := parseCommandOverride(os.Getenv(localClaudeCmdEnvName)); ok {
			return cmd, args, nil
		}
		return "claude", []string{"-p", "--output-format", "text"}, nil
	case LocalProviderCodex:
		if cmd, args, ok := parseCommandOverride(os.Getenv(localCodexCmdEnvName)); ok {
			return cmd, args, nil
		}
		return "codex", []string{"exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "-c", "model_reasoning_effort=\"low\""}, nil
	default:
		return "", nil, fmt.Errorf("unsupported local provider: %s", provider)
	}
}

func resolveCodexAppServerCommand() (string, []string, error) {
	if cmd, args, ok := parseCommandOverride(os.Getenv(localCodexAppServerCmdEnvName)); ok {
		return cmd, args, nil
	}
	return "codex", []string{"app-server"}, nil
}

func shouldUseCodexAppServer() bool {
	return envEnabledByDefault(localCodexUseAppServerEnvName, true)
}

func envEnabledByDefault(envName string, defaultVal bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(envName)))
	if raw == "" {
		return defaultVal
	}
	switch raw {
	case "0", "false", "no", "off", "disable", "disabled":
		return false
	case "1", "true", "yes", "on", "enable", "enabled":
		return true
	default:
		return defaultVal
	}
}

func toTOMLString(raw string) string {
	quoted, err := json.Marshal(raw)
	if err != nil {
		return `""`
	}
	return string(quoted)
}

func checkLocalAgentHealth(provider string) LocalAgentHealthResponse {
	normalized := normalizeLocalProvider(provider)
	var (
		cmd string
		err error
	)
	if normalized == LocalProviderCodex && shouldUseCodexAppServer() {
		cmd, _, err = resolveCodexAppServerCommand()
	} else {
		cmd, _, err = resolveLocalAgentCommand(normalized)
	}
	if err != nil {
		return LocalAgentHealthResponse{
			Ok:        false,
			Provider:  normalized,
			Available: false,
			Message:   err.Error(),
		}
	}
	path, err := exec.LookPath(cmd)
	if err != nil {
		return LocalAgentHealthResponse{
			Ok:        true,
			Provider:  normalized,
			Available: false,
			Message:   fmt.Sprintf("command not found in PATH: %s", cmd),
			Command:   cmd,
		}
	}
	return LocalAgentHealthResponse{
		Ok:        true,
		Provider:  normalized,
		Available: true,
		Message:   "local agent command is available",
		Command:   path,
	}
}

func LocalAgentHealthHandler(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	health := checkLocalAgentHealth(provider)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(health)
}

func extractUserPromptText(msg uctypes.AIMessage) string {
	var sections []string
	for _, part := range msg.Parts {
		if part.Type == uctypes.AIMessagePartTypeText {
			text := strings.TrimSpace(part.Text)
			if text != "" {
				sections = append(sections, text)
			}
			continue
		}
		if part.Type != uctypes.AIMessagePartTypeFile {
			continue
		}
		fileName := part.FileName
		if fileName == "" {
			fileName = "(unnamed)"
		}
		metaLine := fmt.Sprintf("[Attachment] name=%s, type=%s, size=%d", fileName, part.MimeType, part.Size)
		sections = append(sections, metaLine)
		if part.MimeType == "text/plain" && len(part.Data) > 0 {
			fileText := strings.TrimSpace(string(part.Data))
			if fileText != "" {
				sections = append(sections, fmt.Sprintf("```text\n%s\n```", fileText))
			}
		}
	}
	return strings.TrimSpace(strings.Join(sections, "\n\n"))
}

type localPromptTurn struct {
	Role    string
	Content string
}

func localPromptRoleLabel(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "assistant":
		return "Assistant"
	case "system":
		return "System"
	default:
		return "User"
	}
}

func formatLocalPromptTurn(turn localPromptTurn) string {
	return fmt.Sprintf("%s:\n%s\n", localPromptRoleLabel(turn.Role), strings.TrimSpace(turn.Content))
}

func selectRecentTurnsWithinBudget(history []localPromptTurn, maxTokens int) []localPromptTurn {
	if len(history) == 0 {
		return nil
	}
	var selected []localPromptTurn
	usedTokens := 0
	for i := len(history) - 1; i >= 0; i-- {
		turn := history[i]
		turnText := formatLocalPromptTurn(turn)
		turnTokens := estimateTokens(turnText)
		// Always keep the newest turn so prompt continuity does not fully reset.
		if len(selected) == 0 {
			selected = append(selected, turn)
			usedTokens += turnTokens
			continue
		}
		if usedTokens+turnTokens > maxTokens {
			continue
		}
		selected = append(selected, turn)
		usedTokens += turnTokens
	}
	// reverse back to chronological order
	for i, j := 0, len(selected)-1; i < j; i, j = i+1, j-1 {
		selected[i], selected[j] = selected[j], selected[i]
	}
	return selected
}

func buildLocalAgentPromptWithModeAndBudget(userText string, tabState string, history []localPromptTurn, maxPromptTokens int, mode AgentMode) string {
	if strings.TrimSpace(userText) == "" {
		userText = "(no user text)"
	}
	systemBlock := "You are Wave Local Agent. Follow the user's request exactly.\n" +
		"If the user writes Chinese, answer in Chinese.\n" +
		"Prefer concise, actionable output.\n" +
		"\n" +
		"CRITICAL TERMINAL QUERY RULES:\n" +
		"When the user asks about system information (CPU, memory, disk, processes, network, files, etc.), you MUST:\n" +
		"1. Execute real terminal commands and use their actual output in your answer\n" +
		"2. Prefer Wave-aware wsh commands when helpful (wsh getmeta, wsh termscrollback, wsh file ...)\n" +
		"3. Use direct shell commands (lscpu, uname, ps, cat, etc.) when that is faster\n" +
		"4. If one command fails, try a fallback command and report the real error briefly\n" +
		"5. Format and present the result to the user\n" +
		"\n" +
		"DO NOT:\n" +
		"- Reply with refusal text before attempting command execution\n" +
		"- Invent non-existent tools or rely on tool-discovery detours\n" +
		"- Claim \"host policy blocked\" or \"no terminal access\" without an actual command error\n" +
		"- Use direct ssh/scp from the local host for terminal-query tasks\n" +
		"- Ask the user to run commands manually when command execution is available\n" +
		"- Output shell code blocks as a substitute for executing commands\n" +
		"- Dump internal debugging traces unless the user explicitly asked for debugging\n" +
		"\n" +
		"Example workflow:\n" +
		"User: 帮我查询 CPU 型号\n" +
		"Assistant: [executes `lscpu | grep 'Model name' || sysctl -n machdep.cpu.brand_string`]\n" +
		"CPU 型号: Intel Core i7-9700K\n" +
		"\n" +
		"Prefer `wsh termscrollback --lastcommand` when you need the latest terminal output.\n" +
		"`wsh file write` expects content from stdin, e.g. `echo \"hello\" | wsh file write ./note.txt`.\n" +
		"If command execution fails, summarize the failure in one short sentence instead of narrating internal debugging.\n" +
		getModeAwareSystemPromptText(true, "", mode) + "\n"
	tabBlock := ""
	if strings.TrimSpace(tabState) != "" {
		tabBlock = "Current workspace context:\n" + tabState + "\n"
	}
	userBlock := "User request:\n" + userText + "\n"

	if maxPromptTokens <= 0 {
		maxPromptTokens = defaultLocalPromptTokenBudget
	}
	baseTokens := estimateTokens(systemBlock) + estimateTokens(tabBlock) + estimateTokens(userBlock)
	historyBudget := maxPromptTokens - baseTokens
	if historyBudget < 0 {
		historyBudget = 0
	}
	selectedHistory := selectRecentTurnsWithinBudget(history, historyBudget)

	var sb strings.Builder
	sb.WriteString(systemBlock)
	if tabBlock != "" {
		sb.WriteString("\n")
		sb.WriteString(tabBlock)
	}
	if len(selectedHistory) > 0 {
		sb.WriteString("\nRecent conversation:\n")
		for _, turn := range selectedHistory {
			sb.WriteString(formatLocalPromptTurn(turn))
		}
	}
	sb.WriteString("\n")
	sb.WriteString(userBlock)
	return sb.String()
}

func extractStoredChatText(msg *openaichat.StoredChatMessage) string {
	if msg == nil {
		return ""
	}
	if len(msg.Message.ContentParts) > 0 {
		parts := make([]string, 0, len(msg.Message.ContentParts))
		for _, part := range msg.Message.ContentParts {
			if part.Type != "text" {
				continue
			}
			text := strings.TrimSpace(part.Text)
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n\n"))
	}
	return strings.TrimSpace(msg.Message.Content)
}

func buildLocalPromptHistoryTurns(chatID string, currentMessageID string) []localPromptTurn {
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		return nil
	}
	history := make([]localPromptTurn, 0, len(chat.NativeMessages))
	for _, native := range chat.NativeMessages {
		msg, ok := native.(*openaichat.StoredChatMessage)
		if !ok || msg == nil {
			continue
		}
		if msg.MessageId == currentMessageID {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(msg.Message.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := extractStoredChatText(msg)
		if content == "" {
			continue
		}
		history = append(history, localPromptTurn{
			Role:    role,
			Content: content,
		})
	}
	return history
}

func buildLocalAgentPromptWithBudget(userText string, tabState string, history []localPromptTurn, maxPromptTokens int) string {
	return buildLocalAgentPromptWithModeAndBudget(userText, tabState, history, maxPromptTokens, AgentModeDefault)
}

func buildLocalAgentPrompt(userText string, tabState string, history []localPromptTurn) string {
	return buildLocalAgentPromptWithBudget(userText, tabState, history, getLocalPromptTokenBudget())
}

func sanitizePromptForStdin(prompt string) string {
	if utf8.ValidString(prompt) {
		return prompt
	}
	return strings.ToValidUTF8(prompt, "\uFFFD")
}

type localAgentStreamChunk struct {
	source string
	text   string
	err    error
}

type localAgentLoopPhase struct {
	ToolName   string
	StatusLine string
}

type localAgentSSEHandlerContextKey struct{}

type localAgentCodexTurnInputsContextKey struct{}

type localAgentAgentModeContextKey struct{}

type localAgentCodexTurnInputs struct {
	BootstrapPrompt   string
	IncrementalPrompt string
	UserText          string
	IsTerminalQuery   bool
	BlockId           string
}

var localAgentTerminalRetrySentinel = "You must execute real terminal commands (prefer wsh) on this retry."

type localAgentCommandRunner func(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error)

var runLocalAgentCommandFn localAgentCommandRunner = runLocalAgentCommand

type utf8StreamDecoder struct {
	pending []byte
}

func (d *utf8StreamDecoder) Decode(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	buf := append(append([]byte{}, d.pending...), data...)
	d.pending = d.pending[:0]

	var out strings.Builder
	for len(buf) > 0 {
		r, size := utf8.DecodeRune(buf)
		if r == utf8.RuneError && size == 1 {
			if !utf8.FullRune(buf) {
				d.pending = append(d.pending, buf...)
				break
			}
			out.WriteRune('\uFFFD')
			buf = buf[1:]
			continue
		}
		out.WriteRune(r)
		buf = buf[size:]
	}
	return out.String()
}

func (d *utf8StreamDecoder) Flush() string {
	if len(d.pending) == 0 {
		return ""
	}
	out := strings.ToValidUTF8(string(d.pending), "\uFFFD")
	d.pending = nil
	return out
}

func streamPipeToChannel(reader io.Reader, source string, out chan<- localAgentStreamChunk) {
	decoder := &utf8StreamDecoder{}
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			text := decoder.Decode(buf[:n])
			if text != "" {
				out <- localAgentStreamChunk{source: source, text: text}
			}
		}
		if err == io.EOF {
			if tail := decoder.Flush(); tail != "" {
				out <- localAgentStreamChunk{source: source, text: tail}
			}
			return
		}
		if err != nil {
			if isExpectedPipeCloseError(err) {
				if tail := decoder.Flush(); tail != "" {
					out <- localAgentStreamChunk{source: source, text: tail}
				}
				return
			}
			out <- localAgentStreamChunk{source: source, err: fmt.Errorf("read %s: %w", source, err)}
			return
		}
	}
}

func isExpectedPipeCloseError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrClosed) || errors.Is(err, io.ErrClosedPipe) {
		return true
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(msg, "file already closed") || strings.Contains(msg, "closed pipe")
}

func resetTimer(timer *time.Timer, dur time.Duration) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(dur)
}

func runLocalAgentCommand(ctx context.Context, req *PostMessageRequest, provider string, prompt string, onDelta func(string), onPhase func(localAgentLoopPhase)) (string, error) {
	normalizedProvider := normalizeLocalProvider(provider)
	if normalizedProvider == LocalProviderCodex && shouldUseCodexAppServer() {
		return runCodexAppServerCommand(ctx, req, prompt, onDelta, onPhase)
	}

	cmdName, args, err := resolveLocalAgentCommand(provider)
	if err != nil {
		return "", err
	}
	suppressLiveOutput := false
	lastMessagePath := ""
	switch normalizedProvider {
	case LocalProviderClaudeCode:
	case LocalProviderCodex:
		// Codex CLI emits operational diagnostics (session headers, feature deprecation, tool/runtime logs)
		// to stdout/stderr in text mode. Capture the final assistant message in a temp file and suppress
		// live deltas so the UI shows only the actual answer text.
		tmpFile, tmpErr := os.CreateTemp("", "waveterm-codex-last-message-*.txt")
		if tmpErr == nil {
			lastMessagePath = tmpFile.Name()
			_ = tmpFile.Close()
			defer os.Remove(lastMessagePath)
			args = append(args, "--color", "never", "--output-last-message", lastMessagePath)
			suppressLiveOutput = true
		} else {
			log.Printf("local-agent: failed to create codex output temp file: %v\n", tmpErr)
		}
	}
	timeout := getLocalAgentTimeout()
	idleTimeout := getLocalAgentIdleTimeout(normalizedProvider, timeout)
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt = sanitizePromptForStdin(prompt)
	cmd := exec.CommandContext(runCtx, cmdName, args...)
	cmd.Stdin = strings.NewReader(prompt)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("open stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("open stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}

	streamCh := make(chan localAgentStreamChunk, 32)
	var streamWG sync.WaitGroup
	streamWG.Add(2)
	go func() {
		defer streamWG.Done()
		streamPipeToChannel(stdoutPipe, "stdout", streamCh)
	}()
	go func() {
		defer streamWG.Done()
		streamPipeToChannel(stderrPipe, "stderr", streamCh)
	}()
	go func() {
		streamWG.Wait()
		close(streamCh)
	}()

	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()

	var outputBuilder strings.Builder
	var stderrBuilder strings.Builder
	var streamErr error
	outputBytes := 0
	idleTimer := time.NewTimer(idleTimeout)
	defer idleTimer.Stop()

	for streamCh != nil || waitCh != nil {
		select {
		case streamChunk, ok := <-streamCh:
			if !ok {
				streamCh = nil
				continue
			}
			if streamChunk.err != nil {
				if streamErr == nil {
					streamErr = streamChunk.err
				}
				continue
			}
			if streamChunk.text == "" {
				continue
			}
			outputBytes += len(streamChunk.text)
			if outputBytes > localAgentOutputLimitBytes {
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
				return strings.TrimSpace(outputBuilder.String()), fmt.Errorf("local agent output exceeded %d bytes", localAgentOutputLimitBytes)
			}
			if streamChunk.source == "stdout" {
				outputBuilder.WriteString(streamChunk.text)
			} else {
				stderrBuilder.WriteString(streamChunk.text)
			}
			if streamChunk.source == "stdout" && onDelta != nil && !suppressLiveOutput {
				onDelta(streamChunk.text)
			}
			resetTimer(idleTimer, idleTimeout)
		case waitErr := <-waitCh:
			waitCh = nil
			err = waitErr
		case <-idleTimer.C:
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			return strings.TrimSpace(outputBuilder.String()), fmt.Errorf("local agent inactivity timeout after %s", idleTimeout)
		}
	}

	out := strings.TrimSpace(outputBuilder.String())
	errOut := strings.TrimSpace(stderrBuilder.String())
	if lastMessagePath != "" {
		if lastMessageBytes, readErr := os.ReadFile(lastMessagePath); readErr == nil {
			lastMessage := strings.TrimSpace(string(lastMessageBytes))
			if lastMessage != "" {
				out = lastMessage
			}
		}
	}
	if streamErr != nil {
		return out, streamErr
	}
	if err != nil {
		if runCtx.Err() == context.DeadlineExceeded {
			return out, fmt.Errorf("local agent timeout after %s", timeout)
		}
		if errOut != "" {
			return out, fmt.Errorf("%v: %s", err, errOut)
		}
		return out, err
	}
	if out == "" {
		if errOut != "" {
			return "", fmt.Errorf("local agent returned empty output: %s", errOut)
		}
		return "", fmt.Errorf("local agent returned empty output")
	}
	return out, nil
}

func emitLocalAgentLoopPhase(sseHandler *sse.SSEHandlerCh, phase localAgentLoopPhase) {
	if sseHandler == nil {
		return
	}
	toolName := strings.TrimSpace(phase.ToolName)
	if toolName == "" {
		return
	}
	statusLine := strings.TrimSpace(phase.StatusLine)
	statusLines := []string{}
	if statusLine != "" {
		statusLines = append(statusLines, statusLine)
	}
	_ = sseHandler.AiMsgData("data-toolprogress", "localagent:"+toolName, map[string]any{
		"toolcallid":  "localagent:" + toolName,
		"toolname":    toolName,
		"statuslines": statusLines,
	})
}

func emitLocalAgentToolUse(sseHandler *sse.SSEHandlerCh, toolUseData uctypes.UIMessageDataToolUse) {
	if sseHandler == nil || strings.TrimSpace(toolUseData.ToolCallId) == "" {
		return
	}
	_ = sseHandler.AiMsgData("data-tooluse", toolUseData.ToolCallId, toolUseData)
}

func localAgentContextWithSSEHandler(ctx context.Context, sseHandler *sse.SSEHandlerCh) context.Context {
	if ctx == nil || sseHandler == nil {
		return ctx
	}
	return context.WithValue(ctx, localAgentSSEHandlerContextKey{}, sseHandler)
}

func localAgentSSEHandlerFromContext(ctx context.Context) *sse.SSEHandlerCh {
	if ctx == nil {
		return nil
	}
	h, _ := ctx.Value(localAgentSSEHandlerContextKey{}).(*sse.SSEHandlerCh)
	return h
}

func localAgentContextWithCodexTurnInputs(ctx context.Context, inputs localAgentCodexTurnInputs) context.Context {
	if ctx == nil {
		return ctx
	}
	return context.WithValue(ctx, localAgentCodexTurnInputsContextKey{}, inputs)
}

func localAgentCodexTurnInputsFromContext(ctx context.Context) (localAgentCodexTurnInputs, bool) {
	if ctx == nil {
		return localAgentCodexTurnInputs{}, false
	}
	inputs, ok := ctx.Value(localAgentCodexTurnInputsContextKey{}).(localAgentCodexTurnInputs)
	if !ok {
		return localAgentCodexTurnInputs{}, false
	}
	return inputs, true
}

func localAgentContextWithAgentMode(ctx context.Context, mode AgentMode) context.Context {
	if ctx == nil {
		return ctx
	}
	return context.WithValue(ctx, localAgentAgentModeContextKey{}, resolveAgentMode(string(mode)))
}

func localAgentAgentModeFromContext(ctx context.Context) (AgentMode, bool) {
	if ctx == nil {
		return AgentModeDefault, false
	}
	mode, ok := ctx.Value(localAgentAgentModeContextKey{}).(AgentMode)
	if !ok {
		return AgentModeDefault, false
	}
	return resolveAgentMode(string(mode)), true
}

func emitAssistantTextMessage(sseHandler *sse.SSEHandlerCh, msgID string, text string) {
	textID := uuid.New().String()
	_ = sseHandler.AiMsgStart(msgID)
	_ = sseHandler.AiMsgStartStep()
	_ = sseHandler.AiMsgTextStart(textID)

	runes := []rune(text)
	const chunkSize = 300
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		_ = sseHandler.AiMsgTextDelta(textID, string(runes[i:end]))
	}

	_ = sseHandler.AiMsgTextEnd(textID)
	_ = sseHandler.AiMsgFinishStep()
	_ = sseHandler.AiMsgFinish("stop", nil)
}

func isTerminalToolPhase(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "codex_command_execution",
		"term_get_scrollback",
		"term_command_output":
		return true
	default:
		return false
	}
}

func isTerminalQueryRequest(userText string) bool {
	text := strings.ToLower(strings.TrimSpace(userText))
	if text == "" {
		return false
	}
	keywords := []string{
		"cpu", "memory", "disk", "process", "network", "查询", "查看", "检查",
		"温度", "频率", "型号", "使用率", "运行", "状态", "列出", "显示",
		"ls", "ps", "top", "df", "free", "lscpu", "uname", "ifconfig", "netstat",
	}
	for _, keyword := range keywords {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}

func localAgentClaimsTerminalBlock(output string) bool {
	text := strings.ToLower(strings.TrimSpace(output))
	if text == "" {
		return false
	}
	phrases := []string{
		"host policy blocked",
		"blocked by host policy",
		"refused to execute",
		"context deadline exceeded",
		"windows sandbox",
		"宿主策略直接拦了",
		"被宿主策略拦了",
		"被拒绝执行",
		"拒绝执行",
		"超时",
		"沙箱",
	}
	for _, phrase := range phrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

func localAgentLooksLikeInternalToolDebug(output string) bool {
	text := strings.ToLower(strings.TrimSpace(output))
	if text == "" {
		return false
	}
	phrases := []string{
		"createprocess",
		"createprocesswithlogonw",
		"codex action failed",
		"当前会话里没有暴露",
		"没有暴露可调用的",
	}
	for _, phrase := range phrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

func localAgentSummarizeRuntimeError(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "unknown error"
	}
	msgLower := strings.ToLower(msg)
	if strings.Contains(msgLower, "context deadline exceeded") {
		return "context deadline exceeded"
	}
	if strings.Contains(msgLower, "windows sandbox") {
		return "windows sandbox blocked command execution"
	}
	msg = strings.ReplaceAll(msg, "\n", " ")
	msg = strings.TrimSpace(msg)
	if len(msg) > 180 {
		return msg[:177] + "..."
	}
	return msg
}

func localAgentShouldCompressTerminalErrorOutput(output string, runErr error) bool {
	if runErr == nil {
		return false
	}
	errText := strings.ToLower(strings.TrimSpace(runErr.Error()))
	if strings.Contains(errText, "context deadline exceeded") ||
		strings.Contains(errText, "windows sandbox") ||
		strings.Contains(errText, "createprocesswithlogonw") {
		return true
	}
	if localAgentLooksLikeInternalToolDebug(output) || localAgentClaimsTerminalBlock(output) {
		return true
	}
	text := strings.ToLower(strings.TrimSpace(output))
	if text == "" {
		return true
	}
	return strings.Contains(text, "我先直接在远程终端") ||
		strings.Contains(text, "下一步我会") ||
		strings.Contains(text, "我会检查本机可用的 ssh")
}

func buildLocalAgentTerminalFailureSummary(userText string) string {
	if strings.ContainsAny(userText, "帮我查询查看读取终端远程温度频率型号系统信息主机表格") {
		return "未能通过当前终端执行命令完成这次查询。模型没有拿到可用命令输出，或终端连接/权限仍有异常；请稍后重试。"
	}
	return "I couldn't complete this terminal query from real command output. Command execution did not return usable results, or terminal access is still unhealthy. Please retry."
}

func localAgentHasTerminalToolPhase(observedPhases []localAgentLoopPhase) bool {
	for _, phase := range observedPhases {
		if isTerminalToolPhase(phase.ToolName) {
			return true
		}
	}
	return false
}

func shouldRetryLocalAgentTerminalAttempt(mode AgentMode, prompt string, userText string, output string, observedPhases []localAgentLoopPhase) bool {
	if mode == AgentModePlanning {
		return false
	}
	if strings.Contains(prompt, localAgentTerminalRetrySentinel) {
		return false
	}
	// 如果用户请求明显是 terminal query，但模型没有调用任何 terminal tool，强制重试
	if isTerminalQueryRequest(userText) {
		hasTerminalToolCall := false
		for _, phase := range observedPhases {
			if isTerminalToolPhase(phase.ToolName) {
				hasTerminalToolCall = true
				break
			}
		}
		if !hasTerminalToolCall {
			return true
		}
	}
	// 如果模型编造了"宿主拦截"的理由，但实际上没有调用工具，也重试
	if !localAgentClaimsTerminalBlock(output) {
		return false
	}
	for _, phase := range observedPhases {
		if isTerminalToolPhase(phase.ToolName) {
			return false
		}
	}
	return true
}

func buildLocalAgentTerminalRetryPrompt(prompt string) string {
	return strings.TrimSpace(prompt + "\n\n" +
		"RETRY INSTRUCTION:\n" +
		localAgentTerminalRetrySentinel + "\n" +
		"Your previous response did NOT execute any terminal command.\n" +
		"You MUST execute at least one real command and use its output.\n" +
		"Prefer wsh commands in Wave (for example: wsh getmeta -b this, wsh termscrollback --lastcommand).\n" +
		"Use direct shell commands when needed (for example: lscpu, uname, cat, ps).\n" +
		"Do NOT run ssh/scp directly from the local host for this task.\n" +
		"Do NOT spend turns probing tool registries or capability listings.\n" +
		"Do NOT claim \"host policy blocked\" or \"no terminal access\" unless command execution actually returned that error.\n" +
		"Your final response will be rejected unless at least one command execution attempt is observed.\n" +
		"If command execution fails, report one short user-facing sentence with the actual command error.\n")
}

func WaveAILocalAgentPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, req *PostMessageRequest, chatOpts uctypes.WaveChatOpts) error {
	if err := sseHandler.SetupSSE(); err != nil {
		return fmt.Errorf("failed to setup SSE: %w", err)
	}

	userMsg, err := openaichat.ConvertAIMessageToStoredChatMessage(req.Msg)
	if err != nil {
		return fmt.Errorf("failed to convert user message: %w", err)
	}
	if err := chatstore.DefaultChatStore.PostMessage(req.ChatID, &chatOpts.Config, userMsg); err != nil {
		return fmt.Errorf("failed to store local user message: %w", err)
	}

	userText := extractUserPromptText(req.Msg)
	if userText == "" {
		userText = "(no user text)"
	}
	history := buildLocalPromptHistoryTurns(req.ChatID, req.Msg.MessageId)
	prompt := buildLocalAgentPromptWithModeAndBudget(userText, chatOpts.TabState, history, getLocalPromptTokenBudget(), resolveAgentMode(chatOpts.AgentMode))
	provider := normalizeLocalProvider(req.LocalProvider)
	log.Printf("local-agent provider=%s chatid=%s widgetaccess=%v\n", provider, req.ChatID, req.WidgetAccess)
	ctx = localAgentContextWithSSEHandler(ctx, sseHandler)
	isTerminalQuery := isTerminalQueryRequest(userText)
	ctx = localAgentContextWithCodexTurnInputs(ctx, localAgentCodexTurnInputs{
		BootstrapPrompt:   prompt,
		IncrementalPrompt: userText,
		UserText:          userText,
		IsTerminalQuery:   isTerminalQuery,
		BlockId:           req.BlockId,
	})
	ctx = localAgentContextWithAgentMode(ctx, resolveAgentMode(chatOpts.AgentMode))

	msgID := uuid.New().String()
	textID := uuid.New().String()
	_ = sseHandler.AiMsgStart(msgID)
	_ = sseHandler.AiMsgStartStep()
	_ = sseHandler.AiMsgTextStart(textID)
	emittedDelta := false
	observedPhases := make([]localAgentLoopPhase, 0, 8)

	runOutput, runErr := runLocalAgentCommandFn(ctx, req, provider, prompt, func(delta string) {
		if strings.TrimSpace(delta) == "" {
			return
		}
		emittedDelta = true
		_ = sseHandler.AiMsgTextDelta(textID, delta)
	}, func(phase localAgentLoopPhase) {
		observedPhases = append(observedPhases, phase)
		emitLocalAgentLoopPhase(sseHandler, phase)
	})
	if shouldRetryLocalAgentTerminalAttempt(resolveAgentMode(chatOpts.AgentMode), prompt, userText, runOutput, observedPhases) {
		retryPrompt := buildLocalAgentTerminalRetryPrompt(prompt)
		observedPhases = observedPhases[:0]
		retryCtx := localAgentContextWithCodexTurnInputs(ctx, localAgentCodexTurnInputs{
			BootstrapPrompt:   retryPrompt,
			IncrementalPrompt: retryPrompt,
			UserText:          userText,
			IsTerminalQuery:   isTerminalQuery,
			BlockId:           req.BlockId,
		})
		runOutput, runErr = runLocalAgentCommandFn(retryCtx, req, provider, retryPrompt, func(delta string) {
			if strings.TrimSpace(delta) == "" {
				return
			}
			emittedDelta = true
			_ = sseHandler.AiMsgTextDelta(textID, delta)
		}, func(phase localAgentLoopPhase) {
			observedPhases = append(observedPhases, phase)
			emitLocalAgentLoopPhase(sseHandler, phase)
		})
	}
	hasTerminalToolCall := localAgentHasTerminalToolPhase(observedPhases)
	if isTerminalQueryRequest(userText) && !hasTerminalToolCall && (localAgentLooksLikeInternalToolDebug(runOutput) || localAgentClaimsTerminalBlock(runOutput)) {
		log.Printf("local-agent: terminal query produced no command-execution phases and only internal/debug output; replacing response with failure summary\n")
		runOutput = buildLocalAgentTerminalFailureSummary(userText)
	}
	output := runOutput
	if runErr != nil {
		compressTerminalErr := isTerminalQuery && localAgentShouldCompressTerminalErrorOutput(output, runErr)
		if compressTerminalErr {
			output = buildLocalAgentTerminalFailureSummary(userText)
		}
		if !emittedDelta && strings.TrimSpace(output) != "" {
			_ = sseHandler.AiMsgTextDelta(textID, output)
			emittedDelta = true
		}
		errSummary := localAgentSummarizeRuntimeError(runErr)
		if errSummary == "" {
			errSummary = runErr.Error()
		}
		errMsg := fmt.Sprintf("\n\nLocal Agent (%s) failed: %s", provider, errSummary)
		_ = sseHandler.AiMsgTextDelta(textID, errMsg)
		output = strings.TrimSpace(output + errMsg)
		_ = sseHandler.AiMsgTextEnd(textID)
		_ = sseHandler.AiMsgFinishStep()
		_ = sseHandler.AiMsgFinish("stop", nil)
		assistantMsg := &openaichat.StoredChatMessage{
			MessageId: msgID,
			Message: openaichat.ChatRequestMessage{
				Role:    "assistant",
				Content: output,
			},
		}
		_ = chatstore.DefaultChatStore.PostMessage(req.ChatID, &chatOpts.Config, assistantMsg)
		return nil
	}
	if !emittedDelta && strings.TrimSpace(output) != "" {
		_ = sseHandler.AiMsgTextDelta(textID, output)
	}

	_ = sseHandler.AiMsgTextEnd(textID)
	_ = sseHandler.AiMsgFinishStep()
	_ = sseHandler.AiMsgFinish("stop", nil)
	assistantMsg := &openaichat.StoredChatMessage{
		MessageId: msgID,
		Message: openaichat.ChatRequestMessage{
			Role:    "assistant",
			Content: output,
		},
	}
	if err := chatstore.DefaultChatStore.PostMessage(req.ChatID, &chatOpts.Config, assistantMsg); err != nil {
		return fmt.Errorf("failed to store local assistant message: %w", err)
	}
	return nil
}
