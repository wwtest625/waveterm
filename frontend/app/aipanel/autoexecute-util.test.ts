import { describe, expect, it } from "vitest";
import { extractExecutableCommandsFromMarkdown, getFirstExecutableCommandFromMessage } from "./autoexecute-util";

describe("extractExecutableCommandsFromMarkdown", () => {
    it("extracts unlabeled and shell fences", () => {
        const text = [
            "before",
            "```",
            "ls -la",
            "```",
            "middle",
            "```bash",
            "echo hello",
            "```",
        ].join("\n");

        expect(extractExecutableCommandsFromMarkdown(text)).toEqual(["ls -la", "echo hello"]);
    });

    it("ignores non-shell code fences", () => {
        const text = [
            "```ts",
            "console.log('x')",
            "```",
            "```python",
            "print('x')",
            "```",
        ].join("\n");

        expect(extractExecutableCommandsFromMarkdown(text)).toEqual([]);
    });
});

describe("getFirstExecutableCommandFromMessage", () => {
    it("returns first command from assistant text parts", () => {
        const message: any = {
            id: "m1",
            role: "assistant",
            parts: [
                { type: "text", text: "No command here" },
                { type: "text", text: "```sh\nuname -a\n```" },
            ],
        };

        expect(getFirstExecutableCommandFromMessage(message)).toBe("uname -a");
    });

    it("returns null when there is no command fence", () => {
        const message: any = {
            id: "m2",
            role: "assistant",
            parts: [{ type: "text", text: "plain text" }],
        };

        expect(getFirstExecutableCommandFromMessage(message)).toBeNull();
    });
});
