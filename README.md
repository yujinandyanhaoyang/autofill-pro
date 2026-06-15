# Autofill Pro

Autofill Pro is a local-first Chrome extension MVP for repetitive enterprise web forms. It captures the values you already entered on a page, stores them as a preset, and replays them later so you only edit the few fields that changed.

## What it does

- Captures text, number, date, textarea, select, multi-select, checkbox, radio, and contenteditable fields
- Captures structured groups for repeatable rows, multi-value tag fields, and cascader-plus-detail pairs
- Saves presets per page path in `chrome.storage.local`
- Lets you edit saved values before refilling
- Supports export and import of all presets

## Load locally

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this repository folder

## How to use

1. Open your target business form page and fill it manually once
2. Open the extension popup
3. Enter a preset name and click `Capture current page`
4. On the next visit, select that preset and click `Fill page`
5. Edit the 3-4 differing fields in the popup, then click `Save edits`

Each capture now also exports a DOM snapshot JSON with a `capture-` prefix. Manual diagnostic exports keep the `inspect-` prefix so plugin-filled pages and hand-filled pages can be compared directly.

If you captured presets before the structured template upgrade, recapture them. Old presets remain readable but do not include the new group model.

## Capture a real form page for analysis

Screenshots are useful for layout, but not for selector strategy. To analyze a logged-in page:

1. Load this extension in `chrome://extensions`
2. Sign in to your business system and open the target form
3. Wait until the page finishes rendering the dynamic sections you care about
4. Open the extension popup
5. Click `Export DOM snapshot`
6. A local JSON file will download with:
   - page metadata
   - detected field inventory
   - form and table counts
   - raw page HTML

Use that file to inspect stable labels, names, ids, nested table patterns, and custom component structures. If the page contains sensitive values, review or sanitize the JSON before sharing it.

## Current limits

- Matching is strongest on the same page structure and URL path
- Rich custom component libraries may require page-specific matching improvements
- Complex groups are filled but only basic fields are editable in the popup
- Password and file fields are intentionally excluded

## Why this design

The fastest path is not generic AI autofill. It is deterministic capture and replay for the exact forms you repeatedly use. That solves the highest-value workflow first and keeps all data local.
