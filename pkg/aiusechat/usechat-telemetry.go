// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
)

// sendAIMetricsTelemetry emits a single "waveai:post" telemetry event summarizing
// the just-completed chat run. Errors are intentionally swallowed; telemetry must
// never fail the caller.
func sendAIMetricsTelemetry(ctx context.Context, metrics *uctypes.AIMetrics) {
	event := telemetrydata.MakeTEvent("waveai:post", telemetrydata.TEventProps{
		WaveAIAPIType:               metrics.Usage.APIType,
		WaveAIModel:                 metrics.Usage.Model,
		WaveAIChatId:                metrics.ChatId,
		WaveAIStepNum:               metrics.StepNum,
		WaveAIInputTokens:           metrics.Usage.InputTokens,
		WaveAIOutputTokens:          metrics.Usage.OutputTokens,
		WaveAINativeWebSearchCount:  metrics.Usage.NativeWebSearchCount,
		WaveAIRequestCount:          metrics.RequestCount,
		WaveAIToolUseCount:          metrics.ToolUseCount,
		WaveAIToolUseErrorCount:     metrics.ToolUseErrorCount,
		WaveAITabStateRefreshCount:  metrics.TabStateRefreshCount,
		WaveAIToolDetail:            metrics.ToolDetail,
		WaveAIPremiumReq:            metrics.PremiumReqCount,
		WaveAIProxyReq:              metrics.ProxyReqCount,
		WaveAIHadError:              metrics.HadError,
		WaveAIImageCount:            metrics.ImageCount,
		WaveAIPDFCount:              metrics.PDFCount,
		WaveAITextDocCount:          metrics.TextDocCount,
		WaveAITextLen:               metrics.TextLen,
		WaveAIFirstByteMs:           metrics.FirstByteLatency,
		WaveAIRequestDurMs:          metrics.RequestDuration,
		WaveAIWidgetAccess:          metrics.WidgetAccess,
		WaveAIThinkingLevel:         metrics.ThinkingLevel,
		WaveAIMode:                  metrics.AIMode,
		WaveAIProvider:              metrics.AIProvider,
		WaveAIIsLocal:               metrics.IsLocal,
	})
	_ = telemetry.RecordTEvent(ctx, event)
}
