const STORAGE_KEY = "profiles";
const MATCH_MODE_LABELS = {
  site: "Site",
  page: "Page",
  "path-prefix": "Path prefix",
  custom: "Custom"
};

const elements = {
  profileCount: document.getElementById("profileCount"),
  profileList: document.getElementById("profileList"),
  emptyState: document.getElementById("emptyState"),
  editorForm: document.getElementById("editorForm"),
  profileName: document.getElementById("profileName"),
  matchMode: document.getElementById("matchMode"),
  matchValue: document.getElementById("matchValue"),
  autoFillOnLoad: document.getElementById("autoFillOnLoad"),
  meta: document.getElementById("meta"),
  fieldList: document.getElementById("fieldList"),
  newProfileBtn: document.getElementById("newProfileBtn"),
  saveBtn: document.getElementById("saveBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput")
};

let profiles = [];
let selectedProfileId = "";

elements.newProfileBtn.addEventListener("click", createProfile);
elements.exportBtn.addEventListener("click", exportProfiles);
elements.importInput.addEventListener("change", importProfiles);
elements.editorForm.addEventListener("submit", saveProfile);
elements.deleteBtn.addEventListener("click", deleteProfile);

init().catch((error) => {
  elements.profileList.textContent = error.message;
});

async function init() {
  await render();
}

async function render() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  profiles = stored[STORAGE_KEY] || [];
  profiles.sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0);
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0);
    return rightTime - leftTime;
  });

  if (!profiles.some((profile) => profile.id === selectedProfileId)) {
    selectedProfileId = profiles[0]?.id || "";
  }

  renderProfileList();
  renderEditor();
}

function renderProfileList() {
  elements.profileList.innerHTML = "";
  elements.profileCount.textContent = `${profiles.length} saved`;

  for (const profile of profiles) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `profile-item${profile.id === selectedProfileId ? " is-selected" : ""}`;
    item.addEventListener("click", () => {
      selectedProfileId = profile.id;
      renderProfileList();
      renderEditor();
    });

    const title = document.createElement("strong");
    title.textContent = profile.name || "Untitled profile";
    const meta = document.createElement("small");
    meta.textContent = `${profile.fields.length} fields | ${MATCH_MODE_LABELS[profile.matchMode] || "Page"}`;
    item.append(title, meta);
    elements.profileList.append(item);
  }

  if (!profiles.length) {
    elements.profileList.textContent = "No profiles saved yet.";
  }
}

function renderEditor() {
  const profile = getSelectedProfile();
  const hasProfile = Boolean(profile);
  elements.emptyState.hidden = hasProfile;
  elements.editorForm.hidden = !hasProfile;

  if (!profile) {
    return;
  }

  elements.profileName.value = profile.name || "";
  elements.matchMode.value = profile.matchMode || "page";
  elements.matchValue.value = profile.matchValue || "";
  elements.autoFillOnLoad.checked = profile.autoFillOnLoad !== false;
  elements.meta.textContent = buildMeta(profile);
  renderFields(profile.fields || []);
}

function renderFields(fields) {
  elements.fieldList.innerHTML = "";

  if (!fields.length) {
    elements.fieldList.textContent = "No field values saved yet. Use Save Field Values in the popup first.";
    return;
  }

  for (const [index, field] of fields.entries()) {
    const item = document.createElement("div");
    item.className = "field-item";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = field.label || field.name || `${field.tag || "field"} ${index + 1}`;
    const type = document.createElement("small");
    type.textContent = field.type || "text";
    header.append(title, type);

    const control = buildFieldInput(field, index);
    item.append(header, control);
    elements.fieldList.append(item);
  }
}

async function upsertProfile(next) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const current = stored[STORAGE_KEY] || [];
  const existing = current.some((item) => item.id === next.id);
  const updated = existing
    ? current.map((item) => (item.id === next.id ? next : item))
    : [...current, next];
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

function getSelectedProfile() {
  return profiles.find((profile) => profile.id === selectedProfileId) || null;
}

function buildMeta(profile) {
  const updatedAt = profile.updatedAt ? new Date(profile.updatedAt).toLocaleString() : "unknown";
  return `${profile.fields.length} fields | ${MATCH_MODE_LABELS[profile.matchMode] || "Page"} | Updated ${updatedAt}`;
}

function buildFieldInput(field, index) {
  if (field.type === "checkbox") {
    const label = document.createElement("label");
    label.className = "checkbox-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(field.value);
    input.dataset.index = String(index);
    input.dataset.kind = "boolean";
    const text = document.createElement("span");
    text.textContent = "Checked";
    label.append(input, text);
    return label;
  }

  if (field.type === "select-multiple" || field.type === "tags") {
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
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

async function saveProfile(event) {
  event.preventDefault();

  const profile = getSelectedProfile();
  if (!profile) {
    return;
  }

  const next = structuredClone(profile);
  next.name = elements.profileName.value.trim() || profile.name || "Untitled profile";
  next.matchMode = elements.matchMode.value;
  next.matchValue = elements.matchValue.value.trim();
  next.autoFillOnLoad = elements.autoFillOnLoad.checked;
  next.updatedAt = new Date().toISOString();

  for (const editor of elements.fieldList.querySelectorAll("[data-index]")) {
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

  await upsertProfile(next);
  await render();
}

async function deleteProfile() {
  const profile = getSelectedProfile();
  if (!profile) {
    return;
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const next = (stored[STORAGE_KEY] || []).filter((item) => item.id !== profile.id);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  selectedProfileId = "";
  await render();
}

async function createProfile() {
  const profile = {
    id: crypto.randomUUID(),
    name: "New profile",
    matchMode: "page",
    matchValue: "",
    autoFillOnLoad: true,
    url: "",
    title: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields: []
  };

  await upsertProfile(profile);
  selectedProfileId = profile.id;
  await render();
}

async function exportProfiles() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const blob = new Blob([JSON.stringify(stored[STORAGE_KEY] || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "autofill-pro-profiles.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importProfiles(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Imported file must be a JSON array.");
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: parsed });
  selectedProfileId = "";
  await render();
  event.target.value = "";
}
