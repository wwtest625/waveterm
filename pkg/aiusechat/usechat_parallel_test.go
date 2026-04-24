package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func makeToolCallForPlan(name string, approval string) uctypes.WaveToolCall {
	return uctypes.WaveToolCall{
		ID:   name + "-id",
		Name: name,
		ToolUseData: &uctypes.UIMessageDataToolUse{
			ToolCallId: name + "-id",
			ToolName:   name,
			Approval:   approval,
		},
	}
}

func TestBuildToolExecutionPlan(t *testing.T) {
	toolCalls := []uctypes.WaveToolCall{
		makeToolCallForPlan("builder_list_files", uctypes.ApprovalAutoApproved),
		makeToolCallForPlan("wave_run_command", uctypes.ApprovalAutoApproved),
		makeToolCallForPlan("write_text_file", uctypes.ApprovalNeedsApproval),
		makeToolCallForPlan("wave_get_command_result", uctypes.ApprovalAutoApproved),
		makeToolCallForPlan("edit_text_file", uctypes.ApprovalNeedsApproval),
	}

	plan := buildToolExecutionPlan(toolCalls)
	if len(plan) != 5 {
		t.Fatalf("expected 5 execution groups, got %d", len(plan))
	}

	if !plan[0].Parallel || plan[0].Start != 0 || plan[0].End != 1 {
		t.Fatalf("expected first group to be parallel [0,1), got %+v", plan[0])
	}
	if plan[1].Parallel || plan[1].Start != 1 || plan[1].End != 2 {
		t.Fatalf("expected second group to be sequential [1,2), got %+v", plan[1])
	}
	if plan[2].Parallel || plan[2].Start != 2 || plan[2].End != 3 {
		t.Fatalf("expected third group to be sequential [2,3), got %+v", plan[2])
	}
	if plan[3].Parallel || plan[3].Start != 3 || plan[3].End != 4 {
		t.Fatalf("expected fourth group to be sequential [3,4), got %+v", plan[3])
	}
	if plan[4].Parallel || plan[4].Start != 4 || plan[4].End != 5 {
		t.Fatalf("expected fifth group to be sequential [4,5), got %+v", plan[4])
	}
}
