const STORAGE_KEY = "profiles";
const LEGACY_STORAGE_KEY = "presets";
const ACTIVE_PROFILE_KEY = "activeProfileId";

const elements = {
  pageMeta: document.getElementById("pageMeta"),
  profileSelect: document.getElementById("profileSelect"),
  selectedProfileMeta: document.getElementById("selectedProfileMeta"),
  status: document.getElementById("status"),
  saveBtn: document.getElementById("saveBtn"),
  fillBtn: document.getElementById("fillBtn"),
  newProfileBtn: document.getElementById("newProfileBtn"),
  manageBtn: document.getElementById("manageBtn")
};

let currentTabId = null;
let pageMeta = null;
let allProfiles = [];
let matchingProfiles = [];
let selectedProfileId = "";

init().catch((error) => setStatus(error.message, true));

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  pageMeta = await sendToPage({ type: "pageMeta" });
  elements.pageMeta.textContent = `${pageMeta.title || "Untitled page"} | ${pageMeta.origin}${pageMeta.path}`;

  wireEvents();
  await migrateLegacyPresets();
  await loadActiveProfileSelection();
  await loadProfiles();
}

function wireEvents() {
  elements.saveBtn.addEventListener("click", saveCurrentPageValues);
  elements.fillBtn.addEventListener("click", fillSelectedProfile);
  elements.newProfileBtn.addEventListener("click", createProfileForCurrentPage);
  elements.manageBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.profileSelect.addEventListener("change", handleProfileChange);
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

async function loadActiveProfileSelection() {
  const stored = await chrome.storage.local.get(ACTIVE_PROFILE_KEY);
  selectedProfileId = stored[ACTIVE_PROFILE_KEY] || "";
}

async function loadProfiles() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  allProfiles = stored[STORAGE_KEY] || [];
  matchingProfiles = allProfiles.filter((profile) => matchesCurrentPage(profile));
  allProfiles.sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0);
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0);
    return rightTime - leftTime;
  });
  if (selectedProfileId && !allProfiles.some((profile) => profile.id === selectedProfileId)) {
    selectedProfileId = "";
    await chrome.storage.local.remove(ACTIVE_PROFILE_KEY);
  }
  renderProfileSelect();
  renderSelectedProfile();
}

function renderProfileSelect() {
  elements.profileSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default";
  elements.profileSelect.append(defaultOption);

  for (const profile of allProfiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name || "Untitled profile";
    elements.profileSelect.append(option);
  }

  elements.profileSelect.value = selectedProfileId;
}

function renderSelectedProfile() {
  const profile = getSelectedProfile();

  if (!profile) {
    elements.selectedProfileMeta.textContent = allProfiles.length
      ? "Default is empty. Choose a saved profile or create a new one."
      : "No profiles saved yet. Create one with New Profile.";
    elements.fillBtn.disabled = true;
    return;
  }

  const matching = matchingProfiles.some((item) => item.id === profile.id);
  elements.selectedProfileMeta.textContent = matching
    ? `${describeProfile(profile)} | matches this page`
    : `${describeProfile(profile)} | selected across pages`;
  elements.fillBtn.disabled = false;
}

async function saveCurrentPageValues() {
  const profile = getSelectedProfile();
  if (!profile) {
    setStatus("Select or create a profile first.", true);
    return;
  }

  const data = await sendToPage({ type: "capturePage" });
  if (!data.fields.length) {
    setStatus("No supported fields found on this page.", true);
    return;
  }

  const next = {
    ...structuredClone(profile),
    url: data.url,
    title: data.title,
    updatedAt: new Date().toISOString(),
    fields: data.fields
  };

  if (!next.name || next.name === "New profile") {
    next.name = data.title || `Profile ${new Date().toLocaleDateString()}`;
  }

  await replaceProfile(next);
  await loadProfiles();
  setStatus(`Saved ${next.fields.length} fields to "${next.name}".`);
}

async function fillSelectedProfile() {
  const profile = getSelectedProfile();
  if (!profile) {
    setStatus("Select a profile first.", true);
    return;
  }

  if (!profile.fields.length) {
    setStatus("This profile is empty. Save Field Values first.", true);
    return;
  }

  const result = await sendToPage({ type: "fillPage", preset: { fields: profile.fields } });
  if (result?.ok === false) {
    setStatus(result.error || "Failed to fill the page.", true);
    return;
  }

  setStatus(`Filled page with "${profile.name}".`);
}

async function replaceProfile(next) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allProfiles = (stored[STORAGE_KEY] || []).map((item) => (item.id === next.id ? next : item));
  await chrome.storage.local.set({ [STORAGE_KEY]: allProfiles });
}

function getSelectedProfile() {
  return allProfiles.find((profile) => profile.id === selectedProfileId) || null;
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

async function createProfileForCurrentPage() {
  const inputName = window.prompt("Profile name");
  const name = inputName?.trim();
  if (!name) {
    setStatus("Profile creation cancelled.", true);
    return;
  }

  const profile = {
    id: crypto.randomUUID(),
    name,
    matchMode: "page",
    matchValue: `${pageMeta.origin}${pageMeta.path}`,
    autoFillOnLoad: true,
    url: pageMeta.url,
    title: pageMeta.title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fields: []
  };

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const next = [...(stored[STORAGE_KEY] || []), profile];
  await chrome.storage.local.set({ [STORAGE_KEY]: next });

  selectedProfileId = profile.id;
  await chrome.storage.local.set({ [ACTIVE_PROFILE_KEY]: selectedProfileId });
  await loadProfiles();
  renderSelectedProfile();
  setStatus(`Created "${profile.name}". Save Field Values to capture data.`);
}

async function handleProfileChange() {
  selectedProfileId = elements.profileSelect.value;
  if (selectedProfileId) {
    await chrome.storage.local.set({ [ACTIVE_PROFILE_KEY]: selectedProfileId });
  } else {
    await chrome.storage.local.remove(ACTIVE_PROFILE_KEY);
  }
  renderSelectedProfile();
}

function describeProfile(profile) {
  const scopeLabel = {
    site: "Site",
    page: "Page",
    "path-prefix": "Path prefix",
    custom: "Custom"
  }[profile.matchMode || "page"];

  return `${profile.fields.length} fields | ${scopeLabel}`;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#9f2d23" : "";
}

async function sendToPage(message) {
  return chrome.tabs.sendMessage(currentTabId, message);
}
