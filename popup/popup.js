const STORAGE_KEY = "profiles";
const LEGACY_STORAGE_KEY = "presets";

const elements = {
  pageMeta: document.getElementById("pageMeta"),
  profileName: document.getElementById("profileName"),
  matchMode: document.getElementById("matchMode"),
  matchValue: document.getElementById("matchValue"),
  autoFillOnLoad: document.getElementById("autoFillOnLoad"),
  profileSelect: document.getElementById("profileSelect"),
  fieldEditor: document.getElementById("fieldEditor"),
  status: document.getElementById("status"),
  captureBtn: document.getElementById("captureBtn"),
  fillBtn: document.getElementById("fillBtn"),
  duplicateBtn: document.getElementById("duplicateBtn"),
  saveBtn: document.getElementById("saveBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  manageBtn: document.getElementById("manageBtn")
};

let currentTabId = null;
let pageMeta = null;
let profiles = [];

init().catch((error) => setStatus(error.message, true));

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  pageMeta = await sendToPage({ type: "pageMeta" });
  elements.pageMeta.textContent = `${pageMeta.title || "Untitled page"} | ${pageMeta.origin}${pageMeta.path}`;

  wireEvents();
  syncMatchInputs();
  await migrateLegacyPresets();
  await loadProfiles();
}

function wireEvents() {
  elements.captureBtn.addEventListener("click", captureProfile);
  elements.fillBtn.addEventListener("click", fillSelectedProfile);
  elements.duplicateBtn.addEventListener("click", duplicateSelectedProfile);
  elements.saveBtn.addEventListener("click", saveEditedProfile);
  elements.deleteBtn.addEventListener("click", deleteSelectedProfile);
  elements.manageBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.profileSelect.addEventListener("change", renderSelectedProfile);
  elements.matchMode.addEventListener("change", syncMatchInputs);
}

async function migrateLegacyPresets() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  if ((stored[STORAGE_KEY] || []).length || !(stored[LEGACY_STORAGE_KEY] || []).length) {
    return;
  }

  const migrated = stored[LEGACY_STORAGE_KEY].map((preset) => ({
    id: preset.id || crypto.randomUUID(),
    name: preset.name || "Imported profile",
    matchMode: "page",
    matchValue: preset.fingerprint || preset.url || "",
    autoFillOnLoad: true,
    url: preset.url || "",
    title: preset.title || "",
    createdAt: preset.createdAt || new Date().toISOString(),
    updatedAt: preset.updatedAt || new Date().toISOString(),
    fields: Array.isArray(preset.fields) ? preset.fields : []
  }));

  await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
}

async function loadProfiles() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allProfiles = stored[STORAGE_KEY] || [];
  profiles = allProfiles.filter((profile) => matchesCurrentPage(profile));
  profiles.sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0);
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0);
    return rightTime - leftTime;
  });
  renderProfileSelect();
  renderSelectedProfile();
}

function renderProfileSelect() {
  elements.profileSelect.innerHTML = "";

  if (!profiles.length) {
    const option = document.createElement("option");
    option.textContent = "No matching profiles yet";
    option.value = "";
    elements.profileSelect.append(option);
    return;
  }

  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.fields.length})`;
    elements.profileSelect.append(option);
  }
}

function renderSelectedProfile() {
  const profile = getSelectedProfile();
  elements.fieldEditor.innerHTML = "";

  if (!profile) {
    elements.profileName.value = "";
    elements.matchMode.value = "site";
    elements.autoFillOnLoad.checked = true;
    syncMatchInputs();
    return;
  }

  elements.profileName.value = profile.name || "";
  elements.matchMode.value = profile.matchMode || "site";
  elements.autoFillOnLoad.checked = profile.autoFillOnLoad !== false;
  syncMatchInputs(profile.matchValue || "");

  for (const [index, field] of profile.fields.entries()) {
    const wrapper = document.createElement("label");
    wrapper.className = field.type === "checkbox" ? "field checkbox" : "field";

    const title = document.createElement("small");
    title.textContent = field.label || field.name || `${field.tag} ${index + 1}`;
    wrapper.append(title);

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

  if (field.type === "select-multiple" || field.type === "tags") {
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

function syncMatchInputs(explicitValue) {
  const mode = elements.matchMode.value;
  let value = explicitValue;

  if (value == null) {
    value = defaultMatchValue(mode);
  }

  elements.matchValue.readOnly = mode !== "custom";
  elements.matchValue.value = value;
}

function defaultMatchValue(mode) {
  if (!pageMeta) {
    return "";
  }

  if (mode === "page") {
    return `${pageMeta.origin}${pageMeta.path}`;
  }

  if (mode === "path-prefix") {
    return `${pageMeta.origin}${getPathPrefix(pageMeta.path)}`;
  }

  if (mode === "custom") {
    return `${pageMeta.origin}${pageMeta.path}`;
  }

  return pageMeta.origin;
}

async function captureProfile() {
  const data = await sendToPage({ type: "capturePage" });
  if (!data.fields.length) {
    setStatus("No supported fields found on this page.", true);
    return;
  }

  const name = elements.profileName.value.trim() || `${data.title || "Profile"} ${new Date().toLocaleString()}`;
  const profile = {
    id: crypto.randomUUID(),
    name,
    matchMode: elements.matchMode.value,
    matchValue: getNormalizedMatchValue(),
    autoFillOnLoad: elements.autoFillOnLoad.checked,
    url: data.url,
    title: data.title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields: data.fields
  };

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allProfiles = stored[STORAGE_KEY] || [];
  allProfiles.push(profile);
  await chrome.storage.local.set({ [STORAGE_KEY]: allProfiles });

  await loadProfiles();
  elements.profileSelect.value = profile.id;
  renderSelectedProfile();
  setStatus(`Captured ${profile.fields.length} fields into "${profile.name}".`);
}

async function fillSelectedProfile() {
  const profile = getSelectedProfile();
  if (!profile) {
    setStatus("Select a profile first.", true);
    return;
  }

  const result = await sendToPage({ type: "fillPage", preset: { fields: profile.fields } });
  if (result?.ok === false) {
    setStatus(result.error || "Failed to fill the page.", true);
    return;
  }

  setStatus(`Filled page with "${profile.name}".`);
}

async function duplicateSelectedProfile() {
  const profile = getSelectedProfile();
  if (!profile) {
    setStatus("Select a profile first.", true);
    return;
  }

  const copy = {
    ...structuredClone(profile),
    id: crypto.randomUUID(),
    name: `${profile.name} copy`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allProfiles = stored[STORAGE_KEY] || [];
  allProfiles.push(copy);
  await chrome.storage.local.set({ [STORAGE_KEY]: allProfiles });

  await loadProfiles();
  elements.profileSelect.value = copy.id;
  renderSelectedProfile();
  setStatus(`Duplicated "${profile.name}".`);
}

async function saveEditedProfile() {
  const profile = getSelectedProfile();
  if (!profile) {
    setStatus("Select a profile first.", true);
    return;
  }

  const next = structuredClone(profile);
  next.name = elements.profileName.value.trim() || next.name;
  next.matchMode = elements.matchMode.value;
  next.matchValue = getNormalizedMatchValue();
  next.autoFillOnLoad = elements.autoFillOnLoad.checked;
  next.updatedAt = new Date().toISOString();

  for (const editor of elements.fieldEditor.querySelectorAll("[data-index]")) {
    const index = Number(editor.dataset.index);
    const kind = editor.dataset.kind;
    if (kind === "boolean") {
      next.fields[index].value = editor.checked;
    } else if (kind === "list") {
      next.fields[index].value = editor.value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    } else {
      next.fields[index].value = editor.value;
    }
  }

  await replaceProfile(next);
  await loadProfiles();
  elements.profileSelect.value = next.id;
  renderSelectedProfile();
  setStatus(`Saved "${next.name}".`);
}

async function deleteSelectedProfile() {
  const profile = getSelectedProfile();
  if (!profile) {
    setStatus("Select a profile first.", true);
    return;
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allProfiles = (stored[STORAGE_KEY] || []).filter((item) => item.id !== profile.id);
  await chrome.storage.local.set({ [STORAGE_KEY]: allProfiles });
  await loadProfiles();
  setStatus(`Deleted "${profile.name}".`);
}

async function replaceProfile(next) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allProfiles = (stored[STORAGE_KEY] || []).map((item) => (item.id === next.id ? next : item));
  await chrome.storage.local.set({ [STORAGE_KEY]: allProfiles });
}

function getSelectedProfile() {
  return profiles.find((profile) => profile.id === elements.profileSelect.value) || null;
}

function matchesCurrentPage(profile) {
  const pageRule = `${pageMeta.origin}${pageMeta.path}`;
  const rule = String(profile.matchValue || "");

  if (profile.matchMode === "page") {
    return rule === pageRule;
  }

  if (profile.matchMode === "path-prefix") {
    return pageRule.startsWith(rule);
  }

  if (profile.matchMode === "custom") {
    return pageRule.startsWith(rule) || pageMeta.url.startsWith(rule);
  }

  return rule === pageMeta.origin;
}

function getNormalizedMatchValue() {
  const mode = elements.matchMode.value;
  const manual = elements.matchValue.value.trim();
  return manual || defaultMatchValue(mode);
}

function getPathPrefix(path) {
  if (!path || path === "/") {
    return "/";
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return path;
  }

  return `/${segments.slice(0, segments.length - 1).join("/")}`;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#9f2d23" : "";
}

async function sendToPage(message) {
  return chrome.tabs.sendMessage(currentTabId, message);
}
