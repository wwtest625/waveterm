import { describe, expect, it } from "vitest";
import { deriveTaskProgressViewModel } from "../taskprogress";

describe("deriveTaskProgressViewModel", () => {
    it("builds a visible summary for an active plan", () => {
        const viewModel = deriveTaskProgressViewModel({
            version: 1,
            planid: "plan-1",
            source: "model-generated",
            status: "active",
            currenttaskid: "task-2",
            blockedreason: "",
            lastupdatedts: 123,
            summary: {
                total: 3,
                completed: 1,
                inprogress: 1,
                pending: 1,
                blocked: 0,
                percent: 33,
            },
            tasks: [
                { id: "task-1", title: "Map runtime", status: "completed", order: 0 },
                { id: "task-2", title: "Render task panel", status: "in_progress", order: 1 },
                { id: "task-3", title: "Verify session restore", status: "pending", order: 2 },
            ],
        });

        expect(viewModel.visible).toBe(true);
        expect(viewModel.completedLabel).toBe("1 / 3");
        expect(viewModel.percent).toBe(33);
        expect(viewModel.currentTaskTitle).toBe("Render task panel");
        expect(viewModel.items[1].isCurrent).toBe(true);
    });

    it("hides the card when there is no task state or no tasks", () => {
        expect(deriveTaskProgressViewModel(null).visible).toBe(false);
        expect(
            deriveTaskProgressViewModel({
                tasks: [],
                summary: {},
            })?.visible
        ).toBe(false);
    });
});
