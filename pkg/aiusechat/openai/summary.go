// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

type responseSummaryOutput struct {
	Output []struct {
		Type    string `json:"type"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
}

func GenerateSessionCheatsheet(ctx context.Context, opts uctypes.AIOptsType, prompt string) (string, error) {
	reqBody := &OpenAIRequest{
		Model:           opts.Model,
		Input:           []any{OpenAIMessage{Role: "user", Content: []OpenAIMessageContent{{Type: "input_text", Text: prompt}}}},
		Instructions:    "你是会话压缩器。只输出四行固定格式小抄，不要解释。",
		MaxOutputTokens: 160,
		Stream:          false,
		Text:            &TextType{Verbosity: "low"},
	}
	buf, err := aiutil.JsonEncodeRequestBody(reqBody)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, opts.Endpoint, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if opts.Provider == uctypes.AIProvider_Azure || opts.Provider == uctypes.AIProvider_AzureLegacy {
		req.Header.Set("api-key", opts.APIToken)
	} else {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}
	if opts.Provider == uctypes.AIProvider_Wave {
		req.Header.Set("X-Wave-Version", wavebase.WaveVersion)
		req.Header.Set("X-Wave-APIType", uctypes.APIType_OpenAIResponses)
	}
	client, err := aiutil.MakeHTTPClient(opts.ProxyURL)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("summary request failed: %s", strings.TrimSpace(string(body)))
	}
	var parsed responseSummaryOutput
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	for _, item := range parsed.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" && strings.TrimSpace(part.Text) != "" {
				return strings.TrimSpace(part.Text), nil
			}
		}
	}
	return "", fmt.Errorf("summary response missing text")
}
