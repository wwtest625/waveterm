// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// ExtractXmlAttribute extracts an attribute value from an XML-like tag.
// Expects double-quoted strings where internal quotes are encoded as &quot;.
// Returns the unquoted value and true if found, or empty string and false if not found or invalid.
func ExtractXmlAttribute(tag, attrName string) (string, bool) {
	attrStart := strings.Index(tag, attrName+"=")
	if attrStart == -1 {
		return "", false
	}

	pos := attrStart + len(attrName+"=")
	start := strings.Index(tag[pos:], `"`)
	if start == -1 {
		return "", false
	}
	start += pos

	end := strings.Index(tag[start+1:], `"`)
	if end == -1 {
		return "", false
	}
	end += start + 1

	quotedValue := tag[start : end+1]
	value, err := strconv.Unquote(quotedValue)
	if err != nil {
		return "", false
	}

	value = strings.ReplaceAll(value, "&quot;", `"`)
	return value, true
}

// GenerateDeterministicSuffix creates an 8-character hash from input strings
func GenerateDeterministicSuffix(inputs ...string) string {
	hasher := sha256.New()
	for _, input := range inputs {
		hasher.Write([]byte(input))
	}
	hash := hasher.Sum(nil)
	return hex.EncodeToString(hash)[:8]
}

// ExtractImageUrl extracts an image URL from either URL field (http/https/data) or raw Data
func ExtractImageUrl(data []byte, url, mimeType string) (string, error) {
	if url != "" {
		if !strings.HasPrefix(url, "data:") &&
			!strings.HasPrefix(url, "http://") &&
			!strings.HasPrefix(url, "https://") {
			return "", fmt.Errorf("unsupported URL protocol in file part: %s", url)
		}
		return url, nil
	}
	if len(data) > 0 {
		base64Data := base64.StdEncoding.EncodeToString(data)
		return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
	}
	return "", fmt.Errorf("file part missing both url and data")
}

// ExtractTextData extracts text data from either Data field or URL field (data: URLs only)
func ExtractTextData(data []byte, url string) ([]byte, error) {
	if len(data) > 0 {
		return data, nil
	}
	if url != "" {
		if strings.HasPrefix(url, "data:") {
			_, decodedData, err := utilfn.DecodeDataURL(url)
			if err != nil {
				return nil, fmt.Errorf("failed to decode data URL for text/plain file: %w", err)
			}
			return decodedData, nil
		}
		return nil, fmt.Errorf("dropping text/plain file with URL (must be fetched and converted to data)")
	}
	return nil, fmt.Errorf("text/plain file part missing data")
}

// FormatAttachedTextFile formats a text file attachment with proper encoding and deterministic suffix
func FormatAttachedTextFile(fileName string, textContent []byte) string {
	if fileName == "" {
		fileName = "untitled.txt"
	}

	encodedFileName := strings.ReplaceAll(fileName, `"`, "&quot;")
	quotedFileName := strconv.Quote(encodedFileName)

	textStr := string(textContent)
	deterministicSuffix := GenerateDeterministicSuffix(textStr, fileName)
	return fmt.Sprintf("<AttachedTextFile_%s file_name=%s>\n%s\n</AttachedTextFile_%s>", deterministicSuffix, quotedFileName, textStr, deterministicSuffix)
}

// FormatAttachedDirectoryListing formats a directory listing attachment with proper encoding and deterministic suffix
func FormatAttachedDirectoryListing(directoryName, jsonContent string) string {
	if directoryName == "" {
		directoryName = "unnamed-directory"
	}

	encodedDirName := strings.ReplaceAll(directoryName, `"`, "&quot;")
	quotedDirName := strconv.Quote(encodedDirName)

	deterministicSuffix := GenerateDeterministicSuffix(jsonContent, directoryName)
	return fmt.Sprintf("<AttachedDirectoryListing_%s directory_name=%s>\n%s\n</AttachedDirectoryListing_%s>", deterministicSuffix, quotedDirName, jsonContent, deterministicSuffix)
}

// ConvertDataUserFile converts OpenAI attached file/directory blocks to UIMessagePart
// Returns (found, part) where found indicates if the prefix was matched,
// and part is the converted UIMessagePart (can be nil if parsing failed)
func ConvertDataUserFile(blockText string) (bool, *uctypes.UIMessagePart) {
	if strings.HasPrefix(blockText, "<AttachedTextFile_") {
		openTagEnd := strings.Index(blockText, "\n")
		if openTagEnd == -1 || blockText[openTagEnd-1] != '>' {
			return true, nil
		}

		openTag := blockText[:openTagEnd]
		fileName, ok := ExtractXmlAttribute(openTag, "file_name")
		if !ok {
			return true, nil
		}

		return true, &uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName: fileName,
				MimeType: "text/plain",
			},
		}
	}

	if strings.HasPrefix(blockText, "<AttachedDirectoryListing_") {
		openTagEnd := strings.Index(blockText, "\n")
		if openTagEnd == -1 || blockText[openTagEnd-1] != '>' {
			return true, nil
		}

		openTag := blockText[:openTagEnd]
		directoryName, ok := ExtractXmlAttribute(openTag, "directory_name")
		if !ok {
			return true, nil
		}

		return true, &uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName: directoryName,
				MimeType: "directory",
			},
		}
	}

	return false, nil
}

func JsonEncodeRequestBody(reqBody any) (bytes.Buffer, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(reqBody)
	if err != nil {
		return buf, err
	}
	return buf, nil
}

func MakeHTTPClient(proxyURL string) (*http.Client, error) {
	baseTransport := http.DefaultTransport
	if proxyURL != "" {
		pURL, err := url.Parse(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}
		baseTransport = &http.Transport{
			Proxy: http.ProxyURL(pURL),
		}
	}
	client := &http.Client{
		Timeout:   0,
		Transport: &retryTransport{base: baseTransport},
	}
	return client, nil
}

const (
	retryMaxAttempts = 3
	retryBaseDelay   = 1 * time.Second
	retryMaxDelay    = 10 * time.Second
	apiMinInterval   = 500 * time.Millisecond
)

var apiIntervalMu sync.Mutex
var apiLastRequestTime time.Time

type retryTransport struct {
	base http.RoundTripper
}

func (t *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	waitForAPIInterval(req.Context())

	var bodyBytes []byte
	if req.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(req.Body)
		req.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read request body for retry: %w", err)
		}
	}

	var lastErr error
	for attempt := 0; attempt < retryMaxAttempts; attempt++ {
		if attempt > 0 {
			delay := calcRetryDelay(attempt, nil)
			log.Printf("api retry attempt %d/%d after %v", attempt+1, retryMaxAttempts, delay)
			select {
			case <-req.Context().Done():
				return nil, req.Context().Err()
			case <-time.After(delay):
			}
		}

		if bodyBytes != nil {
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			req.GetBody = func() (io.ReadCloser, error) {
				return io.NopCloser(bytes.NewReader(bodyBytes)), nil
			}
		}

		resp, err := t.base.RoundTrip(req)
		if err != nil {
			lastErr = err
			if isRetryableErr(err) && attempt < retryMaxAttempts-1 {
				continue
			}
			return nil, err
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			if attempt < retryMaxAttempts-1 {
				delay := calcRetryDelay(attempt, resp)
				resp.Body.Close()
				log.Printf("api 429 rate limit, retry attempt %d/%d after %v", attempt+1, retryMaxAttempts, delay)
				select {
				case <-req.Context().Done():
					return nil, req.Context().Err()
				case <-time.After(delay):
				}
				continue
			}
			log.Printf("api 429 rate limit, max retries (%d) exhausted", retryMaxAttempts)
			return resp, nil
		}

		if resp.StatusCode >= 500 && attempt < retryMaxAttempts-1 {
			resp.Body.Close()
			lastErr = fmt.Errorf("server error: %s", resp.Status)
			continue
		}

		return resp, nil
	}

	return nil, fmt.Errorf("max retries exhausted: %w", lastErr)
}

func calcRetryDelay(attempt int, resp *http.Response) time.Duration {
	if resp != nil {
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if seconds, err := strconv.Atoi(ra); err == nil && seconds > 0 {
				delay := time.Duration(seconds) * time.Second
				if delay > retryMaxDelay {
					return retryMaxDelay
				}
				return delay
			}
			if t, err := http.ParseTime(ra); err == nil {
				delay := time.Until(t)
				if delay > 0 && delay <= retryMaxDelay {
					return delay
				}
				if delay > retryMaxDelay {
					return retryMaxDelay
				}
			}
		}
	}
	delay := retryBaseDelay * time.Duration(1<<uint(attempt))
	if delay > retryMaxDelay {
		return retryMaxDelay
	}
	return delay
}

func isRetryableErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "connection refused") ||
		strings.Contains(err.Error(), "connection reset") ||
		strings.Contains(err.Error(), "EOF") ||
		strings.Contains(err.Error(), "timeout") ||
		strings.Contains(err.Error(), "temporary")
}

func waitForAPIInterval(ctx context.Context) {
	apiIntervalMu.Lock()
	elapsed := time.Since(apiLastRequestTime)
	apiIntervalMu.Unlock()

	if elapsed < apiMinInterval {
		wait := apiMinInterval - elapsed
		select {
		case <-ctx.Done():
		case <-time.After(wait):
		}
	}

	apiIntervalMu.Lock()
	apiLastRequestTime = time.Now()
	apiIntervalMu.Unlock()
}

func IsOpenAIReasoningModel(model string) bool {
	m := strings.ToLower(model)
	return CheckModelPrefix(m, "o1") ||
		CheckModelPrefix(m, "o3") ||
		CheckModelPrefix(m, "o4") ||
		CheckModelPrefix(m, "gpt-5") ||
		CheckModelSubPrefix(m, "gpt-5.") ||
		CheckModelPrefix(m, "gpt-6") ||
		CheckModelSubPrefix(m, "gpt-6.")
}

func CheckModelPrefix(model string, prefix string) bool {
	return model == prefix || strings.HasPrefix(model, prefix+"-")
}

func CheckModelSubPrefix(model string, prefix string) bool {
	if strings.HasPrefix(model, prefix) && len(model) > len(prefix) {
		if model[len(prefix)] >= '0' && model[len(prefix)] <= '9' {
			return true
		}
	}
	return false
}

// GeminiSupportsImageToolResults returns true if the model supports multimodal function responses (images in tool results)
// This is only supported by Gemini 3 Pro and later models
func GeminiSupportsImageToolResults(model string) bool {
	m := strings.ToLower(model)
	return strings.Contains(m, "gemini-3") || strings.Contains(m, "gemini-4")
}

// CreateToolUseData creates a UIMessageDataToolUse from tool call information
func CreateToolUseData(toolCallID, toolName string, arguments string, chatOpts uctypes.WaveChatOpts) uctypes.UIMessageDataToolUse {
	toolUseData := uctypes.UIMessageDataToolUse{
		ToolCallId: toolCallID,
		ToolName:   toolName,
		Status:     uctypes.ToolUseStatusPending,
	}
	if chatOpts.TabId != "" {
		toolUseData.TabId = chatOpts.TabId
	}
	if chatOpts.BlockId != "" {
		toolUseData.BlockId = chatOpts.BlockId
	}

	toolDef := chatOpts.GetToolDefinition(toolName)
	if toolDef == nil {
		toolUseData.Status = uctypes.ToolUseStatusError
		toolUseData.ErrorMessage = "tool not found"
		return toolUseData
	}

	var parsedArgs any
	if err := json.Unmarshal([]byte(arguments), &parsedArgs); err != nil {
		toolUseData.Status = uctypes.ToolUseStatusError
		toolUseData.ErrorMessage = fmt.Sprintf("failed to parse tool arguments: %v", err)
		return toolUseData
	}

	if toolDef.ToolCallDesc != nil {
		toolUseData.ToolDesc = toolDef.ToolCallDesc(parsedArgs, nil, nil)
	}

	if toolDef.ToolApproval != nil {
		toolUseData.Approval = toolDef.ToolApproval(parsedArgs)
	}

	if chatOpts.TabId != "" {
		if argsMap, ok := parsedArgs.(map[string]any); ok {
			if widgetId, ok := argsMap["widget_id"].(string); ok && widgetId != "" {
				ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancelFn()
				fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, chatOpts.TabId, widgetId)
				if err == nil {
					toolUseData.BlockId = fullBlockId
				}
			}
		}
	}

	return toolUseData
}

// SendToolProgress sends tool progress updates via SSE if the tool has a progress descriptor
func SendToolProgress(toolCallID, toolName string, jsonData []byte, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, usePartialParse bool) {
	toolDef := chatOpts.GetToolDefinition(toolName)
	if toolDef == nil || toolDef.ToolProgressDesc == nil {
		return
	}

	var parsedJSON any
	var err error
	if usePartialParse {
		parsedJSON, err = utilfn.ParsePartialJson(jsonData)
	} else {
		err = json.Unmarshal(jsonData, &parsedJSON)
	}
	if err != nil {
		return
	}

	statusLines, err := toolDef.ToolProgressDesc(parsedJSON)
	if err != nil {
		return
	}

	progressData := &uctypes.UIMessageDataToolProgress{
		ToolCallId:  toolCallID,
		ToolName:    toolName,
		StatusLines: statusLines,
	}
	_ = sseHandler.AiMsgData("data-toolprogress", "progress-"+toolCallID, progressData)
}
