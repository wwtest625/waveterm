// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const DefaultAPI = uctypes.APIType_OpenAIResponses
const DefaultMaxTokens = 4 * 1024
const BuilderMaxTokens = 24 * 1024

func getSystemPrompt(model string, isBuilder bool, agentMode AgentMode) []string {
	if isBuilder {
		return []string{}
	}
	modelLower := strings.ToLower(model)
	needsStrictToolAddOn, _ := regexp.MatchString(`(?i)\b(mistral|o?llama|qwen|mixtral|yi|phi|deepseek)\b`, modelLower)
	basePrompt := strings.TrimSpace(SystemPromptText_OpenAI)
	if !needsStrictToolAddOn {
		basePrompt = strings.TrimSpace(basePrompt + " " + SystemPromptText_ExecutionPolicyAddOn)
	}
	basePrompt = strings.TrimSpace(basePrompt + " " + getModeAwareSystemPromptText(agentMode))
	if needsStrictToolAddOn {
		return []string{basePrompt, SystemPromptText_StrictToolAddOn}
	}
	return []string{basePrompt}
}

func logWaveAIDebugRequest(chatOpts uctypes.WaveChatOpts, effectiveWidgetAccess bool) {
	if !wavebase.IsDevMode() {
		return
	}
	logutil.DevPrintf(
		"waveai request: chat=%s tab=%s block=%s builder=%s provider=%s apiType=%s model=%s mode=%s widgetAccess=%t effectiveWidgetAccess=%t capabilities=%v tools=%d tabTools=%d allowNativeWebSearch=%t\n",
		chatOpts.ChatId,
		chatOpts.TabId,
		chatOpts.BlockId,
		chatOpts.BuilderId,
		chatOpts.Config.Provider,
		chatOpts.Config.APIType,
		chatOpts.Config.Model,
		chatOpts.Config.AIMode,
		chatOpts.WidgetAccess,
		effectiveWidgetAccess,
		chatOpts.Config.Capabilities,
		len(chatOpts.Tools),
		len(chatOpts.TabTools),
		chatOpts.AllowNativeWebSearch,
	)
}

func isLocalEndpoint(endpoint string) bool {
	if endpoint == "" {
		return false
	}
	endpointLower := strings.ToLower(endpoint)
	return strings.Contains(endpointLower, "localhost") || strings.Contains(endpointLower, "127.0.0.1")
}

func getWaveAISettings(premium bool, builderMode bool, rtInfo waveobj.ObjRTInfo, aiModeName string) (*uctypes.AIOptsType, error) {
	maxTokens := DefaultMaxTokens
	if builderMode {
		maxTokens = BuilderMaxTokens
	}
	if rtInfo.WaveAIMaxOutputTokens > 0 {
		maxTokens = rtInfo.WaveAIMaxOutputTokens
	}
	aiMode, config, err := resolveAIMode(aiModeName, premium)
	if err != nil {
		return nil, err
	}
	if config.WaveAICloud && !telemetry.IsTelemetryEnabled() {
		return nil, fmt.Errorf("Wave AI cloud modes require telemetry to be enabled")
	}
	apiToken := config.APIToken
	if apiToken == "" && config.APITokenSecretName != "" {
		secret, exists, err := secretstore.GetSecret(config.APITokenSecretName)
		if err != nil {
			return nil, fmt.Errorf("failed to retrieve secret %s: %w", config.APITokenSecretName, err)
		}
		secret = strings.TrimSpace(secret)
		if !exists || secret == "" {
			return nil, fmt.Errorf("secret %s not found or empty", config.APITokenSecretName)
		}
		apiToken = secret
	}

	var baseUrl string
	if config.Endpoint != "" {
		baseUrl = normalizeOpenAIEndpointByAPIType(config.APIType, config.Endpoint)
	} else {
		return nil, fmt.Errorf("no ai:endpoint configured for AI mode %s", aiMode)
	}

	thinkingLevel := config.ThinkingLevel
	if thinkingLevel == "" {
		thinkingLevel = uctypes.ThinkingLevelMedium
	}
	verbosity := config.Verbosity
	if verbosity == "" {
		verbosity = uctypes.VerbosityLevelMedium // default to medium
	}
	opts := &uctypes.AIOptsType{
		Provider:      config.Provider,
		APIType:       config.APIType,
		Model:         config.Model,
		MaxTokens:     maxTokens,
		ThinkingLevel: thinkingLevel,
		Verbosity:     verbosity,
		AIMode:        aiMode,
		Endpoint:      baseUrl,
		ProxyURL:      config.ProxyURL,
		Capabilities:  config.Capabilities,
		WaveAIPremium: config.WaveAIPremium,
	}
	if apiToken != "" {
		opts.APIToken = apiToken
	}
	return opts, nil
}

func normalizeOpenAIEndpointByAPIType(apiType string, endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return endpoint
	}
	if apiType != uctypes.APIType_OpenAIChat && apiType != uctypes.APIType_OpenAIResponses {
		return endpoint
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return endpoint
	}
	path := strings.TrimSuffix(parsed.Path, "/")
	switch apiType {
	case uctypes.APIType_OpenAIChat:
		if strings.HasSuffix(path, "/chat/completions") {
			return endpoint
		}
		if path == "" {
			parsed.Path = "/v1/chat/completions"
			return parsed.String()
		}
		if strings.HasSuffix(path, "/v1") {
			parsed.Path = path + "/chat/completions"
			return parsed.String()
		}
	case uctypes.APIType_OpenAIResponses:
		if strings.HasSuffix(path, "/responses") {
			return endpoint
		}
		if path == "" {
			parsed.Path = "/v1/responses"
			return parsed.String()
		}
		if strings.HasSuffix(path, "/v1") {
			parsed.Path = path + "/responses"
			return parsed.String()
		}
	}
	return endpoint
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for legacy models.
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4"
}

func shouldUsePremium() bool {
	info := GetGlobalRateLimit()
	if info == nil || info.Unknown {
		return true
	}
	if info.PReq > 0 {
		return true
	}
	nowEpoch := time.Now().Unix()
	if nowEpoch >= info.ResetEpoch {
		return true
	}
	return false
}

func updateRateLimit(info *uctypes.RateLimitInfo) {
	defaultChatManager.updateRateLimit(info)
}

func GetGlobalRateLimit() *uctypes.RateLimitInfo {
	return defaultChatManager.getRateLimit()
}
