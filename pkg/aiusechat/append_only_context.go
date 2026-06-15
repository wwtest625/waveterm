// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// ---------------------------------------------------------------------------
// StablePrefix — frozen system prompt + tool spec snapshot
// ---------------------------------------------------------------------------

// StablePrefixSnapshot holds a frozen copy of system prompt and tool definitions
// along with a fingerprint for change detection.
type StablePrefixSnapshot struct {
	SystemPrompt []string
	Tools        []uctypes.ToolDefinition
	Fingerprint  string
}

// StablePrefix caches the system prompt and tools so that the byte prefix
// sent to the LLM stays stable across turns. This maximizes provider
// prefix-cache hits (DeepSeek, Anthropic, OpenAI all support this).
type StablePrefix struct {
	snapshot    *StablePrefixSnapshot
	version     int
}

// Fingerprint returns the current fingerprint, or "<unbuilt>" if never built.
func (sp *StablePrefix) Fingerprint() string {
	if sp.snapshot == nil {
		return "<unbuilt>"
	}
	return sp.snapshot.Fingerprint
}

// Version returns the number of times the prefix has been rebuilt.
func (sp *StablePrefix) Version() int {
	return sp.version
}

// Built returns whether the prefix has been built at least once.
func (sp *StablePrefix) Built() bool {
	return sp.snapshot != nil
}

// Build creates or updates the snapshot from the current system prompt and tools.
// Returns true if the prefix actually changed (cache miss imminent).
func (sp *StablePrefix) Build(systemPrompt []string, tools []uctypes.ToolDefinition) bool {
	snapshot := takeStablePrefixSnapshot(systemPrompt, tools)
	if sp.snapshot != nil && sp.snapshot.Fingerprint == snapshot.Fingerprint {
		return false
	}
	sp.snapshot = snapshot
	sp.version++
	return true
}

// Invalidate forces a rebuild on the next Build() call.
func (sp *StablePrefix) Invalidate() {
	sp.snapshot = nil
}

// ToContext returns the cached system prompt and tools.
// Panics if Build() was never called.
func (sp *StablePrefix) ToContext() (systemPrompt []string, tools []uctypes.ToolDefinition) {
	if sp.snapshot == nil {
		panic("StablePrefix.ToContext() called before Build()")
	}
	return sp.snapshot.SystemPrompt, sp.snapshot.Tools
}

func takeStablePrefixSnapshot(systemPrompt []string, tools []uctypes.ToolDefinition) *StablePrefixSnapshot {
	// Deep copy to prevent mutation
	promptCopy := make([]string, len(systemPrompt))
	copy(promptCopy, systemPrompt)

	toolsCopy := make([]uctypes.ToolDefinition, len(tools))
	copy(toolsCopy, tools)

	return &StablePrefixSnapshot{
		SystemPrompt: promptCopy,
		Tools:        toolsCopy,
		Fingerprint:  computeStablePrefixFingerprint(promptCopy, toolsCopy),
	}
}

func computeStablePrefixFingerprint(systemPrompt []string, tools []uctypes.ToolDefinition) string {
	h := sha256.New()

	// Hash system prompt
	for _, s := range systemPrompt {
		h.Write([]byte(s))
		h.Write([]byte{0}) // separator
	}
	h.Write([]byte{0xFF}) // section separator

	// Hash tools (name + description + input schema)
	for _, t := range tools {
		h.Write([]byte(t.Name))
		h.Write([]byte{0})
		h.Write([]byte(t.Description))
		h.Write([]byte{0})
		if t.InputSchema != nil {
			schemaBytes, _ := json.Marshal(t.InputSchema)
			h.Write(schemaBytes)
		}
		h.Write([]byte{0xFF})
	}

	return fmt.Sprintf("%x", h.Sum(nil))[:16]
}

// ---------------------------------------------------------------------------
// AppendOnlyLog — append-only message log at the provider level
// ---------------------------------------------------------------------------

// AppendOnlyLog stores messages in append-only fashion. The only mutation
// path is ReplaceTail(), reserved for future compaction support.
// Every other operation is append-only, ensuring the byte prefix stays
// stable for provider caching.
type AppendOnlyLog struct {
	entries []*openaichat.ChatRequestMessage
}

// Len returns the number of entries in the log.
func (l *AppendOnlyLog) Len() int {
	return len(l.entries)
}

// Append adds a single message to the log.
func (l *AppendOnlyLog) Append(msg openaichat.ChatRequestMessage) {
	l.entries = append(l.entries, &msg)
}

// Extend adds multiple messages to the log.
func (l *AppendOnlyLog) Extend(msgs []openaichat.ChatRequestMessage) {
	for i := range msgs {
		l.entries = append(l.entries, &msgs[i])
	}
}

// ReplaceTail replaces the last entry — only legal for future compaction.
func (l *AppendOnlyLog) ReplaceTail(msg openaichat.ChatRequestMessage) {
	if len(l.entries) > 0 {
		l.entries[len(l.entries)-1] = &msg
	}
}

// ToMessages returns a shallow copy of all entries.
func (l *AppendOnlyLog) ToMessages() []openaichat.ChatRequestMessage {
	result := make([]openaichat.ChatRequestMessage, len(l.entries))
	for i, e := range l.entries {
		result[i] = *e
	}
	return result
}

// Clear removes all entries.
func (l *AppendOnlyLog) Clear() {
	l.entries = nil
}

// ---------------------------------------------------------------------------
// AppendOnlyContextManager — manages stable prefix + append-only log
// ---------------------------------------------------------------------------

// AppendOnlyContextManager coordinates a StablePrefix and an AppendOnlyLog
// to provide efficient context construction for the agent loop.
//
// Usage:
//
//	mgr := NewAppendOnlyContextManager()
//	// In the agent loop, each turn:
//	mgr.Build(systemPrompt, tools)    // snapshots prefix (cached if unchanged)
//	mgr.SyncMessages(normalizedMsgs)  // append new messages to log
//	messages := mgr.GetMessages()     // get all messages for LLM call
type AppendOnlyContextManager struct {
	Prefix       *StablePrefix
	Log          *AppendOnlyLog
	lastSyncCount int
	syncedDigest  uint32
}

// NewAppendOnlyContextManager creates a new manager with empty prefix and log.
func NewAppendOnlyContextManager() *AppendOnlyContextManager {
	return &AppendOnlyContextManager{
		Prefix: &StablePrefix{},
		Log:    &AppendOnlyLog{},
	}
}

// Build snapshots the system prompt and tools if they have changed.
// Returns true if the prefix was rebuilt (indicating a cache miss).
func (m *AppendOnlyContextManager) Build(systemPrompt []string, tools []uctypes.ToolDefinition) bool {
	return m.Prefix.Build(systemPrompt, tools)
}

// SyncMessages synchronizes the append-only log with the full set of
// normalized (provider-level) messages. It detects:
//   - New messages: appended to the log
//   - Compaction (shorter array): clears and rebuilds the log
//   - In-place rewrites (same length, changed content): clears and rebuilds
func (m *AppendOnlyContextManager) SyncMessages(normalizedMessages []openaichat.ChatRequestMessage) {
	// Detect in-place rewrites of already-synced messages
	if m.lastSyncCount > 0 && m.lastSyncCount <= len(normalizedMessages) {
		existingDigest := m.computeDigest(normalizedMessages[:m.lastSyncCount])
		if existingDigest != m.syncedDigest {
			// Content was rewritten in-place, must rebuild
			m.Log.Clear()
			m.lastSyncCount = 0
		}
	}

	// Compaction — array shrunk
	if len(normalizedMessages) < m.lastSyncCount {
		m.Log.Clear()
		m.lastSyncCount = 0
	}

	// Append new messages
	if m.lastSyncCount < len(normalizedMessages) {
		for i := m.lastSyncCount; i < len(normalizedMessages); i++ {
			m.Log.Append(normalizedMessages[i])
		}
	}

	m.lastSyncCount = len(normalizedMessages)
	m.syncedDigest = m.computeDigest(normalizedMessages)
}

// GetMessages returns all messages in the log for constructing the LLM request.
func (m *AppendOnlyContextManager) GetMessages() []openaichat.ChatRequestMessage {
	return m.Log.ToMessages()
}

// GetSystemPrompt returns the frozen system prompt from the stable prefix.
// Must call Build() first.
func (m *AppendOnlyContextManager) GetSystemPrompt() []string {
	if !m.Prefix.Built() {
		return nil
	}
	prompt, _ := m.Prefix.ToContext()
	return prompt
}

// GetTools returns the frozen tools from the stable prefix.
// Must call Build() first.
func (m *AppendOnlyContextManager) GetTools() []uctypes.ToolDefinition {
	if !m.Prefix.Built() {
		return nil
	}
	_, tools := m.Prefix.ToContext()
	return tools
}

// InvalidateForModelChange resets prefix + log for a model/provider switch.
func (m *AppendOnlyContextManager) InvalidateForModelChange() {
	m.Prefix.Invalidate()
	m.Log.Clear()
	m.lastSyncCount = 0
	m.syncedDigest = 0
}

// InvalidatePrefix forces the prefix to be rebuilt on the next Build() call.
// Use this when tools or system prompt have changed (e.g., after MCP reconnect,
// tab state change, or agent mode switch).
func (m *AppendOnlyContextManager) InvalidatePrefix() {
	m.Prefix.Invalidate()
}

// Reset clears everything and forces a full rebuild.
func (m *AppendOnlyContextManager) Reset() {
	m.Prefix.Invalidate()
	m.Log.Clear()
	m.lastSyncCount = 0
	m.syncedDigest = 0
}

// Stats returns diagnostic information about the context manager state.
func (m *AppendOnlyContextManager) Stats() AppendOnlyContextStats {
	return AppendOnlyContextStats{
		PrefixVersion:     m.Prefix.Version(),
		PrefixFingerprint: m.Prefix.Fingerprint(),
		LogLength:         m.Log.Len(),
		LastSyncCount:     m.lastSyncCount,
	}
}

// AppendOnlyContextStats holds diagnostic information.
type AppendOnlyContextStats struct {
	PrefixVersion     int
	PrefixFingerprint string
	LogLength         int
	LastSyncCount     int
}

// CountTokens counts the total tokens in the current context (prefix + log)
// using the local tiktoken-go tokenizer. This provides an accurate count
// of what will be sent to the LLM.
func (m *AppendOnlyContextManager) CountTokens(model string) (*TokenCountResult, error) {
	return DefaultTokenCounter.CountChatContext(
		m.GetSystemPrompt(),
		m.GetTools(),
		m.GetMessages(),
		model,
	)
}

// ---------------------------------------------------------------------------
// Global registry — one AppendOnlyContextManager per chat
// ---------------------------------------------------------------------------

var (
	aoCtxMu   sync.Mutex
	aoCtxMgrs = make(map[string]*AppendOnlyContextManager)
)

// GetOrCreateAppendOnlyContextManager returns the manager for the given chat ID,
// creating one if it doesn't exist yet.
func GetOrCreateAppendOnlyContextManager(chatId string) *AppendOnlyContextManager {
	aoCtxMu.Lock()
	defer aoCtxMu.Unlock()
	mgr, ok := aoCtxMgrs[chatId]
	if !ok {
		mgr = NewAppendOnlyContextManager()
		aoCtxMgrs[chatId] = mgr
	}
	return mgr
}

// DeleteAppendOnlyContextManager removes the manager for the given chat ID.
// Call this when a chat is deleted.
func DeleteAppendOnlyContextManager(chatId string) {
	aoCtxMu.Lock()
	defer aoCtxMu.Unlock()
	delete(aoCtxMgrs, chatId)
}

// computeDigest produces a deterministic hash over message fields that
// the provider may serialize. Used to detect in-place rewrites.
func (m *AppendOnlyContextManager) computeDigest(messages []openaichat.ChatRequestMessage) uint32 {
	var h uint32 = 0
	for _, msg := range messages {
		// Hash key fields: role, content, tool calls, tool_call_id, name
		payload := fmt.Sprintf("%s|%s|%v|%s|%s",
			msg.Role,
			truncateForDigest(msg.Content, 256),
			digestToolCalls(msg.ToolCalls),
			msg.ToolCallID,
			msg.Name,
		)
		for _, c := range payload {
			h = h*31 + uint32(c)
		}
	}
	return h
}

func truncateForDigest(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func digestToolCalls(tcs []openaichat.ToolCall) string {
	if len(tcs) == 0 {
		return ""
	}
	var parts []string
	for _, tc := range tcs {
		parts = append(parts, tc.ID+"|"+tc.Function.Name+"|"+truncateForDigest(tc.Function.Arguments, 128))
	}
	return strings.Join(parts, ";")
}
