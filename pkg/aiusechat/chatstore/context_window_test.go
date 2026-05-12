// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"fmt"
	"testing"
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
