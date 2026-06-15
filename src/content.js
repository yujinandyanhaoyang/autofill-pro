(function () {
  const STORAGE_KEY = "presets";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "capturePage") {
      sendResponse(capturePage());
      return false;
    }

    if (message?.type === "fillPage") {
      fillPage(message.preset)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "pageMeta") {
      sendResponse(getPageMeta());
      return false;
    }

    if (message?.type === "inspectPage") {
      sendResponse(inspectPage());
      return false;
    }

    return false;
  });

  function getPageMeta() {
    return {
      title: document.title,
      url: location.href,
      origin: location.origin,
      path: location.pathname,
      fingerprint: getPageFingerprint()
    };
  }

  function getPageFingerprint() {
    return `${location.origin}${location.pathname}`;
  }

  function capturePage() {
    return {
      ...getPageMeta(),
      fields: collectFields()
    };
  }

  function inspectPage() {
    const forms = Array.from(document.forms).map((form, index) => ({
      index,
      id: form.id || "",
      name: form.getAttribute("name") || "",
      action: form.getAttribute("action") || "",
      method: form.getAttribute("method") || "get",
      fieldCount: form.querySelectorAll("input, select, textarea, [contenteditable='true']").length
    }));

    return {
      capturedAt: new Date().toISOString(),
      meta: {
        ...getPageMeta(),
        readyState: document.readyState
      },
      counts: {
        forms: document.forms.length,
        tables: document.querySelectorAll("table").length,
        inputs: document.querySelectorAll("input").length,
        selects: document.querySelectorAll("select").length,
        textareas: document.querySelectorAll("textarea").length,
        contenteditables: document.querySelectorAll("[contenteditable='true']").length
      },
      forms,
      fields: collectFields(true),
      html: document.documentElement.outerHTML
    };
  }

  function collectFields(includeOptions = false) {
    const seenRadioNames = new Set();
    const nodes = Array.from(document.querySelectorAll("input, select, textarea, [contenteditable='true']"));
    const fields = [];

    for (const node of nodes) {
      if (!shouldCapture(node)) {
        continue;
      }

      const descriptor = buildFieldDescriptor(node, seenRadioNames, includeOptions);
      if (descriptor) {
        fields.push(descriptor);
      }
    }

    return fields;
  }

  function shouldCapture(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (node instanceof HTMLInputElement) {
      const blocked = new Set(["hidden", "password", "file", "submit", "button", "reset", "image"]);
      if (blocked.has(node.type)) {
        return false;
      }
    }

    return !node.hasAttribute("disabled");
  }

  function buildFieldDescriptor(node, seenRadioNames, includeOptions) {
    const selector = buildSelector(node);
    if (!selector) {
      return null;
    }

    const component = getComponentInfo(node);
    const base = {
      selector,
      tag: node.tagName.toLowerCase(),
      name: getName(node),
      label: getLabel(node),
      context: getContext(node),
      componentType: component.type,
      wrapperSelector: component.wrapperSelector,
      wrapperId: component.wrapperId,
      readonly: Boolean(node.readOnly),
      placeholder: node.getAttribute("placeholder") || ""
    };

    if (node instanceof HTMLInputElement && node.type === "radio") {
      const group = getRadioGroupInfo(node);
      if (seenRadioNames.has(group.groupKey)) {
        return null;
      }
      seenRadioNames.add(group.groupKey);
      const checked = group.nodes.find((item) => item.checked) || null;
      return {
        ...base,
        type: "radio",
        value: checked ? getRadioLabel(checked) : null,
        options: group.nodes.map((item) => ({
          label: getRadioLabel(item),
          checked: item.checked
        }))
      };
    }

    if (component.type === "custom-tags") {
      return {
        ...base,
        type: "tags",
        value: getTagValues(node)
      };
    }

    if (node instanceof HTMLInputElement && node.type === "checkbox") {
      return {
        ...base,
        type: "checkbox",
        value: node.checked
      };
    }

    if (node instanceof HTMLSelectElement && node.multiple) {
      return {
        ...base,
        type: "select-multiple",
        value: Array.from(node.selectedOptions).map((option) => option.value),
        options: includeOptions ? getSelectOptions(node) : undefined
      };
    }

    if (node instanceof HTMLSelectElement) {
      return {
        ...base,
        type: "select-one",
        value: node.value,
        options: includeOptions ? getSelectOptions(node) : undefined
      };
    }

    if (node instanceof HTMLTextAreaElement) {
      return {
        ...base,
        type: "textarea",
        value: node.value
      };
    }

    if (node instanceof HTMLInputElement) {
      return {
        ...base,
        type: node.type || "text",
        value: node.value
      };
    }

    return {
      ...base,
      type: "contenteditable",
      value: node.textContent || ""
    };
  }

  async function fillPage(preset) {
    if (!preset?.fields?.length) {
      return;
    }

    for (const field of preset.fields) {
      await applyField(field);
    }
  }

  async function applyField(field) {
    if (field.type === "radio") {
      const radio = await findAndSelectRadio(field);
      if (radio) {
        dispatchFieldEvents(radio);
      }
      return;
    }

    const node = findField(field);
    if (!node) {
      return;
    }

    if (field.type === "checkbox" && node instanceof HTMLInputElement) {
      node.checked = Boolean(field.value);
      dispatchFieldEvents(node);
      return;
    }

    if (field.type === "select-multiple" && node instanceof HTMLSelectElement) {
      const wanted = new Set(Array.isArray(field.value) ? field.value : []);
      Array.from(node.options).forEach((option) => {
        option.selected = wanted.has(option.value) || wanted.has(option.text);
      });
      dispatchFieldEvents(node);
      return;
    }

    if (field.type === "tags") {
      await fillTagsField(field, node);
      return;
    }

    if (field.componentType === "custom-select" || field.componentType === "custom-cascader") {
      await fillCustomChoiceField(field, node);
      return;
    }

    if (field.componentType === "custom-date") {
      setControlValue(node, field.value);
      dispatchFieldEvents(node);
      return;
    }

    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      setControlValue(node, field.value);
      dispatchFieldEvents(node);
      return;
    }

    if (node instanceof HTMLElement && field.type === "contenteditable") {
      node.textContent = field.value == null ? "" : String(field.value);
      dispatchFieldEvents(node);
    }
  }

  function findField(field) {
    if (field.wrapperId) {
      const wrappedById = safeQuery(`#${escapeCss(field.wrapperId)} input, #${escapeCss(field.wrapperId)} textarea, #${escapeCss(field.wrapperId)} select`);
      if (wrappedById) {
        return wrappedById;
      }
    }

    if (field.wrapperSelector) {
      const wrappedBySelector = safeQuery(`${field.wrapperSelector} input, ${field.wrapperSelector} textarea, ${field.wrapperSelector} select`);
      if (wrappedBySelector) {
        return wrappedBySelector;
      }
    }

    const selectorMatch = safeQuery(field.selector);
    if (selectorMatch) {
      return selectorMatch;
    }

    if (field.name) {
      const named = safeQuery(`[name="${escapeAttribute(field.name)}"]`);
      if (named) {
        return named;
      }
    }

    if (field.label) {
      const nodes = Array.from(document.querySelectorAll("input, select, textarea, [contenteditable='true']"));
      return nodes.find((node) => getLabel(node) === field.label) || null;
    }

    return null;
  }

  function findRadio(field) {
    if (field.name && field.value != null) {
      return safeQuery(`input[type="radio"][name="${escapeAttribute(field.name)}"][value="${escapeAttribute(field.value)}"]`);
    }

    return findField(field);
  }

  async function findAndSelectRadio(field) {
    if (field.name && field.value != null) {
      const namedGroup = Array.from(document.querySelectorAll(`input[type="radio"][name="${escapeAttribute(field.name)}"]`));
      const direct = namedGroup.find((radio) => getRadioLabel(radio) === field.value || radio.value === field.value);
      if (direct) {
        direct.click();
        return direct;
      }
    }

    const base = findField(field);
    const scope = (base && base.closest(".muya-formitem-input-wrapper, .muya-radio-group, form")) || document;
    const radios = Array.from(scope.querySelectorAll('input[type="radio"]'));
    const target = radios.find((radio) => getRadioLabel(radio) === field.value);
    if (target) {
      target.click();
      return target;
    }

    return null;
  }

  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function dispatchFieldEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setControlValue(node, value) {
    const nextValue = value == null ? "" : String(value);
    const prototype = node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(node, nextValue);
    } else {
      node.value = nextValue;
    }
  }

  function getName(node) {
    return node.getAttribute("name") || node.getAttribute("id") || "";
  }

  function getLabel(node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
      if (node.labels?.length) {
        return normalizeText(node.labels[0].innerText);
      }
    }

    const aria = node.getAttribute("aria-label");
    if (aria) {
      return normalizeText(aria);
    }

    const placeholder = node.getAttribute("placeholder");
    if (placeholder) {
      return normalizeText(placeholder);
    }

    const wrappedLabel = node.closest("label");
    if (wrappedLabel) {
      return normalizeText(wrappedLabel.innerText);
    }

    const row = node.closest("tr");
    if (row) {
      const cell = row.querySelector("th, td");
      if (cell) {
        return normalizeText(cell.innerText);
      }
    }

    const previous = node.previousElementSibling;
    if (previous) {
      return normalizeText(previous.textContent || "");
    }

    return "";
  }

  function getRadioLabel(node) {
    const label = node.closest("label");
    if (label) {
      return normalizeText(label.innerText);
    }
    return node.value || "";
  }

  function getRadioGroupInfo(node) {
    const scope = node.closest(".muya-formitem-input-wrapper, .muya-radio-group, form") || document;
    const nodes = Array.from(scope.querySelectorAll('input[type="radio"]'));
    return {
      groupKey: node.name || buildSelector(scope instanceof Element ? scope : node),
      nodes
    };
  }

  function getComponentInfo(node) {
    const wrapper = node.closest('[role="combobox"], .muya-tags-input-wrapper, .muya-input-input-wrapper');
    const className = wrapper?.className || "";
    let type = "native";

    if (String(className).includes("muya-tags-input")) {
      type = "custom-tags";
    } else if (String(className).includes("muya-cascader")) {
      type = "custom-cascader";
    } else if (String(className).includes("muya-select")) {
      type = "custom-select";
    } else if (node.readOnly && looksLikeDateField(node)) {
      type = "custom-date";
    }

    return {
      type,
      wrapperId: wrapper?.id || "",
      wrapperSelector: wrapper ? buildSelector(wrapper) : ""
    };
  }

  function looksLikeDateField(node) {
    const text = `${node.getAttribute("placeholder") || ""} ${getLabel(node)}`.toLowerCase();
    return text.includes("时间") || text.includes("日期") || /\d{4}-\d{2}-\d{2}/.test(node.value);
  }

  function getTagValues(node) {
    const wrapper = node.closest(".muya-tags-input-wrapper, .muya-tags-input-tags-wrapper");
    if (!wrapper) {
      return [];
    }

    const tags = Array.from(wrapper.querySelectorAll(".muya-tag-children-wrapper, .StyledTagText-dIUACg"));
    return tags
      .map((tag) => normalizeText(tag.textContent || ""))
      .filter(Boolean);
  }

  function getContext(node) {
    const parts = [];
    const form = node.closest("form");
    if (form) {
      parts.push(`form:${form.getAttribute("name") || form.id || "anonymous"}`);
    }

    const table = node.closest("table");
    if (table) {
      parts.push(`table:${table.id || table.className || "anonymous"}`);
    }

    const row = node.closest("tr");
    if (row) {
      parts.push(`row:${normalizeText(row.innerText).slice(0, 120)}`);
    }

    const section = node.closest("section, fieldset, .form-group, .form-item, .ant-form-item, .el-form-item");
    if (section) {
      parts.push(`section:${normalizeText(section.innerText).slice(0, 120)}`);
    }

    return parts.join(" | ");
  }

  function getSelectOptions(node) {
    return Array.from(node.options).map((option) => ({
      value: option.value,
      text: normalizeText(option.textContent || ""),
      selected: option.selected
    }));
  }

  async function fillCustomChoiceField(field, node) {
    const wrapper = resolveChoiceWrapper(field, node);
    const values = Array.isArray(field.value) ? field.value : [field.value];

    if (field.componentType === "custom-cascader" && typeof values[0] === "string" && values[0].includes("/")) {
      const segments = values[0].split("/").map((part) => part.trim()).filter(Boolean);
      for (const segment of segments) {
        if (!wrapper) {
          break;
        }
        wrapper.click();
        await wait(120);
        const option = await findPopupOption(segment, 1200);
        if (option) {
          option.click();
          await wait(150);
        }
      }
      return;
    }

    const first = values.find((value) => value != null && String(value).trim());
    if (!first) {
      return;
    }

    if (wrapper) {
      wrapper.click();
      await wait(120);
      const option = await findPopupOption(String(first), 1200);
      if (option) {
        option.click();
        await wait(120);
        return;
      }
    }

    setControlValue(node, first);
    dispatchFieldEvents(node);
  }

  async function fillTagsField(field, node) {
    const wrapper = resolveChoiceWrapper(field, node) || node.closest(".muya-tags-input-wrapper");
    const values = Array.isArray(field.value) ? field.value : [];
    if (!wrapper || !(node instanceof HTMLInputElement)) {
      return;
    }

    wrapper.click();
    await wait(80);

    for (const value of values) {
      setControlValue(node, value);
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      dispatchFieldEvents(node);
      await wait(120);

      const option = await findPopupOption(String(value), 700);
      if (option) {
        option.click();
        await wait(120);
      } else {
        node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
    }
  }

  function resolveChoiceWrapper(field, node) {
    if (field.wrapperId) {
      const byId = safeQuery(`#${escapeCss(field.wrapperId)}`);
      if (byId) {
        return byId;
      }
    }

    if (field.wrapperSelector) {
      const bySelector = safeQuery(field.wrapperSelector);
      if (bySelector) {
        return bySelector;
      }
    }

    return node.closest('[role="combobox"], .muya-tags-input-wrapper, .muya-input-input-wrapper');
  }

  async function findPopupOption(text, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const option = getVisiblePopupCandidates().find((node) => normalizeText(node.textContent || "") === normalizeText(text));
      if (option) {
        return option;
      }
      await wait(80);
    }
    return null;
  }

  function getVisiblePopupCandidates() {
    const selectors = [
      '[role="option"]',
      '[role="treeitem"]',
      '[role="menuitem"]',
      '.muya-menu-item',
      '.muya-cascader-menu-item',
      '.muya-select-option',
      'li',
      'button',
      'div'
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(", ")));
    return nodes.filter((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const text = normalizeText(node.textContent || "");
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return Boolean(text) && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function buildSelector(node) {
    if (!(node instanceof Element)) {
      return "";
    }

    if (node.id) {
      return `#${escapeCss(node.id)}`;
    }

    const path = [];
    let current = node;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let segment = current.tagName.toLowerCase();
      if (current.getAttribute("name")) {
        segment += `[name="${escapeAttribute(current.getAttribute("name"))}"]`;
      } else {
        segment += `:nth-of-type(${getElementIndex(current)})`;
      }
      path.unshift(segment);
      current = current.parentElement;
    }

    return path.join(" > ");
  }

  function getElementIndex(node) {
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function escapeCss(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return value.replace(/([^\w-])/g, "\\$1");
  }

  function escapeAttribute(value) {
    return String(value).replace(/"/g, '\\"');
  }
})();
