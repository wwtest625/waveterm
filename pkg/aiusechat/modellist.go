// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
)

type ModelListRequest struct {
	Provider   string `json:"provider"`
	Endpoint   string `json:"endpoint"`
	SecretName string `json:"secretName"`
	ModeKey    string `json:"modeKey"`
}

type ModelInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Object string `json:"object"`
}

type ModelListResponse struct {
	Models []ModelInfo `json:"models"`
	Error  string     `json:"error,omitempty"`
}

func WaveAIGetModelListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ModelListRequest
	if r.Method == http.MethodGet {
		req.Provider = r.URL.Query().Get("provider")
		req.Endpoint = r.URL.Query().Get("endpoint")
		req.SecretName = r.URL.Query().Get("secret")
		req.ModeKey = r.URL.Query().Get("modeKey")
	} else {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
			return
		}
	}

	models, err := fetchModelList(req.Provider, req.Endpoint, req.SecretName)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ModelListResponse{
			Models: []ModelInfo{},
			Error:  err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ModelListResponse{
		Models: models,
	})
}

func fetchModelList(provider, endpoint, secretName string) ([]ModelInfo, error) {
	if secretName != "" {
		secretValue, exists, err := secretstore.GetSecret(secretName)
		if err != nil {
			return nil, fmt.Errorf("failed to get secret: %v", err)
		}
		if !exists {
			return nil, fmt.Errorf("secret %q not found", secretName)
		}

		if endpoint == "" {
			endpoint = getDefaultEndpoint(provider)
		} else {
			endpoint = ensureModelListEndpoint(endpoint)
		}

		return callModelListAPI(endpoint, secretValue)
	}

	if endpoint != "" {
		endpoint = ensureModelListEndpoint(endpoint)
		return nil, fmt.Errorf("no API key configured. Please set ai:apitokensecretname in your config")
	}

	defaultEndpoint := getDefaultEndpoint(provider)
	if defaultEndpoint != "" {
		return nil, fmt.Errorf("no API key configured. Please add your API key as a secret and set ai:apitokensecretname")
	}

	return nil, fmt.Errorf("no endpoint or API key configured")
}

func ensureModelListEndpoint(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return endpoint
	}

	if strings.HasSuffix(endpoint, "/models") {
		return endpoint
	}

	if strings.HasSuffix(endpoint, "/v1") {
		return endpoint + "/models"
	}

	if strings.HasSuffix(endpoint, "/v1/chat/completions") {
		return strings.Replace(endpoint, "/v1/chat/completions", "/v1/models", 1)
	}

	return endpoint + "/v1/models"
}

func getDefaultEndpoint(provider string) string {
	switch provider {
	case "openai":
		return "https://api.openai.com/v1/models"
	case "openrouter":
		return "https://openrouter.ai/api/v1/models"
	case "groq":
		return "https://api.groq.com/openai/v1/models"
	case "nanogpt":
		return "https://nano-gpt.com/api/v1/models"
	case "google":
		return "https://generativelanguage.googleapis.com/v1/models"
	case "azure":
		return ""
	default:
		return ""
	}
}

func callModelListAPI(endpoint, apiKey string) ([]ModelInfo, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("no endpoint configured")
	}

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []ModelInfo `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %v", err)
	}

	return result.Data, nil
}
