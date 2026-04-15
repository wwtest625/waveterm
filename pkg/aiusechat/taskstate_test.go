// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestConvertAIChatToUIChat_PreservesTaskStateSnapshot(t *testing.T) {
	aiChat := &uctypes.AIChat{
		ChatId:     "chat-1",
		APIType:    uctypes.APIType_OpenAIResponses,
		Model:      "gpt-5-mini",
		APIVersion: "2026-01-01",
		SessionMeta: &uctypes.UIChatSessionMeta{
			ChatId: "chat-1",
			TaskState: &uctypes.UITaskProgressState{
				PlanId:        "plan-1",
				Status:        uctypes.TaskProgressStatusActive,
				CurrentTaskId: "task-2",
				Summary: uctypes.UITaskProgressSummary{
					Total:      3,
					Completed:  1,
					InProgress: 1,
					Pending:    1,
					Percent:    33,
				},
				Tasks: []uctypes.UITaskItem{{
					ID:     "task-1",
					Title:  "Map current runtime",
					Status: uctypes.TaskItemStatusCompleted,
				}, {
					ID:     "task-2",
					Title:  "Render task progress panel",
					Status: uctypes.TaskItemStatusInProgress,
				}},
			},
		},
	}

	uiChat, err := ConvertAIChatToUIChat(aiChat)
	if err != nil {
		t.Fatalf("ConvertAIChatToUIChat returned error: %v", err)
	}
	if uiChat == nil || uiChat.SessionMeta == nil || uiChat.SessionMeta.TaskState == nil {
		t.Fatalf("expected task state snapshot on UIChat, got %#v", uiChat)
	}
	if got := uiChat.SessionMeta.TaskState.CurrentTaskId; got != "task-2" {
		t.Fatalf("expected current task id task-2, got %q", got)
	}
	if got := uiChat.SessionMeta.TaskState.Tasks[1].Title; got != "Render task progress panel" {
		t.Fatalf("expected task title to survive conversion, got %q", got)
	}

	uiChat.SessionMeta.TaskState.Tasks[1].Title = "Mutated"
	if got := aiChat.SessionMeta.TaskState.Tasks[1].Title; got != "Render task progress panel" {
		t.Fatalf("expected converted task snapshot to be defensive copy, got %q", got)
	}
}
