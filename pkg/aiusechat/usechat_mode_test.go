// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestApplyProviderDefaultsGroq(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_Groq,
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIChat {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIChat, config.APIType)
	}
	if config.Endpoint != GroqChatEndpoint {
		t.Fatalf("expected endpoint %q, got %q", GroqChatEndpoint, config.Endpoint)
	}
	if config.APITokenSecretName != GroqAPITokenSecretName {
		t.Fatalf("expected API token secret name %q, got %q", GroqAPITokenSecretName, config.APITokenSecretName)
	}
}

func TestApplyProviderDefaultsWaveEnablesToolsByDefault(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_Wave,
		Model:    "gpt-5-mini",
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIResponses {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIResponses, config.APIType)
	}
	if config.Endpoint != uctypes.DefaultAIEndpoint {
		t.Fatalf("expected endpoint %q, got %q", uctypes.DefaultAIEndpoint, config.Endpoint)
	}
	expectedCapabilities := []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
	if !slices.Equal(config.Capabilities, expectedCapabilities) {
		t.Fatalf("expected capabilities %#v, got %#v", expectedCapabilities, config.Capabilities)
	}
}

func TestApplyProviderDefaultsWavePreservesExplicitCapabilities(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider:     uctypes.AIProvider_Wave,
		Capabilities: []string{uctypes.AICapabilityTools},
	}
	applyProviderDefaults(&config)
	expectedCapabilities := []string{uctypes.AICapabilityTools}
	if !slices.Equal(config.Capabilities, expectedCapabilities) {
		t.Fatalf("expected explicit capabilities %#v to be preserved, got %#v", expectedCapabilities, config.Capabilities)
	}
}

func TestApplyProviderDefaultsKeepsProxyURL(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_OpenAI,
		Model:    "gpt-5-mini",
		ProxyURL: "http://localhost:8080",
	}
	applyProviderDefaults(&config)
	if config.ProxyURL != "http://localhost:8080" {
		t.Fatalf("expected proxy URL to be preserved, got %q", config.ProxyURL)
	}
}

func TestApplyProviderDefaultsOpenAIForcesResponsesForReasoningModels(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_OpenAI,
		Model:    "gpt-5.1",
		APIType:  uctypes.APIType_OpenAIChat,
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIResponses {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIResponses, config.APIType)
	}
}

func TestApplyProviderDefaultsAzureForcesResponsesForReasoningModels(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider:          uctypes.AIProvider_Azure,
		Model:             "o1-mini",
		APIType:           uctypes.APIType_OpenAIChat,
		AzureResourceName: "my-resource",
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIResponses {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIResponses, config.APIType)
	}
	if config.Endpoint != "https://my-resource.openai.azure.com/openai/v1/responses" {
		t.Fatalf("expected responses endpoint, got %q", config.Endpoint)
	}
}

func TestShouldUseChatCompletionsAPI(t *testing.T) {
	if !shouldUseChatCompletionsAPI("gpt-4") {
		t.Fatalf("expected gpt-4 to require chat completions API")
	}
	if !shouldUseChatCompletionsAPI("gpt-3.5-turbo") {
		t.Fatalf("expected gpt-3.5-turbo to require chat completions API")
	}
	if shouldUseChatCompletionsAPI("gpt-5.1") {
		t.Fatalf("expected gpt-5.1 to use responses API")
	}
	if shouldUseChatCompletionsAPI("o1-mini") {
		t.Fatalf("expected o1-mini to use responses API")
	}
}

func TestNormalizeOpenAIEndpointByAPIType(t *testing.T) {
	if got := normalizeOpenAIEndpointByAPIType(uctypes.APIType_OpenAIChat, "https://integrate.api.nvidia.com/v1"); got != "https://integrate.api.nvidia.com/v1/chat/completions" {
		t.Fatalf("unexpected chat endpoint normalization result: %q", got)
	}
	if got := normalizeOpenAIEndpointByAPIType(uctypes.APIType_OpenAIResponses, "https://api.openai.com/v1"); got != "https://api.openai.com/v1/responses" {
		t.Fatalf("unexpected responses endpoint normalization result: %q", got)
	}
	if got := normalizeOpenAIEndpointByAPIType(uctypes.APIType_OpenAIChat, "https://api.openai.com/v1/chat/completions"); got != "https://api.openai.com/v1/chat/completions" {
		t.Fatalf("expected endpoint to stay unchanged, got %q", got)
	}
}
