// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type messageCodec struct {
	encode func(uctypes.GenAIMessage) ([]byte, error)
	decode func([]byte) (uctypes.GenAIMessage, error)
}

var (
	messageCodecs  = map[string]messageCodec{}
	messageCodecMu sync.RWMutex
)

type chatStoreSnapshot struct {
	Version  int                          `json:"version"`
	Sessions []*uctypes.UIChatSessionMeta `json:"sessions,omitempty"`
	Chats    []*persistedChat             `json:"chats,omitempty"`
}

type persistedChat struct {
	ChatId         string                     `json:"chatid"`
	APIType        string                     `json:"apitype"`
	Model          string                     `json:"model"`
	APIVersion     string                     `json:"apiversion"`
	SessionMeta    *uctypes.UIChatSessionMeta `json:"sessionmeta,omitempty"`
	NativeMessages []json.RawMessage          `json:"nativemessages,omitempty"`
}

func RegisterMessageCodec(apiType string, encode func(uctypes.GenAIMessage) ([]byte, error), decode func([]byte) (uctypes.GenAIMessage, error)) {
	if apiType == "" || encode == nil || decode == nil {
		return
	}
	messageCodecMu.Lock()
	defer messageCodecMu.Unlock()
	messageCodecs[apiType] = messageCodec{encode: encode, decode: decode}
}

func lookupMessageCodec(apiType string) (messageCodec, bool) {
	messageCodecMu.RLock()
	defer messageCodecMu.RUnlock()
	codec, ok := messageCodecs[apiType]
	return codec, ok
}

func encodePersistedChat(chat *uctypes.AIChat) (*persistedChat, error) {
	if chat == nil {
		return nil, nil
	}
	persisted := &persistedChat{
		ChatId:      chat.ChatId,
		APIType:     chat.APIType,
		Model:       chat.Model,
		APIVersion:  chat.APIVersion,
		SessionMeta: copySessionMeta(chat.SessionMeta),
	}
	codec, ok := lookupMessageCodec(chat.APIType)
	if !ok {
		return nil, fmt.Errorf("no persistence codec registered for api type %q", chat.APIType)
	}
	for _, message := range chat.NativeMessages {
		if message == nil {
			continue
		}
		data, err := codec.encode(message)
		if err != nil {
			return nil, fmt.Errorf("encode chat %s message %s: %w", chat.ChatId, message.GetMessageId(), err)
		}
		persisted.NativeMessages = append(persisted.NativeMessages, json.RawMessage(data))
	}
	return persisted, nil
}

func decodePersistedChat(persisted *persistedChat) (*uctypes.AIChat, error) {
	if persisted == nil {
		return nil, nil
	}
	codec, ok := lookupMessageCodec(persisted.APIType)
	if !ok {
		return nil, fmt.Errorf("no persistence codec registered for api type %q", persisted.APIType)
	}
	chat := &uctypes.AIChat{
		ChatId:      persisted.ChatId,
		APIType:     persisted.APIType,
		Model:       persisted.Model,
		APIVersion:  persisted.APIVersion,
		SessionMeta: copySessionMeta(persisted.SessionMeta),
	}
	for idx, rawMessage := range persisted.NativeMessages {
		if len(rawMessage) == 0 {
			continue
		}
		message, err := codec.decode(rawMessage)
		if err != nil {
			return nil, fmt.Errorf("decode chat %s message %d: %w", persisted.ChatId, idx, err)
		}
		chat.NativeMessages = append(chat.NativeMessages, message)
	}
	return chat, nil
}

func loadChatStoreSnapshot(path string) (*struct {
	sessions map[string]*uctypes.UIChatSessionMeta
	chats    map[string]*uctypes.AIChat
}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &struct {
				sessions map[string]*uctypes.UIChatSessionMeta
				chats    map[string]*uctypes.AIChat
			}{
				sessions: map[string]*uctypes.UIChatSessionMeta{},
				chats:    map[string]*uctypes.AIChat{},
			}, nil
		}
		return nil, err
	}

	var persisted chatStoreSnapshot
	if err := json.Unmarshal(data, &persisted); err != nil {
		return nil, err
	}

	rtn := &struct {
		sessions map[string]*uctypes.UIChatSessionMeta
		chats    map[string]*uctypes.AIChat
	}{
		sessions: map[string]*uctypes.UIChatSessionMeta{},
		chats:    map[string]*uctypes.AIChat{},
	}

	for _, session := range persisted.Sessions {
		if session == nil || session.ChatId == "" {
			continue
		}
		rtn.sessions[session.ChatId] = session.Clone()
	}
	for _, persistedChat := range persisted.Chats {
		chat, err := decodePersistedChat(persistedChat)
		if err != nil {
			return nil, err
		}
		if chat == nil || chat.ChatId == "" {
			continue
		}
		rtn.chats[chat.ChatId] = chat
		if chat.SessionMeta != nil {
			rtn.sessions[chat.ChatId] = chat.SessionMeta.Clone()
		}
	}
	return rtn, nil
}
