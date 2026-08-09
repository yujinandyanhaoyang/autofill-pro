const STORAGE_KEY = "presets";
const ACTIVE_PRESET_KEY = "activePresetId";

const elements = {
  pageMeta: document.getElementById("pageMeta"),
  presetName: document.getElementById("presetName"),
  adapterType: document.getElementById("adapterType"),
  presetSelect: document.getElementById("presetSelect"),
  adapterSummary: document.getElementById("adapterSummary"),
  fieldEditor: document.getElementById("fieldEditor"),
  groupSummary: document.getElementById("groupSummary"),
  status: document.getElementById("status"),
  captureBtn: document.getElementById("captureBtn"),
  fillBtn: document.getElementById("fillBtn"),
  saveBtn: document.getElementById("saveBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  manageBtn: document.getElementById("manageBtn"),
  inspectBtn: document.getElementById("inspectBtn")
};

let currentTabId = null;
let currentFingerprint = "";
let presets = [];

init().catch((error) => setStatus(error.message, true));

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  const meta = await sendToPage({ type: "pageMeta" });
  currentFingerprint = meta.fingerprint;
  elements.pageMeta.textContent = `${meta.title || "Untitled page"} | ${meta.fingerprint}`;

  wireEvents();
  await loadPresets();
}

function wireEvents() {
  elements.captureBtn.addEventListener("click", capturePreset);
  elements.fillBtn.addEventListener("click", fillSelectedPreset);
  elements.saveBtn.addEventListener("click", saveEditedPreset);
  elements.deleteBtn.addEventListener("click", deleteSelectedPreset);
  elements.manageBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.inspectBtn.addEventListener("click", exportInspectionSnapshot);
  elements.presetSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({ [ACTIVE_PRESET_KEY]: elements.presetSelect.value });
    renderSelectedPreset();
  });
}

async function loadPresets() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  presets = (stored[STORAGE_KEY] || []).filter((preset) => {
    const adapterType = getAdapterType(preset);
    return adapterType === "fxiaoke" || preset.fingerprint === currentFingerprint;
  }).sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
  const active = await chrome.storage.local.get(ACTIVE_PRESET_KEY);
  renderPresetSelect(active[ACTIVE_PRESET_KEY]);
  renderSelectedPreset();
}

function renderPresetSelect(activePresetId) {
  elements.presetSelect.innerHTML = "";

  if (!presets.length) {
    const option = document.createElement("option");
    option.textContent = "No profiles available yet";
    option.value = "";
    elements.presetSelect.append(option);
    return;
  }

  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    const editableCount = getEditableFields(preset).length;
    const groupCount = Array.isArray(preset.groups) ? preset.groups.length : 0;
    option.textContent = `${preset.name} [${getAdapterLabel(preset)}] (${editableCount} fields, ${groupCount} groups)`;
    elements.presetSelect.append(option);
  }

  const preferred = presets.some((preset) => preset.id === activePresetId)
    ? activePresetId
    : presets[0].id;
  elements.presetSelect.value = preferred;
}

function renderSelectedPreset() {
  const preset = getSelectedPreset();
  elements.fieldEditor.innerHTML = "";
  elements.groupSummary.textContent = "";
  elements.adapterSummary.textContent = "";

  if (!preset) {
    elements.adapterType.value = "generic";
    return;
  }

  elements.presetName.value = preset.name;
  elements.adapterType.value = getAdapterType(preset);
  elements.adapterSummary.textContent = getAdapterType(preset) === "fxiaoke"
    ? "Fxiaoke profiles never auto-fill. Click Fill page to run the FX adapter manually."
    : "Generic profiles fill the current matching page with the standard adapter.";
  const editableFields = getEditableFields(preset);
  const groups = Array.isArray(preset.groups) ? preset.groups : [];
  if (groups.length) {
    elements.groupSummary.textContent = `${groups.length} structured group${groups.length === 1 ? "" : "s"} captured. Complex groups fill normally but are not editable here.`;
  }

  for (const [index, field] of editableFields.entries()) {
    const wrapper = document.createElement("label");
    wrapper.className = field.type === "checkbox" ? "field checkbox" : "field";

    const title = document.createElement("small");
    title.textContent = field.label || field.name || `${field.tag} ${index + 1}`;
    wrapper.append(title);

    if (field.fxiaokeApiName) {
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = isFieldEnabled(field);
      enabled.dataset.index = String(index);
      enabled.dataset.kind = "enabled";
      enabled.title = "Include this field when filling";
      enabled.setAttribute("aria-label", `Include ${title.textContent} when filling`);
      wrapper.append(enabled);
    }

    const input = buildEditorInput(field, index);
    wrapper.append(input);
    elements.fieldEditor.append(wrapper);
  }
}

function buildEditorInput(field, index) {
  if (field.type === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(field.value);
    input.dataset.index = String(index);
    input.dataset.kind = "boolean";
    return input;
  }

  if (field.type === "select-multiple" || field.type === "tags" || Array.isArray(field.value)) {
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.value = Array.isArray(field.value) ? field.value.join(", ") : "";
    textarea.dataset.index = String(index);
    textarea.dataset.kind = "list";
    return textarea;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.value = field.value == null ? "" : String(field.value);
  input.dataset.index = String(index);
  input.dataset.kind = "text";
  return input;
}

async function capturePreset() {
  const data = await sendToPage({ type: "capturePage" });
  const adapterType = data.adapterType === "fxiaoke" ? "fxiaoke" : elements.adapterType.value;
  const editableFields = getEditableFields(data);
  if (!editableFields.length && !(data.groups || []).length) {
    setStatus("No supported fields found on this page.", true);
    return;
  }

  const name = elements.presetName.value.trim() || `${data.title || "Preset"} ${new Date().toLocaleString()}`;
  const record = {
    id: crypto.randomUUID(),
    version: data.version || 1,
    name,
    adapterType,
    autoFillOnLoad: adapterType === "fxiaoke" ? false : data.autoFillOnLoad !== false,
    fingerprint: data.fingerprint,
    url: data.url,
    title: data.title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    simpleFields: data.simpleFields || data.fields || [],
    groups: data.groups || []
  };

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allPresets = stored[STORAGE_KEY] || [];
  allPresets.push(record);
  await chrome.storage.local.set({
    [STORAGE_KEY]: allPresets,
    [ACTIVE_PRESET_KEY]: record.id
  });

  await loadPresets();
  elements.presetSelect.value = record.id;
  elements.adapterType.value = adapterType;
  renderSelectedPreset();
  await exportSnapshot("capture");
  setStatus(`Captured ${record.simpleFields.length} editable fields and ${record.groups.length} structured groups into "${record.name}".`);
}

async function fillSelectedPreset() {
  const preset = getSelectedPreset();
  if (!preset) {
    setStatus("Select a preset first.", true);
    return;
  }

  const result = await sendToPage({ type: "fillPage", preset });
  if (result?.ok === false) {
    setStatus(result.error || "Fill failed.", true);
    return;
  }
  if (result?.failures?.length) {
    const details = (result.outcomes || [])
      .filter((item) => item.status === "failed")
      .map((item) => `${item.field} (${item.reason})`);
    setStatus(`Filled ${countFilled(result)} fields. Failed: ${details.join(", ")}`, true);
    return;
  }
  const adapterLabel = getAdapterLabel(preset);
  setStatus(`Filled ${countFilled(result)} fields with "${preset.name}" using ${adapterLabel}.`);
}

async function saveEditedPreset() {
  const preset = getSelectedPreset();
  if (!preset) {
    setStatus("Select a preset first.", true);
    return;
  }

  const next = structuredClone(preset);
  next.name = elements.presetName.value.trim() || next.name;
  next.adapterType = elements.adapterType.value;
  next.autoFillOnLoad = next.adapterType === "fxiaoke" ? false : next.autoFillOnLoad !== false;
  next.updatedAt = new Date().toISOString();
  if (!Array.isArray(next.simpleFields)) {
    next.simpleFields = Array.isArray(next.fields) ? structuredClone(next.fields) : [];
  }

  for (const editor of elements.fieldEditor.querySelectorAll("[data-index]")) {
    const index = Number(editor.dataset.index);
    const kind = editor.dataset.kind;
    if (kind === "boolean") {
      next.simpleFields[index].value = editor.checked;
    } else if (kind === "enabled") {
      next.simpleFields[index].enabled = editor.checked;
    } else if (kind === "list") {
      next.simpleFields[index].value = editor.value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    } else {
      next.simpleFields[index].value = editor.value;
    }
  }

  await replacePreset(next);
  await chrome.storage.local.set({ [ACTIVE_PRESET_KEY]: next.id });
  await loadPresets();
  elements.presetSelect.value = next.id;
  renderSelectedPreset();
  setStatus(`Saved changes to "${next.name}".`);
}

async function deleteSelectedPreset() {
  const preset = getSelectedPreset();
  if (!preset) {
    setStatus("Select a preset first.", true);
    return;
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allPresets = (stored[STORAGE_KEY] || []).filter((item) => item.id !== preset.id);
  await chrome.storage.local.set({ [STORAGE_KEY]: allPresets });
  await loadPresets();
  setStatus(`Deleted "${preset.name}".`);
}

async function exportInspectionSnapshot() {
  const filename = await exportSnapshot("inspect");
  setStatus(`Exported DOM snapshot to ${filename}.`);
}

async function replacePreset(next) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allPresets = (stored[STORAGE_KEY] || []).map((item) => (item.id === next.id ? next : item));
  await chrome.storage.local.set({ [STORAGE_KEY]: allPresets });
}

function getSelectedPreset() {
  return presets.find((preset) => preset.id === elements.presetSelect.value) || null;
}

function getEditableFields(preset) {
  if (Array.isArray(preset?.simpleFields)) {
    return preset.simpleFields;
  }
  return Array.isArray(preset?.fields) ? preset.fields : [];
}

function getAdapterType(preset) {
  return preset?.adapterType === "fxiaoke" ? "fxiaoke" : "generic";
}

function getAdapterLabel(preset) {
  return getAdapterType(preset) === "fxiaoke" ? "Fxiaoke" : "Generic";
}

function isFieldEnabled(field) {
  if (field.enabled === false) {
    return false;
  }
  if (field.enabled === true) {
    return true;
  }
  return Array.isArray(field.value) ? field.value.length > 0 : String(field.value || "").trim() !== "";
}

function countFilled(result) {
  return (result?.outcomes || []).filter((item) => item.status === "filled").length;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#9f2d23" : "";
}

async function sendToPage(message) {
  try {
    return await chrome.tabs.sendMessage(currentTabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      files: ["src/content.js"]
    });
    return chrome.tabs.sendMessage(currentTabId, message);
  }
}

function isMissingReceiverError(error) {
  const message = String(error?.message || error || "");
  return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
}

async function exportSnapshot(prefix) {
  const inspection = await sendToPage({ type: "inspectPage" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = slugify(inspection.title || "page");
  const filename = `autofill-pro-${prefix}-${slug}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(inspection, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return filename;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "page";
}
