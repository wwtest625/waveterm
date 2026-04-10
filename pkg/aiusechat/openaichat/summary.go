// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type chatSummaryResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func GenerateSessionCheatsheet(ctx context.Context, opts uctypes.AIOptsType, prompt string) (string, error) {
	reqBody := ChatRequest{
		Model: opts.Model,
		Messages: []ChatRequestMessage{
			{
				Role:    "system",
				Content: "你是会话压缩器。只输出四行固定格式小抄，不要解释。",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Stream:      false,
		MaxTokens:   160,
		Temperature: 0.1,
	}
	if aiutil.IsOpenAIReasoningModel(opts.Model) {
		reqBody.MaxCompletionTokens = 160
		reqBody.MaxTokens = 0
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, opts.Endpoint, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if opts.Provider == uctypes.AIProvider_Azure || opts.Provider == uctypes.AIProvider_AzureLegacy {
		req.Header.Set("api-key", opts.APIToken)
	} else {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
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
	var parsed chatSummaryResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("summary response missing choices")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}
