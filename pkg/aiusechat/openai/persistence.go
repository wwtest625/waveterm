// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"encoding/json"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func init() {
	chatstore.RegisterMessageCodec(uctypes.APIType_OpenAIResponses, func(message uctypes.GenAIMessage) ([]byte, error) {
		return json.Marshal(message)
	}, func(data []byte) (uctypes.GenAIMessage, error) {
		var message OpenAIChatMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return nil, err
		}
		return &message, nil
	})
}
