// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type ChatStore struct {
	lock     sync.Mutex
	chats    map[string]*uctypes.AIChat
	sessions map[string]*uctypes.UIChatSessionMeta
}

var DefaultChatStore = &ChatStore{
	chats:    make(map[string]*uctypes.AIChat),
	sessions: make(map[string]*uctypes.UIChatSessionMeta),
}

func copySessionMeta(meta *uctypes.UIChatSessionMeta) *uctypes.UIChatSessionMeta {
	return meta.Clone()
}

func defaultSessionTitle(chatId string) string {
	trimmed := strings.TrimSpace(chatId)
	if trimmed == "" {
		return "New Chat"
	}
	return "New Chat"
}

func summarizeSessionText(text string, limit int) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if normalized == "" {
		return ""
	}
	if limit <= 0 || len(normalized) <= limit {
		return normalized
	}
	if limit <= 3 {
		return normalized[:limit]
	}
	return normalized[:limit-3] + "..."
}

func extractSessionPreview(message *uctypes.AIMessage) (string, string) {
	if message == nil {
		return "", ""
	}
	var textParts []string
	for _, part := range message.Parts {
		if part.Type == uctypes.AIMessagePartTypeText && strings.TrimSpace(part.Text) != "" {
			textParts = append(textParts, part.Text)
		}
	}
	combined := strings.Join(textParts, "\n")
	return summarizeSessionText(combined, 48), summarizeSessionText(combined, 140)
}

func (cs *ChatStore) upsertSessionMetaLocked(chatId string, aiOpts *uctypes.AIOptsType, update uctypes.UIChatSessionMetaUpdate) *uctypes.UIChatSessionMeta {
	if cs.sessions == nil {
		cs.sessions = make(map[string]*uctypes.UIChatSessionMeta)
	}
	now := update.UpdatedTs
	if now == 0 {
		now = time.Now().UnixMilli()
	}
	meta := cs.sessions[chatId]
	if meta == nil {
		meta = &uctypes.UIChatSessionMeta{
			ChatId:    chatId,
			Title:     defaultSessionTitle(chatId),
			CreatedTs: now,
		}
		cs.sessions[chatId] = meta
	}
	if update.TabId != "" {
		meta.TabId = update.TabId
	}
	if update.Title != nil {
		meta.Title = strings.TrimSpace(*update.Title)
		if meta.Title == "" {
			meta.Title = defaultSessionTitle(chatId)
		}
	}
	if update.Summary != nil {
		meta.Summary = strings.TrimSpace(*update.Summary)
	}
	if update.Favorite != nil {
		meta.Favorite = *update.Favorite
	}
	if update.LastState != "" {
		meta.LastTaskState = update.LastState
	}
	if update.Archived != nil {
		meta.Archived = *update.Archived
	}
	if update.Deleted != nil {
		meta.Deleted = *update.Deleted
	}
	meta.UpdatedTs = now
	if chat := cs.chats[chatId]; chat != nil {
		chat.SessionMeta = copySessionMeta(meta)
		if aiOpts != nil {
			if chat.APIType == "" {
				chat.APIType = aiOpts.APIType
			}
			if chat.Model == "" {
				chat.Model = aiOpts.Model
			}
			if chat.APIVersion == "" {
				chat.APIVersion = aiOpts.APIVersion
			}
		}
	}
	return copySessionMeta(meta)
}

func (cs *ChatStore) UpsertSessionMeta(chatId string, aiOpts *uctypes.AIOptsType, update uctypes.UIChatSessionMetaUpdate) *uctypes.UIChatSessionMeta {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	return cs.upsertSessionMetaLocked(chatId, aiOpts, update)
}

func (cs *ChatStore) GetSession(chatId string) *uctypes.UIChatSessionMeta {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	return copySessionMeta(cs.sessions[chatId])
}

func (cs *ChatStore) UpdateSessionPreviewFromMessage(chatId string, aiOpts *uctypes.AIOptsType, tabId string, message *uctypes.AIMessage) *uctypes.UIChatSessionMeta {
	title, summary := extractSessionPreview(message)
	update := uctypes.UIChatSessionMetaUpdate{
		TabId: tabId,
	}
	if title != "" {
		update.Title = &title
	}
	if summary != "" {
		update.Summary = &summary
	}
	return cs.UpsertSessionMeta(chatId, aiOpts, update)
}

func (cs *ChatStore) ListSessions(tabId string, opts uctypes.UIChatSessionListOpts) []*uctypes.UIChatSessionMeta {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	var sessions []*uctypes.UIChatSessionMeta
	for _, session := range cs.sessions {
		if strings.TrimSpace(tabId) != "" && session.TabId != tabId {
			continue
		}
		if session.Archived && !opts.IncludeArchived {
			continue
		}
		if session.Deleted && !opts.IncludeDeleted {
			continue
		}
		sessions = append(sessions, copySessionMeta(session))
	}

	slices.SortFunc(sessions, func(a, b *uctypes.UIChatSessionMeta) int {
		if a == nil && b == nil {
			return 0
		}
		if a == nil {
			return 1
		}
		if b == nil {
			return -1
		}
		if a.Favorite != b.Favorite {
			if a.Favorite {
				return -1
			}
			return 1
		}
		if a.UpdatedTs != b.UpdatedTs {
			if a.UpdatedTs > b.UpdatedTs {
				return -1
			}
			return 1
		}
		if a.CreatedTs != b.CreatedTs {
			if a.CreatedTs > b.CreatedTs {
				return -1
			}
			return 1
		}
		return strings.Compare(a.ChatId, b.ChatId)
	})
	return sessions
}

func (cs *ChatStore) Get(chatId string) *uctypes.AIChat {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		return nil
	}

	// Copy the chat to prevent concurrent access issues
	copyChat := &uctypes.AIChat{
		ChatId:         chat.ChatId,
		APIType:        chat.APIType,
		Model:          chat.Model,
		APIVersion:     chat.APIVersion,
		SessionMeta:    copySessionMeta(chat.SessionMeta),
		NativeMessages: make([]uctypes.GenAIMessage, len(chat.NativeMessages)),
	}
	copy(copyChat.NativeMessages, chat.NativeMessages)

	return copyChat
}

func (cs *ChatStore) Delete(chatId string) {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	delete(cs.chats, chatId)
}

func (cs *ChatStore) CountUserMessages(chatId string) int {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		return 0
	}

	count := 0
	for _, msg := range chat.NativeMessages {
		if msg.GetRole() == "user" {
			count++
		}
	}
	return count
}

func (cs *ChatStore) PostMessage(chatId string, aiOpts *uctypes.AIOptsType, message uctypes.GenAIMessage) error {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		// Create new chat
		chat = &uctypes.AIChat{
			ChatId:         chatId,
			APIType:        aiOpts.APIType,
			Model:          aiOpts.Model,
			APIVersion:     aiOpts.APIVersion,
			SessionMeta:    cs.upsertSessionMetaLocked(chatId, aiOpts, uctypes.UIChatSessionMetaUpdate{}),
			NativeMessages: make([]uctypes.GenAIMessage, 0),
		}
		cs.chats[chatId] = chat
	} else {
		// Verify that the AI options match
		if chat.APIType != aiOpts.APIType {
			return fmt.Errorf("API type mismatch: expected %s, got %s (must start a new chat)", chat.APIType, aiOpts.APIType)
		}
		if !uctypes.AreModelsCompatible(chat.APIType, chat.Model, aiOpts.Model) {
			return fmt.Errorf("model mismatch: expected %s, got %s (must start a new chat)", chat.Model, aiOpts.Model)
		}
		if chat.APIVersion != aiOpts.APIVersion {
			return fmt.Errorf("API version mismatch: expected %s, got %s (must start a new chat)", chat.APIVersion, aiOpts.APIVersion)
		}
	}
	chat.SessionMeta = cs.upsertSessionMetaLocked(chatId, aiOpts, uctypes.UIChatSessionMetaUpdate{})

	// Check for existing message with same ID (idempotency)
	messageId := message.GetMessageId()
	for i, existingMessage := range chat.NativeMessages {
		if existingMessage.GetMessageId() == messageId {
			// Replace existing message with same ID
			chat.NativeMessages[i] = message
			return nil
		}
	}

	// Append the new message if no duplicate found
	chat.NativeMessages = append(chat.NativeMessages, message)

	return nil
}

func (cs *ChatStore) RemoveMessage(chatId string, messageId string) bool {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		return false
	}

	initialLen := len(chat.NativeMessages)
	chat.NativeMessages = slices.DeleteFunc(chat.NativeMessages, func(msg uctypes.GenAIMessage) bool {
		return msg.GetMessageId() == messageId
	})

	return len(chat.NativeMessages) < initialLen
}
