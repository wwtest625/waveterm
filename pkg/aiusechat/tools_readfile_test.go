// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import "testing"

func TestGetReadTextFileToolDefinition_UsesOpenAICompatibleStrictSchema(t *testing.T) {
	tool := GetReadTextFileToolDefinition()
	properties, ok := tool.InputSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map, got %#v", tool.InputSchema["properties"])
	}
	required, ok := tool.InputSchema["required"].([]string)
	if !ok {
		t.Fatalf("expected required []string, got %#v", tool.InputSchema["required"])
	}
	requiredSet := make(map[string]bool, len(required))
	for _, key := range required {
		requiredSet[key] = true
	}
	for key := range properties {
		if !requiredSet[key] {
			t.Fatalf("expected strict schema to require property %q, got %#v", key, required)
		}
	}
}
