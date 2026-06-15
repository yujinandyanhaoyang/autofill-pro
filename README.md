# Autofill-pro

Autofill-pro is a local-first Chrome extension for repetitive web forms. It captures the values already present on a page, stores them as reusable profiles, and refills matching pages later.

## What it does

- Captures text, number, date, textarea, select, multi-select, checkbox, radio, tags, and contenteditable fields
- Stores multiple profiles in `chrome.storage.local`
- Matches profiles by site, exact page, path prefix, or a custom URL rule
- Can auto-fill the most recently updated matching profile after the page finishes loading
- Lets you edit field values before refilling
- Supports export and import of all saved profiles

## Load locally

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this repository folder

## How to use

1. Open a form page and fill it once
2. Open the extension popup
3. Enter a profile name
4. Choose where the profile should apply:
   - `This site`
   - `This exact page`
   - `This path prefix`
   - `Custom rule`
5. Click `Capture current values`
6. Later, open a matching page, select the profile, and click `Fill page`
7. If a few fields differ, edit them in the popup and click `Save edits`

## Current limits

- Matching is deterministic, not AI-based
- Rich custom component libraries may still need page-specific handling
- Password and file fields are intentionally excluded

## Why this design

The shortest path to useful autofill is deterministic capture and replay with local profiles. That covers the high-frequency workflow without adding accounts, sync services, or remote data storage.
