// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import "github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"

func InitChatStorePersistence() {
	chatstore.DefaultChatStore.EnablePersistence(chatstore.DefaultPersistencePath())
}
