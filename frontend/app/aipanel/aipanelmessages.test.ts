import { describe, expect, it } from "vitest";
import { getAssistantMessageLayout } from "./aimessage";
import { buildTaskChainSteps, buildTaskTurns, getRawOutputDisplayState } from "./aipanelmessages";
import { getToolDisplayName, summarizeToolGroup } from "./aitooluse";

describe("aipanel task turns", () => {
    it("groups multiple assistant retries into one turn", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "帮我查看cpu型号" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-1",
                                toolname: "wave_run_command",
                                tooldesc: 'running "lscpu"',
                                status: "error",
                            },
                        },
                    ],
                } as any,
                {
                    id: "assistant-2",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-2",
                                toolname: "wave_run_command",
                                tooldesc: 'running "grep"',
                                status: "completed",
                            },
                        },
                        {
                            type: "text",
                            text: "CPU 型号是 Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz。",
                        },
                    ],
                } as any,
            ],
            "ready"
        );

        expect(turns).toHaveLength(1);
        expect(turns[0].assistantMessages).toHaveLength(2);
        expect(turns[0].userMessage?.id).toBe("user-1");
    });

    it("creates a new turn when a new user message arrives", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "第一问" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [{ type: "text", text: "第一答" }],
                } as any,
                {
                    id: "user-2",
                    role: "user",
                    parts: [{ type: "text", text: "第二问" }],
                } as any,
                {
                    id: "assistant-2",
                    role: "assistant",
                    parts: [{ type: "text", text: "第二答" }],
                } as any,
            ],
            "ready"
        );

        expect(turns).toHaveLength(2);
        expect(turns[0].assistantMessages).toHaveLength(1);
        expect(turns[1].assistantMessages).toHaveLength(1);
    });

    it("keeps the latest user turn streaming before the assistant message lands", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "继续执行" }],
                } as any,
            ],
            "streaming"
        );

        expect(turns).toHaveLength(1);
        expect(turns[0].userMessage?.id).toBe("user-1");
        expect(turns[0].assistantMessages).toHaveLength(0);
        expect(turns[0].isStreaming).toBe(true);
    });

    it("builds task chain steps with status mapping", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "uname -a"',
                        status: "completed",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling result",
                        status: "pending",
                    },
                } as any,
                {
                    type: "data-toolprogress",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        statuslines: ["polling command result for 123"],
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-3",
                        toolname: "wave_run_command",
                        tooldesc: 'running "bad"',
                        status: "error",
                        errormessage: "failed",
                    },
                } as any,
            ],
            true
        );

        expect(steps).toHaveLength(3);
        expect(steps[0].title).toBe("执行命令");
        expect(steps[0].status).toBe("completed");
        expect(steps[1].title).toBe("获取执行结果");
        expect(steps[1].status).toBe("running");
        expect(steps[1].detail).toContain("polling command result");
        expect(steps[2].status).toBe("failed");
    });

    it("collapses raw output after five lines", () => {
        const state = getRawOutputDisplayState("one\ntwo\nthree\nfour\nfive\nsix");

        expect(state.lineCount).toBe(6);
        expect(state.shouldCollapse).toBe(true);
        expect(state.collapsedText).toBe("one\ntwo\nthree\nfour\nfive");
        expect(state.expandedText).toBe("one\ntwo\nthree\nfour\nfive\nsix");
    });
});

describe("assistant message layout", () => {
    it("hides completed tool-only assistant messages", () => {
        const layout = getAssistantMessageLayout(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "lscpu"',
                        status: "completed",
                    },
                } as any,
            ],
            false
        );

        expect(layout.hasVisibleText).toBe(false);
        expect(layout.hideToolOnlyMessage).toBe(true);
        expect(layout.toolParts).toHaveLength(1);
    });

    it("keeps tool details for assistant messages that have final text", () => {
        const layout = getAssistantMessageLayout(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "lscpu"',
                        status: "completed",
                    },
                } as any,
                {
                    type: "text",
                    text: "服务器 CPU 型号是 Intel Xeon Platinum 8369C。",
                } as any,
            ],
            false
        );

        expect(layout.hasVisibleText).toBe(true);
        expect(layout.hideToolOnlyMessage).toBe(false);
        expect(layout.textParts).toHaveLength(1);
        expect(layout.toolParts).toHaveLength(1);
    });
});

describe("aitooluse summaries", () => {
    it("maps internal tool names to user-facing labels", () => {
        expect(getToolDisplayName("wave_run_command")).toBe("执行命令");
        expect(getToolDisplayName("edit_text_file")).toBe("精准编辑");
    });

    it("collapses successful tool groups by default", () => {
        const summary = summarizeToolGroup(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "cat /proc/cpuinfo" on root@192.2.29.9',
                        status: "completed",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling command result for abc",
                        status: "completed",
                    },
                } as any,
            ],
            false
        );

        expect(summary.title).toBe("命令执行完成");
        expect(summary.defaultExpanded).toBe(false);
        expect(summary.canRetry).toBe(false);
    });

    it("keeps failed tool groups expanded and retryable", () => {
        const summary = summarizeToolGroup(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "cat /proc/cpuinfo"',
                        status: "error",
                        errormessage: "failed to start remote job",
                    },
                } as any,
            ],
            false
        );

        expect(summary.title).toBe("命令执行失败");
        expect(summary.description).toBe("远端命令启动失败");
        expect(summary.defaultExpanded).toBe(false);
        expect(summary.canRetry).toBe(true);
    });

    it("keeps processing groups expanded while running", () => {
        const summary = summarizeToolGroup(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "bash" on root@192.2.29.9',
                        status: "completed",
                    },
                } as any,
                {
                    type: "data-toolprogress",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        statuslines: ["polling command result for abc"],
                    },
                } as any,
            ],
            true
        );

        expect(summary.title).toBe("命令执行处理中");
        expect(summary.defaultExpanded).toBe(true);
    });
});
