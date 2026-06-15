// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// ---------------------------------------------------------------------------
// StablePrefix tests
// ---------------------------------------------------------------------------

func TestStablePrefix_Build_FreezesPrompt(t *testing.T) {
	sp := &StablePrefix{}

	prompt := []string{"You are a helpful assistant.", "Be concise."}
	tools := []uctypes.ToolDefinition{
		{Name: "test_tool", Description: "A test tool"},
	}

	changed := sp.Build(prompt, tools)
	if !changed {
		t.Error("First Build() should return changed=true")
	}
	if !sp.Built() {
		t.Error("Build() should mark prefix as built")
	}
	if sp.Version() != 1 {
		t.Errorf("Version should be 1, got %d", sp.Version())
	}
	fp := sp.Fingerprint()
	if fp == "" || fp == "<unbuilt>" {
		t.Error("Fingerprint should be set after Build()")
	}

	// Build again with same data — should not change
	changed = sp.Build(prompt, tools)
	if changed {
		t.Error("Second Build() with same data should return changed=false")
	}
	if sp.Version() != 1 {
		t.Errorf("Version should still be 1, got %d", sp.Version())
	}
	if sp.Fingerprint() != fp {
		t.Error("Fingerprint should be stable for same data")
	}
}

func TestStablePrefix_Build_DetectsChanges(t *testing.T) {
	sp := &StablePrefix{}

	prompt1 := []string{"You are a helpful assistant."}
	prompt2 := []string{"You are a helpful assistant.", "Be concise."}
	tools1 := []uctypes.ToolDefinition{{Name: "tool_a", Description: "Tool A"}}
	tools2 := []uctypes.ToolDefinition{{Name: "tool_b", Description: "Tool B"}}

	sp.Build(prompt1, tools1)
	fp1 := sp.Fingerprint()

	changed := sp.Build(prompt2, tools1)
	if !changed {
		t.Error("Build() with different prompt should return changed=true")
	}
	if sp.Fingerprint() == fp1 {
		t.Error("Fingerprint should change when prompt changes")
	}

	fp2 := sp.Fingerprint()
	changed = sp.Build(prompt2, tools2)
	if !changed {
		t.Error("Build() with different tools should return changed=true")
	}
	if sp.Fingerprint() == fp2 {
		t.Error("Fingerprint should change when tools change")
	}
}

func TestStablePrefix_Invalidate(t *testing.T) {
	sp := &StablePrefix{}
	sp.Build([]string{"test"}, nil)

	if !sp.Built() {
		t.Error("Should be built after Build()")
	}

	sp.Invalidate()
	if sp.Built() {
		t.Error("Should not be built after Invalidate()")
	}
}

func TestStablePrefix_ToContext_PanicsBeforeBuild(t *testing.T) {
	sp := &StablePrefix{}
	defer func() {
		if r := recover(); r == nil {
			t.Error("ToContext() should panic before Build()")
		}
	}()
	sp.ToContext()
}

// ---------------------------------------------------------------------------
// AppendOnlyLog tests
// ---------------------------------------------------------------------------

func TestAppendOnlyLog_Append(t *testing.T) {
	log := &AppendOnlyLog{}

	if log.Len() != 0 {
		t.Error("New log should be empty")
	}

	log.Append(openaichat.ChatRequestMessage{Role: "user", Content: "hello"})
	if log.Len() != 1 {
		t.Errorf("Len should be 1, got %d", log.Len())
	}

	msgs := log.ToMessages()
	if len(msgs) != 1 || msgs[0].Content != "hello" {
		t.Error("ToMessages() should return appended message")
	}
}

func TestAppendOnlyLog_Extend(t *testing.T) {
	log := &AppendOnlyLog{}
	msgs := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	}
	log.Extend(msgs)
	if log.Len() != 2 {
		t.Errorf("Len should be 2, got %d", log.Len())
	}
}

func TestAppendOnlyLog_ReplaceTail(t *testing.T) {
	log := &AppendOnlyLog{}
	log.Append(openaichat.ChatRequestMessage{Role: "user", Content: "original"})
	log.ReplaceTail(openaichat.ChatRequestMessage{Role: "user", Content: "replaced"})

	msgs := log.ToMessages()
	if msgs[0].Content != "replaced" {
		t.Errorf("ReplaceTail should replace last entry, got %q", msgs[0].Content)
	}
}

func TestAppendOnlyLog_Clear(t *testing.T) {
	log := &AppendOnlyLog{}
	log.Append(openaichat.ChatRequestMessage{Role: "user", Content: "hello"})
	log.Clear()
	if log.Len() != 0 {
		t.Error("Clear() should empty the log")
	}
}

// ---------------------------------------------------------------------------
// AppendOnlyContextManager tests
// ---------------------------------------------------------------------------

func TestAppendOnlyContextManager_Build_CachesPrefix(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	prompt := []string{"You are a helpful assistant."}
	tools := []uctypes.ToolDefinition{{Name: "tool_a", Description: "Tool A"}}

	changed := mgr.Build(prompt, tools)
	if !changed {
		t.Error("First Build() should return changed=true")
	}

	// Second Build with same data should not change
	changed = mgr.Build(prompt, tools)
	if changed {
		t.Error("Second Build() with same data should return changed=false")
	}

	// GetSystemPrompt should return cached prompt
	cached := mgr.GetSystemPrompt()
	if len(cached) != 1 || cached[0] != "You are a helpful assistant." {
		t.Error("GetSystemPrompt() should return cached prompt")
	}

	// GetTools should return cached tools
	cachedTools := mgr.GetTools()
	if len(cachedTools) != 1 || cachedTools[0].Name != "tool_a" {
		t.Error("GetTools() should return cached tools")
	}
}

func TestAppendOnlyContextManager_SyncMessages_Appends(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	// First sync: 3 messages
	msgs1 := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
		{Role: "user", Content: "how are you?"},
	}
	mgr.SyncMessages(msgs1)
	if mgr.Log.Len() != 3 {
		t.Errorf("Log should have 3 entries, got %d", mgr.Log.Len())
	}

	// Second sync: 4 messages (1 new)
	msgs2 := append(msgs1, openaichat.ChatRequestMessage{Role: "assistant", Content: "I'm fine"})
	mgr.SyncMessages(msgs2)
	if mgr.Log.Len() != 4 {
		t.Errorf("Log should have 4 entries, got %d", mgr.Log.Len())
	}
}

func TestAppendOnlyContextManager_SyncMessages_DetectsCompaction(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	msgs1 := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
		{Role: "user", Content: "how are you?"},
	}
	mgr.SyncMessages(msgs1)
	if mgr.Log.Len() != 3 {
		t.Errorf("Log should have 3 entries, got %d", mgr.Log.Len())
	}

	// Compaction: array shrunk to 2 messages
	msgs2 := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "summary of previous conversation"},
		{Role: "assistant", Content: "understood"},
	}
	mgr.SyncMessages(msgs2)
	if mgr.Log.Len() != 2 {
		t.Errorf("Log should have 2 entries after compaction, got %d", mgr.Log.Len())
	}
}

func TestAppendOnlyContextManager_SyncMessages_DetectsInPlaceRewrite(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	msgs1 := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	}
	mgr.SyncMessages(msgs1)

	// In-place rewrite: same length, different content
	msgs2 := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hey there"}, // changed
	}
	mgr.SyncMessages(msgs2)

	logMsgs := mgr.GetMessages()
	if logMsgs[1].Content != "hey there" {
		t.Errorf("In-place rewrite should be detected, got %q", logMsgs[1].Content)
	}
}

func TestAppendOnlyContextManager_InvalidateForModelChange(t *testing.T) {
	mgr := NewAppendOnlyContextManager()
	mgr.Build([]string{"test"}, nil)
	mgr.SyncMessages([]openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
	})

	mgr.InvalidateForModelChange()

	if mgr.Prefix.Built() {
		t.Error("Prefix should be invalidated after InvalidateForModelChange()")
	}
	if mgr.Log.Len() != 0 {
		t.Error("Log should be cleared after InvalidateForModelChange()")
	}
}

func TestAppendOnlyContextManager_InvalidatePrefix(t *testing.T) {
	mgr := NewAppendOnlyContextManager()
	mgr.Build([]string{"test"}, nil)
	mgr.SyncMessages([]openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
	})

	mgr.InvalidatePrefix()

	if mgr.Prefix.Built() {
		t.Error("Prefix should be invalidated")
	}
	// Log should NOT be cleared — only prefix is invalidated
	if mgr.Log.Len() != 1 {
		t.Error("Log should NOT be cleared by InvalidatePrefix()")
	}
}

func TestAppendOnlyContextManager_Stats(t *testing.T) {
	mgr := NewAppendOnlyContextManager()
	mgr.Build([]string{"test"}, nil)
	mgr.SyncMessages([]openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
	})

	stats := mgr.Stats()
	if stats.PrefixVersion != 1 {
		t.Errorf("PrefixVersion should be 1, got %d", stats.PrefixVersion)
	}
	if stats.LogLength != 1 {
		t.Errorf("LogLength should be 1, got %d", stats.LogLength)
	}
	if stats.LastSyncCount != 1 {
		t.Errorf("LastSyncCount should be 1, got %d", stats.LastSyncCount)
	}
}

// ---------------------------------------------------------------------------
// Global registry tests
// ---------------------------------------------------------------------------

func TestGetOrCreateAppendOnlyContextManager(t *testing.T) {
	// Clean up
	DeleteAppendOnlyContextManager("test-chat-1")
	DeleteAppendOnlyContextManager("test-chat-2")

	mgr1 := GetOrCreateAppendOnlyContextManager("test-chat-1")
	if mgr1 == nil {
		t.Error("Should return a manager")
	}

	mgr2 := GetOrCreateAppendOnlyContextManager("test-chat-1")
	if mgr2 != mgr1 {
		t.Error("Should return same manager for same chat ID")
	}

	mgr3 := GetOrCreateAppendOnlyContextManager("test-chat-2")
	if mgr3 == mgr1 {
		t.Error("Should return different manager for different chat ID")
	}

	// Clean up
	DeleteAppendOnlyContextManager("test-chat-1")
	DeleteAppendOnlyContextManager("test-chat-2")
}

// ---------------------------------------------------------------------------
// Integration test: prefix stability across turns
// ---------------------------------------------------------------------------

func TestPrefixStabilityAcrossTurns(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	prompt := []string{"You are Wave AI.", "Be concise."}
	tools := []uctypes.ToolDefinition{
		{Name: "wave_run_command", Description: "Execute commands"},
		{Name: "write_text_file", Description: "Write files"},
	}

	// Turn 1: Build prefix
	mgr.Build(prompt, tools)
	fp1 := mgr.Prefix.Fingerprint()

	// Turn 2: Same prompt and tools — prefix should be stable
	mgr.Build(prompt, tools)
	fp2 := mgr.Prefix.Fingerprint()

	if fp1 != fp2 {
		t.Error("Fingerprint should be stable across turns with same prompt and tools")
	}

	// Turn 3: Add a tool — prefix should change
	newTools := append(tools, uctypes.ToolDefinition{Name: "edit_text_file", Description: "Edit files"})
	mgr.Build(prompt, newTools)
	fp3 := mgr.Prefix.Fingerprint()

	if fp3 == fp2 {
		t.Error("Fingerprint should change when tools are added")
	}

	// Turn 4: Back to original tools — prefix should match original
	mgr.Build(prompt, tools)
	fp4 := mgr.Prefix.Fingerprint()

	if fp4 != fp1 {
		t.Error("Fingerprint should be deterministic for same input")
	}
}

// ---------------------------------------------------------------------------
// Critical test: ToolCallDesc preserved after StablePrefix copy
// ---------------------------------------------------------------------------

func TestStablePrefix_PreservesToolCallDesc(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	callDescCalled := false
	tools := []uctypes.ToolDefinition{
		{
			Name:        "wave_run_command",
			Description: "Run a command",
			ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
				callDescCalled = true
				if m, ok := input.(map[string]any); ok {
					if cmd, ok := m["command"].(string); ok {
						return "running: " + cmd
					}
				}
				return "running command"
			},
		},
	}

	mgr.Build([]string{"test"}, tools)

	// Get the cached tools
	cachedTools := mgr.GetTools()
	if len(cachedTools) != 1 {
		t.Fatalf("Expected 1 cached tool, got %d", len(cachedTools))
	}

	// Verify ToolCallDesc is preserved
	if cachedTools[0].ToolCallDesc == nil {
		t.Fatal("ToolCallDesc should be preserved after StablePrefix copy")
	}

	// Call the ToolCallDesc to verify it works
	desc := cachedTools[0].ToolCallDesc(map[string]any{"command": "ls -la"}, nil, nil)
	if !callDescCalled {
		t.Error("ToolCallDesc should have been called")
	}
	if desc != "running: ls -la" {
		t.Errorf("ToolCallDesc returned unexpected result: %q", desc)
	}
}

func TestStablePrefix_PreservesToolCallDescAfterMultipleBuilds(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	tools := []uctypes.ToolDefinition{
		{
			Name:        "wave_run_command",
			Description: "Run a command",
			ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
				if m, ok := input.(map[string]any); ok {
					if cmd, ok := m["command"].(string); ok {
						return "running: " + cmd
					}
				}
				return "running command"
			},
		},
	}

	// First build
	mgr.Build([]string{"test"}, tools)
	cached1 := mgr.GetTools()

	// Second build with same data (should reuse cache)
	mgr.Build([]string{"test"}, tools)
	cached2 := mgr.GetTools()

	// Both should have ToolCallDesc
	if cached1[0].ToolCallDesc == nil {
		t.Error("First build ToolCallDesc should be preserved")
	}
	if cached2[0].ToolCallDesc == nil {
		t.Error("Second build ToolCallDesc should be preserved")
	}

	// Verify they work
	desc1 := cached1[0].ToolCallDesc(map[string]any{"command": "pwd"}, nil, nil)
	desc2 := cached2[0].ToolCallDesc(map[string]any{"command": "pwd"}, nil, nil)
	if desc1 != "running: pwd" || desc2 != "running: pwd" {
		t.Errorf("ToolCallDesc results unexpected: %q, %q", desc1, desc2)
	}
}
