// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"fmt"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestChatStore_GetContextWindowKeepsRecentUserTurns(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	for i := 1; i <= 6; i++ {
		if err := cs.PostMessage("chat-1", opts, &testGenAIMessage{
			messageId: fmt.Sprintf("user-%d", i),
			role:      "user",
		}); err != nil {
			t.Fatalf("posting user message failed: %v", err)
		}
		if err := cs.PostMessage("chat-1", opts, &testGenAIMessage{
			messageId: fmt.Sprintf("assistant-%d", i),
			role:      "assistant",
		}); err != nil {
			t.Fatalf("posting assistant message failed: %v", err)
		}
	}

	windowed := cs.GetContextWindow("chat-1", 5)
	if windowed == nil {
		t.Fatal("expected context window chat")
	}
	if len(windowed.NativeMessages) != 10 {
		t.Fatalf("expected 10 messages in context window, got %d", len(windowed.NativeMessages))
	}
	if got := windowed.NativeMessages[0].GetMessageId(); got != "user-2" {
		t.Fatalf("expected context window to start from user-2, got %q", got)
	}

	full := cs.Get("chat-1")
	if full == nil {
		t.Fatal("expected full chat")
	}
	if len(full.NativeMessages) != 12 {
		t.Fatalf("expected full chat history to stay intact, got %d", len(full.NativeMessages))
	}
}

func TestChatStore_GetContextWindowKeepsFullHistoryWhenShorterThanLimit(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	for i := 1; i <= 3; i++ {
		if err := cs.PostMessage("chat-1", opts, &testGenAIMessage{
			messageId: fmt.Sprintf("user-%d", i),
			role:      "user",
		}); err != nil {
			t.Fatalf("posting user message failed: %v", err)
		}
	}

	windowed := cs.GetContextWindow("chat-1", 5)
	if windowed == nil {
		t.Fatal("expected context window chat")
	}
	if len(windowed.NativeMessages) != 3 {
		t.Fatalf("expected full short history to be preserved, got %d messages", len(windowed.NativeMessages))
	}
	if got := windowed.NativeMessages[0].GetMessageId(); got != "user-1" {
		t.Fatalf("expected history to start at first message, got %q", got)
	}
}

func TestChatStore_UpsertSessionMetaStoresCheatsheet(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	meta := cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		Cheatsheet: &uctypes.SessionCheatsheet{
			CurrentWork: "修复 SSH 登录失败",
			Completed:   "已确认网络可达",
			BlockedBy:   "密码提示未识别",
			NextStep:    "补充交互检测",
		},
	})

	if meta == nil || meta.Cheatsheet == nil {
		t.Fatal("expected cheatsheet to be stored")
	}
	if meta.Cheatsheet.CurrentWork != "修复 SSH 登录失败" {
		t.Fatalf("expected cheatsheet current work, got %#v", meta.Cheatsheet)
	}
}
