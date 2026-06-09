// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestSendAIMetricsTelemetryDoesNotPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("sendAIMetricsTelemetry panicked: %v", r)
		}
	}()

	metrics := &uctypes.AIMetrics{
		ChatId:  "test-chat",
		StepNum: 1,
		Usage: uctypes.AIUsage{
			APIType: "openai-responses",
			Model:   "gpt-4o",
		},
	}

	sendAIMetricsTelemetry(context.Background(), metrics)
}

func TestSendAIMetricsTelemetryZeroValueMetricsDoesNotPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("sendAIMetricsTelemetry panicked with zero-value metrics: %v", r)
		}
	}()

	var metrics uctypes.AIMetrics
	sendAIMetricsTelemetry(context.Background(), &metrics)
}
