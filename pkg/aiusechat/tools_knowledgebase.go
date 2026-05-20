// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/knowledgebase"
)

const MaxKbReadSize = 100 * 1024

type kbSearchParams struct {
	Query string `json:"query"`
}

func parseKbSearchParams(input any) (*kbSearchParams, error) {
	result := &kbSearchParams{}
	if input == nil {
		return nil, fmt.Errorf("query is required")
	}
	if m, ok := input.(map[string]any); ok {
		if q, ok := m["query"].(string); ok {
			result.Query = q
		}
	} else {
		return nil, fmt.Errorf("invalid input format")
	}
	if result.Query == "" {
		return nil, fmt.Errorf("missing query parameter")
	}
	return result, nil
}

type kbReadParams struct {
	RelPath string `json:"relpath"`
}

func parseKbReadParams(input any) (*kbReadParams, error) {
	result := &kbReadParams{}
	if input == nil {
		return nil, fmt.Errorf("relpath is required")
	}
	if m, ok := input.(map[string]any); ok {
		if rp, ok := m["relpath"].(string); ok {
			result.RelPath = rp
		}
	} else {
		return nil, fmt.Errorf("invalid input format")
	}
	if result.RelPath == "" {
		return nil, fmt.Errorf("missing relpath parameter")
	}
	return result, nil
}

func kbSearchCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseKbSearchParams(input)
	if err != nil {
		return nil, err
	}
	if err := knowledgebase.EnsureRoot(); err != nil {
		return nil, fmt.Errorf("error initializing knowledge base: %w", err)
	}
	results, err := knowledgebase.Search(params.Query)
	if err != nil {
		return nil, fmt.Errorf("error searching knowledge base: %w", err)
	}
	if len(results) == 0 {
		return map[string]any{
			"results": []any{},
			"count":   0,
		}, nil
	}
	return map[string]any{
		"results": results,
		"count":   len(results),
	}, nil
}

func kbReadCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseKbReadParams(input)
	if err != nil {
		return nil, err
	}
	if err := knowledgebase.EnsureRoot(); err != nil {
		return nil, fmt.Errorf("error initializing knowledge base: %w", err)
	}
	fileContent, err := knowledgebase.ReadFile(params.RelPath)
	if err != nil {
		return nil, fmt.Errorf("error reading knowledge base file: %w", err)
	}
	if fileContent.IsImage {
		return map[string]any{
			"content":  fileContent.Content,
			"is_image": true,
			"mime_type": fileContent.MimeType,
			"mtime_ms": fileContent.MtimeMs,
		}, nil
	}
	content := fileContent.Content
	truncated := false
	if len(content) > MaxKbReadSize {
		content = content[:MaxKbReadSize]
		truncated = true
	}
	result := map[string]any{
		"content":   content,
		"is_image":  false,
		"mtime_ms":  fileContent.MtimeMs,
		"truncated": truncated,
	}
	if truncated {
		result["note"] = fmt.Sprintf("File content truncated at %d bytes. The full file is larger.", MaxKbReadSize)
	}
	return result, nil
}

func GetKbSearchToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "kb_search",
		DisplayName: "Search Knowledge Base",
		Description: "Search the local knowledge base by filename. Returns a list of matching files with their names, relative paths, sizes, and modification times. Use this to find relevant documents before reading them with kb_read. Use query \"*\" or empty string to list all files.",
		ToolLogName: "gen:kbsearch",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "Search query to match against file names in the knowledge base",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseKbSearchParams(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("searching knowledge base for %q", params.Query)
		},
		ToolAnyCallback: kbSearchCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalAutoApproved
		},
	}
}

func GetKbReadToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "kb_read",
		DisplayName: "Read Knowledge Base File",
		Description: "Read a file from the local knowledge base by its relative path. Returns the file content. Text files are returned as UTF-8 strings (max 100KB, truncated if larger). Image files are returned as base64-encoded data. Use kb_search first to find relevant files.",
		ToolLogName: "gen:kbread",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"relpath": map[string]any{
					"type":        "string",
					"description": "Relative path of the file in the knowledge base",
				},
			},
			"required":             []string{"relpath"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseKbReadParams(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading knowledge base file %q", params.RelPath)
		},
		ToolAnyCallback: kbReadCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalAutoApproved
		},
	}
}

type kbWriteParams struct {
	RelPath string `json:"relpath"`
	Content string `json:"content"`
}

func parseKbWriteParams(input any) (*kbWriteParams, error) {
	result := &kbWriteParams{}
	if input == nil {
		return nil, fmt.Errorf("relpath and content are required")
	}
	if m, ok := input.(map[string]any); ok {
		if rp, ok := m["relpath"].(string); ok {
			result.RelPath = rp
		}
		if c, ok := m["content"].(string); ok {
			result.Content = c
		}
	} else {
		return nil, fmt.Errorf("invalid input format")
	}
	if result.RelPath == "" {
		return nil, fmt.Errorf("missing relpath parameter")
	}
	if result.Content == "" {
		return nil, fmt.Errorf("missing content parameter")
	}
	return result, nil
}

func kbWriteCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseKbWriteParams(input)
	if err != nil {
		return nil, err
	}
	if err := knowledgebase.EnsureRoot(); err != nil {
		return nil, fmt.Errorf("error initializing knowledge base: %w", err)
	}
	if err := knowledgebase.WriteFile(params.RelPath, params.Content); err != nil {
		return nil, fmt.Errorf("error writing knowledge base file: %w", err)
	}
	return map[string]any{
		"success":  true,
		"relpath":  params.RelPath,
		"size":     len(params.Content),
	}, nil
}

func GetKbWriteToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "kb_write",
		DisplayName: "Write Knowledge Base File",
		Description: "Write content to a file in the local knowledge base. If the file already exists, it will be overwritten. If the parent directory does not exist, the write will fail. Use kb_search to find existing files. To create a new file in a new directory, create the directory first.",
		ToolLogName: "gen:kbwrite",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"relpath": map[string]any{
					"type":        "string",
					"description": "Relative path of the file in the knowledge base",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "Text content to write to the file",
				},
			},
			"required":             []string{"relpath", "content"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseKbWriteParams(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("writing %d bytes to knowledge base file %q", len(params.Content), params.RelPath)
		},
		ToolAnyCallback: kbWriteCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalAutoApproved
		},
	}
}

type kbDeleteParams struct {
	RelPath string `json:"relpath"`
}

func parseKbDeleteParams(input any) (*kbDeleteParams, error) {
	result := &kbDeleteParams{}
	if input == nil {
		return nil, fmt.Errorf("relpath is required")
	}
	if m, ok := input.(map[string]any); ok {
		if rp, ok := m["relpath"].(string); ok {
			result.RelPath = rp
		}
	} else {
		return nil, fmt.Errorf("invalid input format")
	}
	if result.RelPath == "" {
		return nil, fmt.Errorf("missing relpath parameter")
	}
	return result, nil
}

func kbDeleteCallback(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	params, err := parseKbDeleteParams(input)
	if err != nil {
		return nil, err
	}
	if err := knowledgebase.EnsureRoot(); err != nil {
		return nil, fmt.Errorf("error initializing knowledge base: %w", err)
	}
	if err := knowledgebase.Delete(params.RelPath); err != nil {
		return nil, fmt.Errorf("error deleting knowledge base entry: %w", err)
	}
	return map[string]any{
		"success": true,
		"relpath": params.RelPath,
	}, nil
}

func GetKbDeleteToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "kb_delete",
		DisplayName: "Delete Knowledge Base Entry",
		Description: "Delete a file or directory from the local knowledge base by its relative path. If the path points to a directory, all contents will be recursively deleted. Use kb_search to find files before deleting. This action cannot be undone.",
		ToolLogName: "gen:kbdelete",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"relpath": map[string]any{
					"type":        "string",
					"description": "Relative path of the file or directory to delete from the knowledge base",
				},
			},
			"required":             []string{"relpath"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			params, err := parseKbDeleteParams(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("deleting knowledge base entry %q", params.RelPath)
		},
		ToolAnyCallback: kbDeleteCallback,
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string {
			return uctypes.ApprovalAutoApproved
		},
	}
}
