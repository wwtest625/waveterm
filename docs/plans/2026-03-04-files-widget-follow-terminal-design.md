# Files Widget Follow Focused Terminal - Design

## Goal
When user opens the Files widget from the left sidebar while focused on a remote terminal block, the new preview block should use that terminal's connection and cwd instead of falling back to local.

## Scope
- Frontend only.
- Change widget click behavior for preview-type widget block definitions.
- No backend protocol changes.

## Behavior
- If focused block is a terminal:
  - If `meta.connection` exists, apply it to the new preview block.
  - If `meta["cmd:cwd"]` exists, use it as preview `meta.file`.
- If focused block is not terminal (or missing), keep current widget block definition behavior.

## Notes
- Keep existing fallback (`~`) when no cwd is available.
- Avoid mutating widget config object.
