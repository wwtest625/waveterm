import { describe, expect, it } from "vitest";
import { buildInlineDiffPreview } from "../aitooluse";

describe("aitooluse inline diff preview", () => {
    it("shows changed lines with surrounding context", () => {
        const preview = buildInlineDiffPreview(
            ["line 1", "old value", "line 3"].join("\n"),
            ["line 1", "new value", "line 3"].join("\n")
        );

        expect(preview).toContain("  line 1");
        expect(preview).toContain("- old value");
        expect(preview).toContain("+ new value");
        expect(preview).toContain("  line 3");
    });

    it("omits preview when contents are identical", () => {
        expect(buildInlineDiffPreview("same", "same")).toBe("");
    });
});
