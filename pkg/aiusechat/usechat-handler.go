// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func WaveAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, message *uctypes.AIMessage, chatOpts uctypes.WaveChatOpts) error {
	startTime := time.Now()
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		TabId:     chatOpts.TabId,
		LastState: "submitting",
	})
	chatstore.DefaultChatStore.UpdateSessionPreviewFromMessage(chatOpts.ChatId, &chatOpts.Config, chatOpts.TabId, message)

	// Convert AIMessage to native chat message using backend
	backend, err := GetBackendByAPIType(chatOpts.Config.APIType)
	if err != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			LastState: "failed",
		})
		return err
	}
	convertedMessage, err := backend.ConvertAIMessageToNativeChatMessage(*message)
	if err != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			LastState: "failed",
		})
		return fmt.Errorf("message conversion failed: %w", err)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, convertedMessage); err != nil {
		chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
			LastState: "failed",
		})
		return fmt.Errorf("failed to store message: %w", err)
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		LastState: "executing",
	})

	metrics, err := RunAIChat(ctx, sseHandler, backend, chatOpts)
	sessionState := "completed"
	if err != nil {
		sessionState = "failed"
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		LastState: sessionState,
	})
	if metrics != nil {
		metrics.RequestDuration = int(time.Since(startTime).Milliseconds())
		for _, part := range message.Parts {
			if part.Type == uctypes.AIMessagePartTypeText {
				metrics.TextLen += len(part.Text)
			} else if part.Type == uctypes.AIMessagePartTypeFile {
				mimeType := strings.ToLower(part.MimeType)
				if strings.HasPrefix(mimeType, "image/") {
					metrics.ImageCount++
				} else if mimeType == "application/pdf" {
					metrics.PDFCount++
				} else {
					metrics.TextDocCount++
				}
			}
		}
		log.Printf("WaveAI call metrics: requests=%d tools=%d tabstate_refresh=%d premium=%d proxy=%d images=%d pdfs=%d textdocs=%d textlen=%d duration=%dms error=%v\n",
			metrics.RequestCount, metrics.ToolUseCount, metrics.TabStateRefreshCount,
			metrics.PremiumReqCount, metrics.ProxyReqCount,
			metrics.ImageCount, metrics.PDFCount, metrics.TextDocCount, metrics.TextLen, metrics.RequestDuration, metrics.HadError)

		sendAIMetricsTelemetry(ctx, metrics)
	}
	return err
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	TabId        string            `json:"tabid,omitempty"`
	BlockId      string            `json:"blockid,omitempty"`
	BuilderId    string            `json:"builderid,omitempty"`
	BuilderAppId string            `json:"builderappid,omitempty"`
	ChatID       string            `json:"chatid"`
	Msg          uctypes.AIMessage `json:"msg"`
	WidgetAccess bool              `json:"widgetaccess,omitempty"`
	AIMode       string            `json:"aimode"`
	AgentMode    string            `json:"agentmode,omitempty"`
}

func WaveAIPostMessageHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow POST method
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PostMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate chatid is present and is a UUID
	if req.ChatID == "" {
		http.Error(w, "chatid is required in request body", http.StatusBadRequest)
		return
	}
	log.Printf("[WaveAI:PostMessage] chatId=%s aimode=%s agentmode=%s", req.ChatID, req.AIMode, req.AgentMode)
	if _, err := uuid.Parse(req.ChatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Validate the message
	if err := req.Msg.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("Message validation failed: %v", err), http.StatusBadRequest)
		return
	}

	// Get RTInfo from TabId or BuilderId
	var rtInfo *waveobj.ObjRTInfo
	if req.TabId != "" {
		oref := waveobj.MakeORef(waveobj.OType_Tab, req.TabId)
		rtInfo = wstore.GetRTInfo(oref)
	} else if req.BuilderId != "" {
		oref := waveobj.MakeORef(waveobj.OType_Builder, req.BuilderId)
		rtInfo = wstore.GetRTInfo(oref)
	}
	if rtInfo == nil {
		rtInfo = &waveobj.ObjRTInfo{}
	}

	// Get WaveAI settings
	premium := shouldUsePremium()
	builderMode := req.BuilderId != ""
	if req.AIMode == "" {
		http.Error(w, "aimode is required in request body", http.StatusBadRequest)
		return
	}
	aiOpts, err := getWaveAISettings(premium, builderMode, *rtInfo, req.AIMode)
	if err != nil {
		http.Error(w, fmt.Sprintf("WaveAI configuration error: %v", err), http.StatusInternalServerError)
		return
	}
	effectiveWidgetAccess := req.WidgetAccess || aiOpts.Provider == uctypes.AIProvider_Wave

	// Call the core WaveAIPostMessage function
	chatOpts := uctypes.WaveChatOpts{
		ChatId:               req.ChatID,
		ClientId:             wstore.GetClientId(),
		Config:               *aiOpts,
		AgentMode:            string(resolveAgentMode(req.AgentMode)),
		CurrentMessageText:   req.Msg.GetContent(),
		WidgetAccess:         effectiveWidgetAccess,
		AllowNativeWebSearch: true,
		TabId:                req.TabId,
		BlockId:              req.BlockId,
		BuilderId:            req.BuilderId,
		BuilderAppId:         req.BuilderAppId,
	}
	chatOpts.SystemPrompt = getSystemPrompt(chatOpts.Config.Model, chatOpts.BuilderId != "", resolveAgentMode(req.AgentMode))
	logWaveAIDebugRequest(chatOpts, effectiveWidgetAccess)

	if req.TabId != "" {
		chatOpts.TabStateGenerator = func() (string, []uctypes.ToolDefinition, string, error) {
			tabState, tabTools, err := GenerateTabStateAndTools(r.Context(), req.TabId, effectiveWidgetAccess, &chatOpts)
			return tabState, tabTools, req.TabId, err
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.BuilderAppGenerator = func() (string, string, string, error) {
			return generateBuilderAppData(req.BuilderAppId)
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.Tools = append(chatOpts.Tools,
			GetBuilderWriteAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderEditAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderListFilesToolDefinition(req.BuilderAppId),
		)
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	if err := WaveAIPostMessageWrap(r.Context(), sseHandler, &req.Msg, chatOpts); err != nil {
		http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
		return
	}
}

func WaveAIGetChatHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get chatid from URL parameters
	chatID := r.URL.Query().Get("chatid")
	if chatID == "" {
		http.Error(w, "chatid parameter is required", http.StatusBadRequest)
		return
	}

	// Validate chatid is a UUID
	if _, err := uuid.Parse(chatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		http.Error(w, "chat not found", http.StatusNotFound)
		return
	}

	// Set response headers for JSON
	w.Header().Set("Content-Type", "application/json")

	// Encode and return the chat
	if err := json.NewEncoder(w).Encode(chat); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
		return
	}
}
