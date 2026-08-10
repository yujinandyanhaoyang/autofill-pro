# Autofill-pro FX

Autofill-pro FX is a local-first Chrome extension branch for manual enterprise form replay and future Fxiaoke-specific adapters. It captures values you already entered on a page, stores them as a profile, and replays the selected profile only when you click `Fill page`.

## What it does

- Captures text, number, date, textarea, select, multi-select, checkbox, radio, and contenteditable fields
- Captures structured groups for repeatable rows, multi-value tag fields, and cascader-plus-detail pairs
- Saves profiles in `chrome.storage.local`
- Supports `Generic form` and `Fxiaoke manual fill` profile types
- Forces Fxiaoke profiles to manual fill only; they never auto-fill on page load
- Uses Chrome's native input channel for Fxiaoke clicks and text entry, with DOM events as a fallback
- Exports Fxiaoke diagnostics for real-page adapter analysis
- Lets you edit saved values before refilling
- Supports export and import of all profiles

## Load locally

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this repository folder

## How to use

1. Open your target business form page and fill it manually once
2. Open the extension popup
3. Enter a profile name
4. Choose `Generic form` or `Fxiaoke manual fill`
5. Click `Capture current page`
6. On the next visit, select that profile and click `Fill page`
7. Edit the 3-4 differing fields in the popup, then click `Save edits`

Each capture now also exports a DOM snapshot JSON with a `capture-` prefix. Manual diagnostic exports keep the `inspect-` prefix so plugin-filled pages and hand-filled pages can be compared directly.

If you captured presets before the structured template upgrade, recapture them. Old presets remain readable as `Generic form` profiles but do not include the new group model.

## Fxiaoke workflow

Fxiaoke edit pages are not identified by URL in this branch. Create or select a `Fxiaoke manual fill` profile, then click `Fill page` when the form is ready. The adapter records lookup fields only when Fxiaoke shows a real selected record; it does not save a failed search string as a profile value.

Replay is staged. It confirms the customer lookup first, waits for Fxiaoke to finish rebuilding the dynamic form, then fills normal fields and dependent lookups such as the price book. If the customer cannot be confirmed, replay stops before changing the remaining fields and reports the reason in the popup. This is intentional: continuing would cause Fxiaoke to disable or reset dependent values.

The extension requests Chrome's `debugger` permission so that a manual Fill can send native browser mouse and keyboard input to Fxiaoke widgets. It is used only while a user-triggered `Fill page` operation is running on the active tab; it is never used for automatic filling or background collection.

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
- Fxiaoke selection, lookup, tiled choice, date, and text components use dedicated manual-fill rules; new widget variants may still need a captured open-state DOM sample
- Complex groups are filled but only basic fields are editable in the popup
- Password and file fields are intentionally excluded

## Why this design

The fastest path is not generic AI autofill. It is deterministic capture and replay for the exact forms you repeatedly use. That solves the highest-value workflow first and keeps all data local.
