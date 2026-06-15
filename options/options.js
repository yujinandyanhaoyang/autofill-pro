const STORAGE_KEY = "profiles";
const profileList = document.getElementById("presetList");

document.getElementById("exportBtn").addEventListener("click", exportProfiles);
document.getElementById("importInput").addEventListener("change", importProfiles);

init().catch((error) => {
  profileList.textContent = error.message;
});

async function init() {
  await render();
}

async function render() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const profiles = stored[STORAGE_KEY] || [];
  profileList.innerHTML = "";

  if (!profiles.length) {
    profileList.textContent = "No profiles saved yet.";
    return;
  }

  for (const profile of profiles) {
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("input");
    title.type = "text";
    title.value = profile.name || "";

    const matchMode = document.createElement("select");
    for (const optionValue of ["site", "page", "path-prefix", "custom"]) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue;
      option.selected = profile.matchMode === optionValue;
      matchMode.append(option);
    }

    const matchValue = document.createElement("input");
    matchValue.type = "text";
    matchValue.value = profile.matchValue || "";

    const autoFillWrap = document.createElement("label");
    autoFillWrap.className = "checkbox-row";
    const autoFill = document.createElement("input");
    autoFill.type = "checkbox";
    autoFill.checked = profile.autoFillOnLoad !== false;
    const autoFillText = document.createElement("span");
    autoFillText.textContent = "Auto-fill after page load";
    autoFillWrap.append(autoFill, autoFillText);

    const meta = document.createElement("p");
    meta.textContent = `${profile.fields.length} fields | ${profile.matchMode || "site"} | updated ${new Date(profile.updatedAt).toLocaleString()}`;

    const raw = document.createElement("textarea");
    raw.rows = 10;
    raw.value = JSON.stringify(profile.fields, null, 2);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const next = {
        ...profile,
        name: title.value.trim() || profile.name,
        matchMode: matchMode.value,
        matchValue: matchValue.value.trim(),
        autoFillOnLoad: autoFill.checked,
        fields: JSON.parse(raw.value),
        updatedAt: new Date().toISOString()
      };
      await upsertProfile(next);
      await render();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      const storedInner = await chrome.storage.local.get(STORAGE_KEY);
      const next = (storedInner[STORAGE_KEY] || []).filter((item) => item.id !== profile.id);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      await render();
    });

    const head = document.createElement("div");
    head.className = "card-head";
    head.append(title);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(saveBtn, deleteBtn);

    card.append(head, meta, matchMode, matchValue, autoFillWrap, raw, actions);
    profileList.append(card);
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
  await render();
  event.target.value = "";
}
