import { describe, expect, it } from "vitest";
import { getAssistantMessageLayout } from "../aimessage";
import {
    buildTaskChainFlowEntries,
    buildTaskChainSteps,
    buildTaskTurns,
    formatCommandDuration,
    formatExitCodeLabel,
    getPendingApprovalToolUses,
    getRawOutputDisplayState,
    getTaskChainDetailLanguage,
    getTaskChainDisplayGroups,
    getTaskChainDisplayState,
    getThinkingDisplayState,
    getTurnExitCode,
    resolveTurnFallbackOutput,
    shouldAnimateTaskStep,
    shouldFollowLatestOutput,
    shouldRenderStreamingPlainText,
    shouldRenderTaskChainBlockedReason,
    shouldShowTurnTaskChain,
    splitReasoningFromText,
} from "../aipanelmessages";
import { getToolDisplayName, shouldHideProgressStatusLines, summarizeToolGroup } from "../aitooluse";
import { coalesceMessageParts } from "../aitypes";

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
                        toolname: "term_command_output",
                        tooldesc: "latest command output",
                        status: "pending",
                        durationms: 1532,
                        outputtext: "Model name: Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz\nCPU(s): 128",
                    },
                } as any,
                {
                    type: "data-toolprogress",
                    data: {
                        toolcallid: "tool-2",
                        toolname: "term_command_output",
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
        expect(steps[1].title).toBe("读取终端输出");
        expect(getTaskChainDetailLanguage(steps[1])).toBeUndefined();
        expect(steps[1].status).toBe("running");
        expect(steps[1].detail).toBe("Model name: Intel(R) Xeon(R) Platinum 8369C CPU @ 2.90GHz\nCPU(s): 128");
        expect(steps[1].durationLabel).toBe("耗时 1.5s");
        expect(steps[1].exitCode).toBeUndefined();
        expect(steps[2].status).toBe("failed");
        expect(steps[2].exitCode).toBeUndefined();
    });

    it("formats command duration with human readable units", () => {
        expect(formatCommandDuration(950)).toBe("950ms");
        expect(formatCommandDuration(1_450)).toBe("1.5s");
        expect(formatCommandDuration(61_000)).toBe("1m 1s");
    });

    it("formats exit codes for metadata display", () => {
        expect(formatExitCodeLabel(0)).toBe("Exit 0");
        expect(formatExitCodeLabel(2)).toBe("Exit 2");
        expect(formatExitCodeLabel(undefined)).toBeUndefined();
    });

    it("stops pulse animation for terminal states", () => {
        expect(shouldAnimateTaskStep(true, "failed", undefined, "failed_retryable")).toBe(false);
        expect(shouldAnimateTaskStep(true, "completed", undefined, "completed")).toBe(false);
        expect(shouldAnimateTaskStep(true, "running", undefined, "executing")).toBe(true);
    });

    it("follows latest output while streaming or executing", () => {
        expect(shouldFollowLatestOutput("streaming", "idle", undefined)).toBe(true);
        expect(shouldFollowLatestOutput("ready", "executing", undefined)).toBe(true);
        expect(shouldFollowLatestOutput("ready", "idle", "job-1")).toBe(true);
        expect(shouldFollowLatestOutput("ready", "idle", undefined)).toBe(false);
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
                        toolname: "term_command_output",
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
            activeTool: "term_command_output",
            activeJobId: "job-123",
            lastCommand: "lscpu",
        });

        expect(summary.statusLabel).toBe("Waiting Approval");
        expect(summary.blockedReason).toBe("Waiting for tool approval");
        expect(summary.activeStepId).toBe("tool-2");
        expect(summary.toneClassName).toContain("amber");
    });

    it("does not mark task chain as failed for model/business command failures", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "term_command_output",
                        tooldesc: "CN mismatch",
                        status: "error",
                        errormessage: "CN mismatch",
                    },
                } as any,
            ],
            false
        );

        const summary = getTaskChainDisplayState(steps, null);
        expect(summary.statusLabel).toBeUndefined();
        expect(summary.toneClassName).not.toContain("red");
    });

    it("keeps failed label for system-level failures", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "term_command_output",
                        tooldesc: "job not found: abc",
                        status: "error",
                        errormessage: "job not found: abc",
                    },
                } as any,
            ],
            false
        );

        const summary = getTaskChainDisplayState(steps, null);
        expect(summary.statusLabel).toBe("失败");
        expect(summary.toneClassName).toContain("red");
    });

    it("keeps task chains visible for historical turns that used tools", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "生成证书" }],
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
                                tooldesc: 'running "python3 /root/ssl/check_cert.py"',
                                status: "completed",
                            },
                        },
                    ],
                } as any,
                {
                    id: "user-2",
                    role: "user",
                    parts: [{ type: "text", text: "你自己测试一下好吗" }],
                } as any,
            ],
            "ready"
        );

        expect(shouldShowTurnTaskChain(turns[0])).toBe(true);
        expect(shouldShowTurnTaskChain(turns[1])).toBe(false);
    });

    it("hides task chain when the turn only used internal todo or skill tools", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "排查一下" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-1",
                                toolname: "waveai_todo_write",
                                tooldesc: "writing todo list",
                                status: "completed",
                            },
                        } as any,
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-2",
                                toolname: "waveai_use_skill",
                                tooldesc: 'activating skill "troubleshoot-network"',
                                status: "completed",
                            },
                        } as any,
                        {
                            type: "text",
                            text: "已完成。",
                        } as any,
                    ],
                } as any,
            ],
            "ready"
        );

        expect(shouldShowTurnTaskChain(turns[0])).toBe(false);
    });

    it("does not expose internal todo JSON as fallback output", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "挂载磁盘" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-1",
                                toolname: "waveai_todo_write",
                                tooldesc: "writing todo list",
                                status: "completed",
                                outputtext: '{"reminder":"","state":{"source":"model-generated","status":"completed"}}',
                            },
                        },
                    ],
                } as any,
            ],
            "ready"
        );

        expect(resolveTurnFallbackOutput(turns[0], true, "")).toBe("");
    });

    it("finds pending approval tool uses even while the turn is still streaming", () => {
        const pendingApprovals = getPendingApprovalToolUses(
            [
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
            ],
            true
        );

        expect(pendingApprovals).toHaveLength(1);
        expect(pendingApprovals[0].data.toolcallid).toBe("tool-1");
    });

    it("does not keep finished needs-approval tool uses clickable after streaming ends", () => {
        const pendingApprovals = getPendingApprovalToolUses(
            [
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-1",
                                toolname: "delete_text_file",
                                tooldesc: 'deleting "/tmp/a.txt"',
                                status: "error",
                                approval: "needs-approval",
                            },
                        },
                    ],
                } as any,
            ],
            false
        );

        expect(pendingApprovals).toHaveLength(0);
    });

    it("keeps historical pending approvals out of the latest active turn", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "删除文件" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-old",
                                toolname: "delete_text_file",
                                tooldesc: 'deleting "/tmp/old.txt"',
                                status: "error",
                                approval: "needs-approval",
                            },
                        },
                    ],
                } as any,
                {
                    id: "user-2",
                    role: "user",
                    parts: [{ type: "text", text: "继续检查容器" }],
                } as any,
                {
                    id: "assistant-2",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-new",
                                toolname: "wave_run_command",
                                tooldesc: 'running "docker ps"',
                                status: "completed",
                            },
                        },
                    ],
                } as any,
            ],
            "ready"
        );

        expect(turns).toHaveLength(2);
        expect(getPendingApprovalToolUses(turns[0].assistantMessages, turns[0].isStreaming)).toHaveLength(0);
        expect(getPendingApprovalToolUses(turns[1].assistantMessages, turns[1].isStreaming)).toHaveLength(0);
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

    it("shows inline wave_run_command output as the command result", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-inline",
                        toolname: "wave_run_command",
                        tooldesc: 'running "ls -ld /app/polyglot"',
                        status: "completed",
                        durationms: 200,
                        exitcode: 2,
                        outputtext: "ls: cannot access '/app/polyglot': No such file or directory",
                    },
                } as any,
            ],
            false
        );

        const groups = getTaskChainDisplayGroups(steps);

        expect(steps).toHaveLength(2);
        expect(groups).toHaveLength(1);
        expect(groups[0].primary.detail).toBe("ls -ld /app/polyglot");
        expect(groups[0].primary.exitCode).toBe(2);
        expect(groups[0].primary.durationLabel).toBe("耗时 200ms");
        expect(groups[0].secondary?.title).toBe("命令输出");
        expect(groups[0].secondary?.detail).toBe("ls: cannot access '/app/polyglot': No such file or directory");
    });

    it("shows outputless wave_run_command exit codes on the command step", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-mkdir",
                        toolname: "wave_run_command",
                        tooldesc: 'running "mkdir -p /app/polyglot"',
                        status: "completed",
                        durationms: 4,
                        exitcode: 0,
                    },
                } as any,
            ],
            false
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].exitCode).toBe(0);
        expect(steps[0].durationLabel).toBe("耗时 4ms");
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
                        toolname: "term_command_output",
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
                        toolname: "term_command_output",
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
                        toolname: "term_command_output",
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
                        toolname: "term_command_output",
                        tooldesc: "polling command result for 123",
                        status: "completed",
                        outputtext: "Architecture: x86_64",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-4",
                        toolname: "term_command_output",
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
        expect(groups[0].secondary?.title).toBe("读取终端输出");
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
                        toolname: "term_command_output",
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
            'PRETTY_NAME="Ubuntu 22.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION="22.04 (Jammy Jellyfish)"\nVERSION_CODENAME=jammy\nID=ubuntu'
        );
    });

    it("drops polling placeholders from completed command result details", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "term_command_output",
                        tooldesc: "polling command result for 88c620_python_???",
                        status: "completed",
                    },
                } as any,
            ],
            false
        );

        expect(steps[0].detail).toBeUndefined();
    });

    it("hides polling placeholders from blocked reasons even with non-hex job ids", () => {
        expect(shouldRenderTaskChainBlockedReason("polling command result for 88c620_python_???")).toBe(false);
        expect(shouldRenderTaskChainBlockedReason("Error: CN does not match")).toBe(true);
    });

    it("uses the latest finished tool exit code for a turn", () => {
        const exitCode = getTurnExitCode([
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "wave_run_command",
                            tooldesc: 'running "python3 /root/ssl/check_cert.py"',
                            status: "completed",
                            durationms: 100,
                        },
                    },
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-2",
                            toolname: "wave_run_command",
                            tooldesc: 'running "python3 /root/ssl/check_cert.py"',
                            status: "error",
                            errormessage: "Error: CN does not match",
                            durationms: 120,
                            exitcode: 1,
                        },
                    },
                ],
            } as any,
        ]);

        expect(exitCode).toBe(1);
    });

    it("does not use runtime fallback output for user-only latest turn", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "第二次提问" }],
                } as any,
            ],
            "ready"
        );

        const fallbackOutput = resolveTurnFallbackOutput(turns[0], true, "old stdout");
        expect(fallbackOutput).toBe("");
    });

    it("uses runtime fallback output only when latest turn already has assistant messages", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "第二次提问" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [{ type: "text", text: "" }],
                } as any,
            ],
            "ready"
        );

        const fallbackOutput = resolveTurnFallbackOutput(turns[0], true, "old stdout");
        expect(fallbackOutput).toBe("old stdout");
    });

    it("does not use runtime fallback output when the turn already shows a task chain", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "检查镜像" }],
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
                                tooldesc: 'running "docker images"',
                                status: "completed",
                                outputtext: "repo tag imageid",
                            },
                        },
                    ],
                } as any,
            ],
            "ready"
        );

        const fallbackOutput = resolveTurnFallbackOutput(turns[0], true, "repo tag imageid");
        expect(fallbackOutput).toBe("");
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

    it("replaces repeated snapshots for the same tool call instead of appending rows", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "docker pull example/app:latest"',
                        status: "running",
                        outputtext: "layer 1: pulling",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "docker pull example/app:latest"',
                        status: "running",
                        outputtext: "layer 1: pulling\nlayer 2: extracting",
                    },
                } as any,
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "docker pull example/app:latest"',
                        status: "completed",
                        exitcode: 0,
                        outputtext: "Digest: sha256:abc",
                    },
                } as any,
            ],
            false
        );

        expect(steps).toHaveLength(2);
        expect(steps[0].status).toBe("completed");
        expect(steps[1].detail).toBe("Digest: sha256:abc");
    });

    it("does not create a separate output row for synthetic process-exit text", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "docker ps | grep -i pull"',
                        status: "error",
                        errormessage: "Process exited with status 1",
                        exitcode: 1,
                    },
                } as any,
            ],
            false
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].exitCode).toBe(1);
    });

    it("treats partial=true as running status in deriveToolUseStatus", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "docker pull"',
                        status: "pending",
                        partial: true,
                    },
                } as any,
            ],
            false
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].status).toBe("running");
    });

    it("treats partial=false as completed status in deriveToolUseStatus", () => {
        const steps = buildTaskChainSteps(
            [
                {
                    type: "data-tooluse",
                    data: {
                        toolcallid: "tool-1",
                        toolname: "wave_run_command",
                        tooldesc: 'running "docker pull"',
                        status: "pending",
                        partial: false,
                    },
                } as any,
            ],
            true
        );

        expect(steps).toHaveLength(1);
        expect(steps[0].status).toBe("completed");
    });

    it("collapses raw output after five lines", () => {
        const state = getRawOutputDisplayState("one\ntwo\nthree\nfour\nfive\nsix");

        expect(state.lineCount).toBe(6);
        expect(state.shouldCollapse).toBe(true);
        expect(state.collapsedText).toBe("one\ntwo\nthree\nfour\nfive");
        expect(state.expandedText).toBe("one\ntwo\nthree\nfour\nfive\nsix");
    });

    it("hides command result progress lines from tool progress cards", () => {
        expect(shouldHideProgressStatusLines("wave_run_command")).toBe(false);
        expect(shouldHideProgressStatusLines("term_command_output")).toBe(true);
    });

    it("renders streaming assistant text as plain text while keeping final text markdown", () => {
        expect(shouldRenderStreamingPlainText(true, "正在输出 **bold**")).toBe(true);
        expect(shouldRenderStreamingPlainText(false, "最终结果")).toBe(false);
        expect(shouldRenderStreamingPlainText(true, "")).toBe(false);
    });

    it("interleaves assistant descriptions with command steps in source order", () => {
        const turns = buildTaskTurns(
            [
                {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "检查磁盘" }],
                } as any,
                {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [
                        { type: "text", text: "先看一眼磁盘使用情况。" },
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-1",
                                toolname: "wave_run_command",
                                tooldesc: 'running "df -h /"',
                                status: "completed",
                            },
                        },
                        { type: "text", text: "接着确认卷组可用空间。" },
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-2",
                                toolname: "wave_run_command",
                                tooldesc: 'running "vgs"',
                                status: "completed",
                            },
                        },
                        { type: "text", text: "可以看到根分区已经接近满了。" },
                    ],
                } as any,
            ],
            "ready"
        );

        const turn = turns[0];
        const toolParts = turn.assistantMessages.flatMap((message) =>
            (message.parts ?? []).filter((part) => part.type === "data-tooluse" || part.type === "data-toolprogress")
        ) as any;
        const displayGroups = getTaskChainDisplayGroups(buildTaskChainSteps(toolParts, false));
        const entries = buildTaskChainFlowEntries(turn, displayGroups);

        expect(entries.map((entry) => (entry.type === "narrative" ? entry.text : entry.group.primary.id))).toEqual([
            "tool-1",
            "tool-2",
        ]);
        expect(entries[0]).toMatchObject({
            type: "step",
            narrativeBefore: "先看一眼磁盘使用情况。",
            narrativeAfter: "接着确认卷组可用空间。",
        });
        expect(entries[1]).toMatchObject({
            type: "step",
            narrativeAfter: "可以看到根分区已经接近满了。",
        });
    });

    it("extracts <think> blocks into a separate reasoning section", () => {
        const content = splitReasoningFromText(
            "<think>先看目录\n再运行命令</think>\n\n最终结果：目录不存在，已重新创建。"
        );

        expect(content.thinkingText).toBe("先看目录\n再运行命令");
        expect(content.answerText).toBe("最终结果：目录不存在，已重新创建。");
    });

    it("extracts dangling <think> content while streaming", () => {
        const content = splitReasoningFromText("<think>正在分析问题\n准备执行下一步");

        expect(content.thinkingText).toBe("正在分析问题\n准备执行下一步");
        expect(content.answerText).toBe("");
    });

    it("collapses thinking output after four lines by default", () => {
        const state = getThinkingDisplayState("1\n2\n3\n4\n5");

        expect(state.lineCount).toBe(5);
        expect(state.shouldCollapse).toBe(true);
        expect(state.collapsedText).toBe("1\n2\n3\n4");
        expect(state.expandedText).toBe("1\n2\n3\n4\n5");
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
                        toolname: "term_command_output",
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
                        toolname: "wave_run_command",
                        tooldesc: 'running "sleep 5"',
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
                        toolname: "wave_run_command",
                        tooldesc: 'running "sleep 5"',
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
                        toolname: "term_command_output",
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

describe("coalesceMessageParts", () => {
    it("replaces duplicate data-tooluse parts by toolcallid", () => {
        const parts = [
            { type: "text", text: "hello" } as any,
            { type: "data-tooluse", data: { toolcallid: "tool-1", toolname: "wave_run_command", status: "pending", partial: true } } as any,
            { type: "data-tooluse", data: { toolcallid: "tool-1", toolname: "wave_run_command", status: "running", partial: true } } as any,
            { type: "data-tooluse", data: { toolcallid: "tool-1", toolname: "wave_run_command", status: "completed", partial: false } } as any,
        ];

        const result = coalesceMessageParts(parts);
        expect(result).toHaveLength(2);
        expect(result[0].type).toBe("text");
        expect(result[1].type).toBe("data-tooluse");
        expect((result[1] as any).data.status).toBe("completed");
        expect((result[1] as any).data.partial).toBe(false);
    });

    it("keeps different toolcallids as separate parts", () => {
        const parts = [
            { type: "data-tooluse", data: { toolcallid: "tool-1", toolname: "wave_run_command", status: "completed", partial: false } } as any,
            { type: "data-tooluse", data: { toolcallid: "tool-2", toolname: "read_file", status: "completed", partial: false } } as any,
        ];

        const result = coalesceMessageParts(parts);
        expect(result).toHaveLength(2);
        expect((result[0] as any).data.toolcallid).toBe("tool-1");
        expect((result[1] as any).data.toolcallid).toBe("tool-2");
    });

    it("preserves non-tool-detail parts in order", () => {
        const parts = [
            { type: "text", text: "first" } as any,
            { type: "data-tooluse", data: { toolcallid: "tool-1", toolname: "wave_run_command", status: "running", partial: true } } as any,
            { type: "text", text: "second" } as any,
            { type: "data-tooluse", data: { toolcallid: "tool-1", toolname: "wave_run_command", status: "completed", partial: false } } as any,
        ];

        const result = coalesceMessageParts(parts);
        expect(result).toHaveLength(3);
        expect(result[0].type).toBe("text");
        expect((result[0] as any).text).toBe("first");
        expect(result[1].type).toBe("data-tooluse");
        expect((result[1] as any).data.status).toBe("completed");
        expect(result[2].type).toBe("text");
        expect((result[2] as any).text).toBe("second");
    });
});
