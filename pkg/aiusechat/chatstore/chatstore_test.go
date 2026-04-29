// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type testGenAIMessage struct {
	messageId string
	role      string
}

type testPersistedGenAIMessage struct {
	MessageID string           `json:"messageid"`
	Role      string           `json:"role"`
	Usage     *uctypes.AIUsage `json:"usage,omitempty"`
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

func (m *testPersistedGenAIMessage) GetMessageId() string {
	return m.MessageID
}

func (m *testPersistedGenAIMessage) GetUsage() *uctypes.AIUsage {
	return m.Usage
}

func (m *testPersistedGenAIMessage) GetRole() string {
	return m.Role
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

func TestChatStore_PersistenceRoundTrip(t *testing.T) {
	RegisterMessageCodec("test-api", func(message uctypes.GenAIMessage) ([]byte, error) {
		return json.Marshal(message)
	}, func(data []byte) (uctypes.GenAIMessage, error) {
		var message testPersistedGenAIMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return nil, err
		}
		return &message, nil
	})

	storePath := filepath.Join(t.TempDir(), "chatstore.json")
	opts := &uctypes.AIOptsType{
		APIType:    "test-api",
		Model:      "model-a",
		APIVersion: "2026-01-01",
	}

	firstStore := NewChatStore(storePath)
	firstStore.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		TabId:   "tab-a",
		Title:   strPtr("Persisted"),
		Summary: strPtr("Saved to disk"),
	})
	if err := firstStore.PostMessage("chat-1", opts, &testPersistedGenAIMessage{
		MessageID: "msg-1",
		Role:      "user",
	}); err != nil {
		t.Fatalf("PostMessage returned error: %v", err)
	}

	secondStore := NewChatStore(storePath)
	sessions := secondStore.ListSessions("tab-a", uctypes.UIChatSessionListOpts{})
	if len(sessions) != 1 {
		t.Fatalf("expected 1 persisted session, got %#v", sessions)
	}
	if sessions[0].Title != "Persisted" {
		t.Fatalf("expected persisted title, got %#v", sessions[0])
	}

	chat := secondStore.Get("chat-1")
	if chat == nil {
		t.Fatalf("expected persisted chat to reload")
	}
	if len(chat.NativeMessages) != 1 {
		t.Fatalf("expected 1 persisted message, got %#v", chat.NativeMessages)
	}
	if got := chat.NativeMessages[0].GetMessageId(); got != "msg-1" {
		t.Fatalf("expected persisted message id msg-1, got %q", got)
	}
}

func TestChatStore_GetReturnsTaskStateCopy(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	cs.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		TabId: "tab-a",
		TaskState: &uctypes.UITaskProgressState{
			PlanId:        "plan-1",
			Status:        uctypes.TaskProgressStatusActive,
			CurrentTaskId: "task-1",
			Summary: uctypes.UITaskProgressSummary{
				Total:      2,
				InProgress: 1,
			},
			Tasks: []uctypes.UITaskItem{{
				ID:     "task-1",
				Title:  "Inspect runtime flow",
				Status: uctypes.TaskItemStatusInProgress,
			}},
		},
	})

	if err := cs.PostMessage("chat-1", opts, &testGenAIMessage{messageId: "msg-1", role: "user"}); err != nil {
		t.Fatalf("PostMessage returned error: %v", err)
	}

	chat := cs.Get("chat-1")
	if chat == nil || chat.SessionMeta == nil || chat.SessionMeta.TaskState == nil {
		t.Fatalf("expected task state on returned chat, got %#v", chat)
	}
	chat.SessionMeta.TaskState.Tasks[0].Title = "Mutated"

	reloaded := cs.Get("chat-1")
	if got := reloaded.SessionMeta.TaskState.Tasks[0].Title; got != "Inspect runtime flow" {
		t.Fatalf("expected task state to be copied defensively, got %q", got)
	}
}

func TestChatStore_PersistenceRoundTripIncludesTaskState(t *testing.T) {
	RegisterMessageCodec("test-api", func(message uctypes.GenAIMessage) ([]byte, error) {
		return json.Marshal(message)
	}, func(data []byte) (uctypes.GenAIMessage, error) {
		var message testPersistedGenAIMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return nil, err
		}
		return &message, nil
	})

	storePath := filepath.Join(t.TempDir(), "chatstore.json")
	opts := &uctypes.AIOptsType{
		APIType:    "test-api",
		Model:      "model-a",
		APIVersion: "2026-01-01",
	}

	firstStore := NewChatStore(storePath)
	firstStore.UpsertSessionMeta("chat-1", opts, uctypes.UIChatSessionMetaUpdate{
		TabId: "tab-a",
		TaskState: &uctypes.UITaskProgressState{
			PlanId:        "plan-1",
			Status:        uctypes.TaskProgressStatusActive,
			CurrentTaskId: "task-1",
			Summary: uctypes.UITaskProgressSummary{
				Total:      2,
				Completed:  1,
				InProgress: 1,
				Percent:    50,
			},
			Tasks: []uctypes.UITaskItem{{
				ID:     "task-1",
				Title:  "Inspect runtime flow",
				Status: uctypes.TaskItemStatusCompleted,
			}, {
				ID:     "task-2",
				Title:  "Render task panel",
				Status: uctypes.TaskItemStatusInProgress,
			}},
		},
	})
	if err := firstStore.PostMessage("chat-1", opts, &testPersistedGenAIMessage{MessageID: "msg-1", Role: "user"}); err != nil {
		t.Fatalf("PostMessage returned error: %v", err)
	}

	secondStore := NewChatStore(storePath)
	chat := secondStore.Get("chat-1")
	if chat == nil || chat.SessionMeta == nil || chat.SessionMeta.TaskState == nil {
		t.Fatalf("expected persisted task state to reload, got %#v", chat)
	}
	if got := chat.SessionMeta.TaskState.Summary.Percent; got != 50 {
		t.Fatalf("expected persisted task progress percent 50, got %d", got)
	}
	if got := chat.SessionMeta.TaskState.Tasks[1].Title; got != "Render task panel" {
		t.Fatalf("expected persisted task title, got %q", got)
	}
}

func TestChatStore_BackgroundJobsAreCopiedDefensively(t *testing.T) {
	cs := newTestChatStore()
	opts := newTestAIOpts()

	cs.UpsertBackgroundJob("chat-1", opts, uctypes.UIChatBackgroundJobInfo{
		JobId:          "job-1",
		ToolCallId:     "tool-1",
		CommandSummary: "docker pull test/image:latest",
		Status:         "running",
		OutputPreview:  "layer 1: pulling",
	})

	jobs := cs.GetBackgroundJobs("chat-1")
	if len(jobs) != 1 {
		t.Fatalf("expected one background job, got %#v", jobs)
	}
	jobs[0].CommandSummary = "mutated"

	reloaded := cs.GetBackgroundJobs("chat-1")
	if got := reloaded[0].CommandSummary; got != "docker pull test/image:latest" {
		t.Fatalf("expected defensive copy, got %q", got)
	}
}

func TestChatStore_PersistenceRoundTripIncludesBackgroundJobs(t *testing.T) {
	RegisterMessageCodec("test-api-bg", func(message uctypes.GenAIMessage) ([]byte, error) {
		return json.Marshal(message)
	}, func(data []byte) (uctypes.GenAIMessage, error) {
		var message testPersistedGenAIMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return nil, err
		}
		return &message, nil
	})

	storePath := filepath.Join(t.TempDir(), "chatstore.json")
	opts := &uctypes.AIOptsType{
		APIType:    "test-api-bg",
		Model:      "model-a",
		APIVersion: "2026-01-01",
	}

	firstStore := NewChatStore(storePath)
	firstStore.UpsertBackgroundJob("chat-1", opts, uctypes.UIChatBackgroundJobInfo{
		JobId:            "job-1",
		ToolCallId:       "tool-1",
		CommandSummary:   "docker pull test/image:latest",
		Connection:       "root@server",
		TargetLabel:      "root@server",
		Status:           "running",
		ApprovalState:    "user-approved",
		InteractionState: "awaiting-input",
		PromptHint:       "Password:",
		OutputPreview:    "pulling fs layer",
	})
	if err := firstStore.PostMessage("chat-1", opts, &testPersistedGenAIMessage{MessageID: "msg-1", Role: "user"}); err != nil {
		t.Fatalf("PostMessage returned error: %v", err)
	}

	secondStore := NewChatStore(storePath)
	jobs := secondStore.GetBackgroundJobs("chat-1")
	if len(jobs) != 1 {
		t.Fatalf("expected one persisted background job, got %#v", jobs)
	}
	if jobs[0].CommandSummary != "docker pull test/image:latest" {
		t.Fatalf("expected command summary to persist, got %#v", jobs[0])
	}
	if jobs[0].PromptHint != "Password:" {
		t.Fatalf("expected prompt hint to persist, got %#v", jobs[0])
	}
}
