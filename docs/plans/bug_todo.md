# Bug Todo

## 2026-03-17 - Files widget width does not respect configured `display:width`

- Symptom:
  - Sidebar `files` widget is configured to `33%`.
  - Width selection from the preview context menu writes `display:width` correctly into the active config file.
  - Reopening the `files` widget from the left sidebar still lands at an apparent `50/50` split.
- Confirmed runtime config:
  - Active local config file is `C:\Users\sys49169\.config\waveterm-dev\widgets.json`.
  - `defwidget@files` already contains `"display:width": 33`.
- What has already been tried:
  - Added widget config schema/types and Sidebar Widgets UI support for `display:width`.
  - Applied preferred width when focusing an already-open widget.
  - Persisted preview-menu width changes back to `widgets.json`.
  - Added fallback target-block selection when reopening a widget after close.
  - Added delayed post-create width reapplication (`0ms` and `50ms`) after widget creation.
- Current hypothesis:
  - The create/open path is reading the desired width, but some later layout step or state refresh is resetting the split back to equal widths.
- Current debugging instrumentation:
  - Renderer logs with prefix `[widget-width-debug]` in:
    - `frontend/app/workspace/widgets.tsx`
    - `frontend/app/view/preview/preview-model.tsx`
- Next step:
  - Reproduce with DevTools console open and capture `[widget-width-debug]` lines to identify which step last forces the width back to `50%`.
