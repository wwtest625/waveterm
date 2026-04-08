import { describe, expect, it } from "vitest";
import { getAssistantMessageLayout } from "../aimessage";
import {
    buildTaskChainSteps,
    buildTaskTurns,
    formatCommandDuration,
    getRawOutputDisplayState,
    getPendingApprovalToolUses,
    getTaskChainDetailLanguage,
    getTaskChainDisplayGroups,
    getTaskChainDisplayState,
    shouldRenderStreamingPlainText,
} from "../aipanelmessages";
import { getToolDisplayName, shouldHideProgressStatusLines, summarizeToolGroup } from "../aitooluse";

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
                        tooldesc: 'running "uname -a" on root@192.2.29.9',
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
                        durationms: 1532,
                        outputtext: "Model name: Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz\nCPU(s): 128",
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
        expect(steps[0].detail).toBe("uname -a");
        expect(getTaskChainDetailLanguage(steps[0])).toBe("bash");
        expect(steps[0].status).toBe("completed");
        expect(steps[1].title).toBe("获取执行结果");
        expect(getTaskChainDetailLanguage(steps[1])).toBeUndefined();
        expect(steps[1].status).toBe("running");
        expect(steps[1].detail).toBe("Model name: Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz\nCPU(s): 128");
        expect(steps[1].durationLabel).toBe("耗时 1.5s");
        expect(steps[2].status).toBe("failed");
    });

    it("formats command duration with human readable units", () => {
        expect(formatCommandDuration(950)).toBe("950ms");
        expect(formatCommandDuration(1_450)).toBe("1.5s");
        expect(formatCommandDuration(61_000)).toBe("1m 1s");
    });

    it("summarizes task chain with runtime focus and approval state", () => {
        const steps = buildTaskChainSteps(
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
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        tooldesc: "waiting for approval",
                        status: "pending",
                        approval: "needs-approval",
                    },
                } as any,
            ],
            false
        );
        const summary = getTaskChainDisplayState(steps, {
            state: "awaiting_approval",
            phaseLabel: "Waiting Approval",
            blockedReason: "Waiting for tool approval",
            activeTool: "wave_get_command_result",
            activeJobId: "job-123",
            lastCommand: "lscpu",
        });

        expect(summary.progressLabel).toBe("1/2");
        expect(summary.focusLabel).toBe("lscpu");
        expect(summary.statusLabel).toBe("Waiting Approval");
        expect(summary.blockedReason).toBe("Waiting for tool approval");
        expect(summary.activeStepId).toBe("tool-2");
        expect(summary.toneClassName).toContain("yellow");
    });

    it("finds pending approval tool uses even while the turn is still streaming", () => {
        const pendingApprovals = getPendingApprovalToolUses([
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "wave_run_command",
                            tooldesc: 'running "mkdir -p /home/ssl"',
                            status: "pending",
                            approval: "needs-approval",
                        },
                    },
                ],
            } as any,
        ]);

        expect(pendingApprovals).toHaveLength(1);
        expect(pendingApprovals[0].data.toolcallid).toBe("tool-1");
    });

    it("keeps full bash command details intact", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-long",
                        toolname: "wave_run_command",
                        tooldesc: 'running "bash -lc cat /etc/os-release; echo; echo" on local',
                        status: "completed",
                    },
                } as any,
            ],
            false
        );

        expect(steps[0].detail).toBe("bash -lc cat /etc/os-release; echo; echo");
    });

    it("describes live command snapshots as background refreshing", () => {
        const steps = buildTaskChainSteps(
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
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling result",
                        status: "running",
                        durationms: 3150,
                        outputtext: "Model name: Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz",
                    },
                } as any,
            ],
            false
        );

        const summary = summarizeToolGroup(
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
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling result",
                        status: "running",
                        durationms: 3150,
                        outputtext: "Model name: Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz",
                    },
                } as any,
            ],
            false
        );

        expect(steps[1].status).toBe("running");
        expect(steps[1].durationLabel).toBe("耗时 3.2s");
        expect(summary.title).toBe("命令执行处理中");
        expect(summary.description).toContain("后台继续刷新");
    });

    it("shows background refresh text when a live snapshot has no output yet", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling result",
                        status: "running",
                        durationms: 900,
                    },
                } as any,
            ],
            false
        );

        expect(steps[0].detail).toBe("已返回最新快照，后台继续刷新");
        expect(steps[0].durationLabel).toBe("耗时 900ms");
    });

    it("pairs command outputs directly under their matching command cards", () => {
        const steps = buildTaskChainSteps(
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
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "wave_run_command",
                        tooldesc: 'running "cat /proc/meminfo"',
                        status: "completed",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-3",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling command result for 123",
                        status: "completed",
                        outputtext: "Architecture: x86_64",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-4",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling command result for 456",
                        status: "completed",
                        outputtext: "MemTotal: 395629656 kB",
                    },
                } as any,
            ],
            false
        );

        const groups = getTaskChainDisplayGroups(steps);

        expect(groups).toHaveLength(2);
        expect(groups[0].primary.title).toBe("执行命令");
        expect(groups[0].secondary?.title).toBe("获取执行结果");
        expect(groups[0].secondary?.detail).toBe("Architecture: x86_64");
        expect(groups[1].primary.title).toBe("执行命令");
        expect(groups[1].secondary?.detail).toBe("MemTotal: 395629656 kB");
    });

    it("keeps a compact multi-line preview for command results", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling command result for 456",
                        status: "completed",
                        outputtext:
                            'PRETTY_NAME="Ubuntu 22.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION="22.04 (Jammy Jellyfish)"\nVERSION_CODENAME=jammy\nID=ubuntu',
                    },
                } as any,
            ],
            false
        );

        expect(steps[0].detail).toBe(
            'PRETTY_NAME="Ubuntu 22.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION="22.04 (Jammy Jellyfish)"\nVERSION_CODENAME=jammy\n...'
        );
    });

    it("collapses identical consecutive tool steps into one visual row", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "read_dir",
                        tooldesc: 'reading directory "/opt/spug" (max_entries: 500)',
                        status: "error",
                        errormessage: "permission denied",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "read_dir",
                        tooldesc: 'reading directory "/opt/spug" (max_entries: 500)',
                        status: "error",
                        errormessage: "permission denied",
                    },
                } as any,
            ],
            false
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].duplicateCount).toBe(2);
    });

    it("collapses raw output after five lines", () => {
        const state = getRawOutputDisplayState("one\ntwo\nthree\nfour\nfive\nsix");

        expect(state.lineCount).toBe(6);
        expect(state.shouldCollapse).toBe(true);
        expect(state.collapsedText).toBe("one\ntwo\nthree\nfour\nfive");
        expect(state.expandedText).toBe("one\ntwo\nthree\nfour\nfive\nsix");
    });

    it("hides command result progress lines from tool progress cards", () => {
        expect(shouldHideProgressStatusLines("wave_get_command_result")).toBe(true);
        expect(shouldHideProgressStatusLines("term_command_output")).toBe(true);
        expect(shouldHideProgressStatusLines("read_text_file")).toBe(false);
    });

    it("renders streaming assistant text as plain text while keeping final text markdown", () => {
        expect(shouldRenderStreamingPlainText(true, "正在输出 **bold**")).toBe(true);
        expect(shouldRenderStreamingPlainText(false, "最终结果")).toBe(false);
        expect(shouldRenderStreamingPlainText(true, "")).toBe(false);
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

    it("translates wave command polling timeout and cancel errors", () => {
        const timeoutSummary = summarizeToolGroup(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-timeout",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling result",
                        status: "error",
                        errormessage: "command result polling timed out",
                    },
                } as any,
            ],
            false
        );
        const canceledSummary = summarizeToolGroup(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-canceled",
                        toolname: "wave_get_command_result",
                        tooldesc: "polling result",
                        status: "error",
                        errormessage: "command result polling canceled",
                    },
                } as any,
            ],
            false
        );

        expect(timeoutSummary.description).toBe("后台轮询超时");
        expect(canceledSummary.description).toBe("后台轮询已取消");
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
