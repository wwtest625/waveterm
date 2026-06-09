// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const waveCommandJobCleanupInterval = 5 * time.Minute

func init() {
	go func() {
		ticker := time.NewTicker(waveCommandJobCleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			defaultChatManager.commandJobMu.Lock()
			defaultChatManager.cleanupCommandJobsLocked(time.Now())
			defaultChatManager.commandJobMu.Unlock()
		}
	}()
}

type ChatManager struct {
	rateLimitInfo *uctypes.RateLimitInfo
	rateLimitLock sync.Mutex
	activeChats   *ds.SyncMap[bool]

	tuiAutoCancelMu      sync.Mutex
	tuiAutoCancelledJobs map[string]bool

	commandPollerMu sync.Mutex
	commandPollers  map[string]struct{}

	commandJobMu sync.Mutex
	commandJobs  map[string]waveCommandJobEntry
}

var defaultChatManager = NewChatManager()

func NewChatManager() *ChatManager {
	return &ChatManager{
		rateLimitInfo:        &uctypes.RateLimitInfo{Unknown: true},
		activeChats:          ds.MakeSyncMap[bool](),
		tuiAutoCancelledJobs: make(map[string]bool),
		commandPollers:       make(map[string]struct{}),
		commandJobs:          make(map[string]waveCommandJobEntry),
	}
}

func (cm *ChatManager) updateRateLimit(info *uctypes.RateLimitInfo) {
	if info == nil {
		return
	}
	cm.rateLimitLock.Lock()
	defer cm.rateLimitLock.Unlock()
	cm.rateLimitInfo = info
	go func() {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_WaveAIRateLimit,
			Data:  info,
		})
	}()
}

func (cm *ChatManager) getRateLimit() *uctypes.RateLimitInfo {
	cm.rateLimitLock.Lock()
	defer cm.rateLimitLock.Unlock()
	return cm.rateLimitInfo
}

func (cm *ChatManager) cleanupCommandJobsLocked(now time.Time) {
	for jobID, entry := range cm.commandJobs {
		if now.Sub(entry.updatedAt) > waveCommandJobRetention {
			delete(cm.commandJobs, jobID)
		}
	}
	if len(cm.commandJobs) <= waveCommandJobMaxCount {
		return
	}
	for len(cm.commandJobs) > waveCommandJobMaxCount {
		oldestJobID := ""
		var oldestAt time.Time
		for jobID, entry := range cm.commandJobs {
			if oldestJobID == "" || entry.updatedAt.Before(oldestAt) {
				oldestJobID = jobID
				oldestAt = entry.updatedAt
			}
		}
		if oldestJobID == "" {
			return
		}
		delete(cm.commandJobs, oldestJobID)
	}
}

func (cm *ChatManager) rememberCommandJob(jobID string, commandText string) {
	trimmedJobID := strings.TrimSpace(jobID)
	if trimmedJobID == "" {
		return
	}
	cm.commandJobMu.Lock()
	defer cm.commandJobMu.Unlock()
	now := time.Now()
	cm.cleanupCommandJobsLocked(now)
	trimmedCommand := strings.TrimSpace(commandText)
	if trimmedCommand == "" {
		delete(cm.commandJobs, trimmedJobID)
	} else {
		cm.commandJobs[trimmedJobID] = waveCommandJobEntry{
			commandText: trimmedCommand,
			updatedAt:   now,
		}
	}
}

func (cm *ChatManager) lookupCommandJob(jobID string) string {
	trimmedJobID := strings.TrimSpace(jobID)
	if trimmedJobID == "" {
		return ""
	}
	cm.commandJobMu.Lock()
	defer cm.commandJobMu.Unlock()
	entry, found := cm.commandJobs[trimmedJobID]
	if !found {
		return ""
	}
	if time.Since(entry.updatedAt) > waveCommandJobRetention {
		delete(cm.commandJobs, trimmedJobID)
		return ""
	}
	return entry.commandText
}

type waveCommandJobEntry struct {
	commandText string
	updatedAt   time.Time
}

const (
	waveCommandJobRetention = 60 * time.Minute
	waveCommandJobMaxCount  = 2048
)

func cleanupWaveCommandJobsLocked(now time.Time) {
	defaultChatManager.cleanupCommandJobsLocked(now)
}

func rememberWaveCommandJob(jobID string, commandText string) {
	defaultChatManager.rememberCommandJob(jobID, commandText)
}

func lookupWaveCommandJob(jobID string) string {
	return defaultChatManager.lookupCommandJob(jobID)
}
