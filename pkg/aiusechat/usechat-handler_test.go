// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestPostMessageRequestJSONDecode(t *testing.T) {
	jsonStr := `{
		"tabid": "tab-123",
		"blockid": "block-456",
		"builderid": "builder-789",
		"builderappid": "app-abc",
		"chatid": "550e8400-e29b-41d4-a716-446655440000",
		"msg": {
			"messageid": "msg-001",
			"parts": [{"type": "text", "text": "hello world"}]
		},
		"widgetaccess": true,
		"aimode": "chat",
		"agentmode": "code"
	}`

	var req PostMessageRequest
	if err := json.NewDecoder(strings.NewReader(jsonStr)).Decode(&req); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}

	if req.TabId != "tab-123" {
		t.Errorf("TabId: got %q, want %q", req.TabId, "tab-123")
	}
	if req.BlockId != "block-456" {
		t.Errorf("BlockId: got %q, want %q", req.BlockId, "block-456")
	}
	if req.BuilderId != "builder-789" {
		t.Errorf("BuilderId: got %q, want %q", req.BuilderId, "builder-789")
	}
	if req.BuilderAppId != "app-abc" {
		t.Errorf("BuilderAppId: got %q, want %q", req.BuilderAppId, "app-abc")
	}
	if req.ChatID != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("ChatID: got %q, want %q", req.ChatID, "550e8400-e29b-41d4-a716-446655440000")
	}
	if req.Msg.MessageId != "msg-001" {
		t.Errorf("Msg.MessageId: got %q, want %q", req.Msg.MessageId, "msg-001")
	}
	if len(req.Msg.Parts) != 1 {
		t.Fatalf("Msg.Parts length: got %d, want 1", len(req.Msg.Parts))
	}
	if req.Msg.Parts[0].Type != uctypes.AIMessagePartTypeText {
		t.Errorf("Msg.Parts[0].Type: got %q, want %q", req.Msg.Parts[0].Type, uctypes.AIMessagePartTypeText)
	}
	if req.Msg.Parts[0].Text != "hello world" {
		t.Errorf("Msg.Parts[0].Text: got %q, want %q", req.Msg.Parts[0].Text, "hello world")
	}
	if !req.WidgetAccess {
		t.Errorf("WidgetAccess: got %v, want true", req.WidgetAccess)
	}
	if req.AIMode != "chat" {
		t.Errorf("AIMode: got %q, want %q", req.AIMode, "chat")
	}
	if req.AgentMode != "code" {
		t.Errorf("AgentMode: got %q, want %q", req.AgentMode, "code")
	}
}

func TestWaveAIGetChatHandlerMissingChatID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/ai/chat", nil)
	w := httptest.NewRecorder()

	WaveAIGetChatHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestWaveAIGetChatHandlerInvalidUUID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/ai/chat?chatid=not-a-uuid", nil)
	w := httptest.NewRecorder()

	WaveAIGetChatHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestWaveAIPostMessageHandlerWrongMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/ai/chat/message", nil)
	w := httptest.NewRecorder()

	WaveAIPostMessageHandler(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusMethodNotAllowed)
	}
}

func TestWaveAIPostMessageHandlerMissingChatID(t *testing.T) {
	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/ai/chat/message", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	WaveAIPostMessageHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
}
