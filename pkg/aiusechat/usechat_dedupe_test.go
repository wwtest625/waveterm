package aiusechat

import (
	"encoding/json"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func makeToolCallForDedup(id, name string, input any, approval string) uctypes.WaveToolCall {
	return uctypes.WaveToolCall{
		ID:    id,
		Name:  name,
		Input: input,
		ToolUseData: &uctypes.UIMessageDataToolUse{
			ToolCallId: id,
			ToolName:   name,
			Approval:   approval,
		},
	}
}

func TestBuildToolCallDedupKeys(t *testing.T) {
	calls := []uctypes.WaveToolCall{
		makeToolCallForDedup("call-1", "wave_run_command", map[string]any{"command": "pwd", "timeout_ms": 1000}, uctypes.ApprovalNeedsApproval),
		makeToolCallForDedup("call-2", "wave_run_command", map[string]any{"command": "pwd", "timeout_ms": 1000}, uctypes.ApprovalNeedsApproval),
		makeToolCallForDedup("call-3", "write_text_file", map[string]any{"filename": "out.txt"}, uctypes.ApprovalNeedsApproval),
	}

	keys := buildToolCallDedupKeys(calls)
	if len(keys) != 3 {
		t.Fatalf("expected 3 keys, got %d", len(keys))
	}
	if keys[0] != keys[1] {
		t.Fatalf("expected identical calls to share dedup key, got %q vs %q", keys[0], keys[1])
	}
	if keys[0] == keys[2] {
		t.Fatalf("expected different calls to have different keys, got %q", keys[0])
	}
}

func TestBuildToolCallDedupKeyStableJSONOrdering(t *testing.T) {
	inputA := map[string]any{"command": "pwd", "timeout_ms": 1000}
	inputB := map[string]any{"timeout_ms": 1000, "command": "pwd"}

	keyA, err := buildToolCallDedupKey("wave_run_command", inputA)
	if err != nil {
		t.Fatalf("unexpected error for inputA: %v", err)
	}
	keyB, err := buildToolCallDedupKey("wave_run_command", inputB)
	if err != nil {
		t.Fatalf("unexpected error for inputB: %v", err)
	}
	if keyA != keyB {
		encodedA, _ := json.Marshal(inputA)
		encodedB, _ := json.Marshal(inputB)
		t.Fatalf("expected stable keys, got %q vs %q (json %s vs %s)", keyA, keyB, encodedA, encodedB)
	}
}
