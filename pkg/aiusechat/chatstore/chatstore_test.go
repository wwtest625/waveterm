// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type testGenAIMessage struct {
	messageId string
	role      string
}

func (m *testGenAIMessage) GetMessageId() string {
	return m.messageId
}

func (m *testGenAIMessage) GetUsage() *uctypes.AIUsage {
	return nil
}

func (m *testGenAIMessage) GetRole() string {
	return m.role
}

func boolPtr(v bool) *bool {
	return &v
}

func strPtr(v string) *string {
	return &v
}

func newTestChatStore() *ChatStore {
	return &ChatStore{
		chats:    make(map[string]*uctypes.AIChat),
		sessions: make(map[string]*uctypes.UIChatSessionMeta),
	}
}

func newTestAIOpts() *uctypes.AIOptsType {
	return &uctypes.AIOptsType{
		APIType:    uctypes.APIType_OpenAIResponses,
		Model:      "gpt-5-mini",
		APIVersion: "2026-01-01",
	}
}

func TestChatStore_ListSessionsByTabAndPriority(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		TabId:   "tab-a",
		Title:   strPtr("First"),
		Summary: strPtr("first summary"),
	})
	time.Sleep(time.Millisecond)
	cs.UpsertSessionMeta("chat-2", opts, uctypes.UIChatSessionMetaUpdate{
		TabId:     "tab-a",
		Title:     strPtr("Second"),
		Favorite:  boolPtr(true),
		Summary:   strPtr("second summary"),
		LastState: "executing",
	})
	cs.UpsertSessionMeta("chat-3", opts, uctypes.UIChatSessionMetaUpdate{
		TabId: "tab-b",
		Title: strPtr("Other tab"),
	})

	sessions := cs.ListSessions("tab-a", uctypes.UIChatSessionListOpts{})
	if len(sessions) != 2 {
		t.Fatalf("expected 2 tab-a sessions, got %d", len(sessions))
	}
	if sessions[0].ChatId != "chat-2" {
		t.Fatalf("expected favorite session first, got %#v", sessions)
	}
	if sessions[0].Title != "Second" || sessions[0].Summary != "second summary" {
		t.Fatalf("expected session metadata to be preserved, got %#v", sessions[0])
	}
	if sessions[0].LastTaskState != "executing" {
		t.Fatalf("expected last task state to be updated, got %#v", sessions[0].LastTaskState)
	}
}

func TestChatStore_ArchiveDeleteAndRestoreSessions(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		TabId: "tab-a",
		Title: strPtr("Archive me"),
	})

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		Archived: boolPtr(true),
	})
	if sessions := cs.ListSessions("tab-a", uctypes.UIChatSessionListOpts{}); len(sessions) != 0 {
		t.Fatalf("expected archived session to be hidden, got %#v", sessions)
	}
	if sessions := cs.ListSessions("tab-a", uctypes.UIChatSessionListOpts{IncludeArchived: true}); len(sessions) != 1 {
		t.Fatalf("expected archived session to be listable, got %#v", sessions)
	}

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		Archived: boolPtr(false),
		Deleted:  boolPtr(true),
	})
	if sessions := cs.ListSessions("tab-a", uctypes.UIChatSessionListOpts{IncludeArchived: true}); len(sessions) != 0 {
		t.Fatalf("expected deleted session to be hidden, got %#v", sessions)
	}
	if sessions := cs.ListSessions("tab-a", uctypes.UIChatSessionListOpts{IncludeArchived: true, IncludeDeleted: true}); len(sessions) != 1 {
		t.Fatalf("expected deleted session to be listable when requested, got %#v", sessions)
	}

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		Deleted: boolPtr(false),
	})
	if sessions := cs.ListSessions("tab-a", uctypes.UIChatSessionListOpts{}); len(sessions) != 1 {
		t.Fatalf("expected restored session to be visible again, got %#v", sessions)
	}
}

func TestChatStore_GetReturnsSessionCopy(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		TabId:   "tab-a",
		Title:   strPtr("CPU check"),
		Summary: strPtr("Inspect CPU model"),
	})
	if err := cs.PostMessage("chat-1", opts, &testGenAIMessage{
		messageId: "msg-1",
		role:      "user",
	}); err != nil {
		t.Fatalf("PostMessage returned error: %v", err)
	}

	chat := cs.Get("chat-1")
	if chat == nil || chat.SessionMeta == nil {
		t.Fatalf("expected session metadata on returned chat, got %#v", chat)
	}
	if chat.SessionMeta.Title != "CPU check" {
		t.Fatalf("expected copied title, got %#v", chat.SessionMeta)
	}

	chat.SessionMeta.Title = "Mutated"
	reloaded := cs.Get("chat-1")
	if reloaded.SessionMeta.Title != "CPU check" {
		t.Fatalf("expected session metadata to be copied defensively, got %#v", reloaded.SessionMeta)
	}
}
