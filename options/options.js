const STORAGE_KEY = "presets";
const presetList = document.getElementById("presetList");

document.getElementById("exportBtn").addEventListener("click", exportPresets);
document.getElementById("importInput").addEventListener("change", importPresets);

init().catch((error) => {
  presetList.textContent = error.message;
});

async function init() {
  await render();
}

async function render() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const presets = stored[STORAGE_KEY] || [];
  presetList.innerHTML = "";

  if (!presets.length) {
    presetList.textContent = "No presets saved yet.";
    return;
  }

  for (const preset of presets) {
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("input");
    title.type = "text";
    title.value = preset.name;

    const adapterType = document.createElement("select");
    for (const optionValue of ["generic", "fxiaoke"]) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue === "fxiaoke" ? "Fxiaoke manual fill" : "Generic form";
      option.selected = getAdapterType(preset) === optionValue;
      adapterType.append(option);
    }

    const meta = document.createElement("p");
    const simpleFields = Array.isArray(preset.simpleFields) ? preset.simpleFields : (preset.fields || []);
    const groups = Array.isArray(preset.groups) ? preset.groups : [];
    meta.textContent = `${preset.fingerprint} | ${getAdapterLabel(preset)} | ${simpleFields.length} fields | ${groups.length} groups | updated ${new Date(preset.updatedAt).toLocaleString()}`;

    const raw = document.createElement("textarea");
    raw.rows = 8;
    raw.value = JSON.stringify({
      version: preset.version || 1,
      simpleFields,
      groups
    }, null, 2);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      const next = {
        ...preset,
        name: title.value.trim() || preset.name,
        adapterType: adapterType.value,
        autoFillOnLoad: adapterType.value === "fxiaoke" ? false : preset.autoFillOnLoad !== false,
        ...JSON.parse(raw.value),
        updatedAt: new Date().toISOString()
      };
      await upsertPreset(next);
      await render();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      const storedInner = await chrome.storage.local.get(STORAGE_KEY);
      const next = (storedInner[STORAGE_KEY] || []).filter((item) => item.id !== preset.id);
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      await render();
    });

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(saveBtn, deleteBtn);

    const head = document.createElement("div");
    head.className = "card-head";
    head.append(title);

    card.append(head, meta, adapterType, raw, actions);
    presetList.append(card);
  }
}

async function upsertPreset(next) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const current = stored[STORAGE_KEY] || [];
  const existing = current.some((item) => item.id === next.id);
  const updated = existing
    ? current.map((item) => (item.id === next.id ? next : item))
    : [...current, next];
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

async function exportPresets() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const blob = new Blob([JSON.stringify(stored[STORAGE_KEY] || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "autofill-pro-presets.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function importPresets(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Imported file must be a JSON array.");
  }

  await chrome.storage.local.set({
    [STORAGE_KEY]: parsed.map((preset) => ({
      ...preset,
      adapterType: getAdapterType(preset),
      autoFillOnLoad: getAdapterType(preset) === "fxiaoke" ? false : preset.autoFillOnLoad !== false
    }))
  });
  await render();
  event.target.value = "";
}

function getAdapterType(preset) {
  return preset?.adapterType === "fxiaoke" ? "fxiaoke" : "generic";
}

function getAdapterLabel(preset) {
  return getAdapterType(preset) === "fxiaoke" ? "Fxiaoke" : "Generic";
}
