(function () {
  const TEMPLATE_VERSION = 2;
  const FIELD_SELECTOR = "input, select, textarea, [contenteditable='true']";
  const FIELD_CONTAINER_SELECTOR = ".muya-formitem-input-wrapper, .muya-formitem-wrapper, td, th, label, form, section";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "capturePage") {
      sendResponse(capturePage());
      return false;
    }

    if (message?.type === "fillPage") {
      fillPage(message.preset)
        .then((result) => sendResponse(result))
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
      fingerprint: getPageFingerprint()
    };
  }

  function getPageFingerprint() {
    return `${location.origin}${location.pathname}`;
  }

  function capturePage() {
    const template = buildPresetTemplate();
    return {
      ...getPageMeta(),
      ...template
    };
  }

  function inspectPage() {
    const template = buildPresetTemplate(true);
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
      fxiaokeDiagnostics: collectFxiaokeDiagnostics(template),
      template,
      fields: flattenTemplate(template),
      html: document.documentElement.outerHTML
    };
  }

  function buildPresetTemplate(includeOptions = false) {
    if (hasFxiaokeEditor()) {
      return buildFxiaokePresetTemplate(includeOptions);
    }

    const excludedNodes = new WeakSet();
    const groups = [];

    const repeatable = collectRepeatableGroups(includeOptions);
    repeatable.groups.forEach((group) => groups.push(group));
    repeatable.nodes.forEach((node) => excludedNodes.add(node));

    const standalone = collectStandaloneGroups(includeOptions);
    standalone.groups.forEach((group) => groups.push(group));
    standalone.nodes.forEach((node) => excludedNodes.add(node));

    const simpleFields = collectSimpleFields(excludedNodes, includeOptions);

    return {
      version: TEMPLATE_VERSION,
      simpleFields,
      groups
    };
  }

  function hasFxiaokeEditor() {
    return Boolean(document.querySelector(".f-g-item .j-comp-wrap[data-apiname]"));
  }

  function buildFxiaokePresetTemplate(includeOptions) {
    const simpleFields = Array.from(document.querySelectorAll(".f-g-item.j-item-wrap .j-comp-wrap[data-apiname]"))
      .filter((wrapper) => isVisible(wrapper) && !wrapper.classList.contains("field-comp-disabled"))
      .map((wrapper) => buildFxiaokeFieldDescriptor(wrapper, includeOptions))
      .filter(Boolean);

    return {
      version: TEMPLATE_VERSION,
      adapterType: "fxiaoke",
      simpleFields,
      groups: []
    };
  }

  function buildFxiaokeFieldDescriptor(wrapper, includeOptions) {
    const item = wrapper.closest(".f-g-item.j-item-wrap");
    const apiName = wrapper.getAttribute("data-apiname") || "";
    const fieldType = wrapper.getAttribute("data-type") || "text";
    const label = normalizeText(item?.querySelector(".f-g-item-label")?.textContent || "");
    const control = getFxiaokeControl(wrapper);

    if (!apiName || !control) {
      return null;
    }

    const componentType = getFxiaokeComponentType(fieldType, wrapper);
    return {
      selector: `[data-apiname="${escapeAttribute(apiName)}"]`,
      fxiaokeApiName: apiName,
      label,
      context: normalizeText(item?.querySelector(".f-title-help")?.getAttribute("data-title") || ""),
      componentType,
      type: componentType === "fxiaoke-date" ? "date" : "text",
      value: getFxiaokeCapturedValue(wrapper, control, fieldType),
      enabled: hasFxiaokeCapturedValue(getFxiaokeCapturedValue(wrapper, control, fieldType))
    };
  }

  function hasFxiaokeCapturedValue(value) {
    return Array.isArray(value) ? value.length > 0 : normalizeText(String(value ?? "")) !== "";
  }

  function getFxiaokeCapturedValue(wrapper, control, fieldType) {
    if (fieldType === "select_many" && wrapper.querySelector(".crm-field-selecttile")) {
      return Array.from(wrapper.querySelectorAll("label.item.checked"))
        .map((node) => normalizeText(node.textContent || ""))
        .filter(Boolean);
    }
    if (wrapper.querySelector(".crm-action-field-lookup")) {
      return getFxiaokeSelectedLookupValue(wrapper);
    }
    return getFxiaokeDisplayValue(wrapper, control);
  }

  function getFxiaokeSelectedLookupValue(wrapper) {
    const selected = Array.from(wrapper.querySelectorAll(".j-search-item.r-selected"))
      .map((node) => getFxiaokeOptionValue(node))
      .find(Boolean);
    return selected || "";
  }

  function getFxiaokeComponentType(fieldType, wrapper) {
    if (fieldType === "date" || wrapper.querySelector(".el-date-editor")) {
      return "fxiaoke-date";
    }
    if (fieldType === "currency" || wrapper.querySelector(".crm-action-fakeiptwrap")) {
      return "fxiaoke-currency";
    }
    if (wrapper.querySelector(".crm-field-selecttile")) {
      return "fxiaoke-tiled";
    }
    if (wrapper.querySelector(".crm-action-field-lookup")) {
      return "fxiaoke-lookup";
    }
    if (/select|lookup|reference|owner|department|employee|customer/i.test(fieldType)) {
      return "fxiaoke-select";
    }
    return "fxiaoke-text";
  }

  function getFxiaokeControl(wrapper) {
    return wrapper.querySelector(".j-f-ipt, textarea, [contenteditable='true'], .j-select-input, .el-input__inner, input");
  }

  function getFxiaokeDisplayValue(wrapper, control) {
    const selectedTile = wrapper.querySelector("label.item.checked, label.item.radio.checked, label.item.checkbox.checked");
    if (selectedTile) {
      return normalizeText(selectedTile.textContent || "");
    }
    const fakeInput = wrapper.querySelector(".crm-action-fakeiptwrap");
    const value = fakeInput?.textContent || getNodeDisplayValue(control) || control?.getAttribute("title") || "";
    return normalizeText(value);
  }

  function collectSimpleFields(excludedNodes, includeOptions) {
    const seenRadioGroups = new Set();
    const fields = [];
    const nodes = Array.from(document.querySelectorAll(FIELD_SELECTOR));

    for (const node of nodes) {
      if (!shouldCapture(node) || excludedNodes.has(node)) {
        continue;
      }

      const descriptor = buildFieldDescriptor(node, {
        includeOptions,
        seenRadioGroups,
        forceNative: false
      });

      if (!descriptor) {
        continue;
      }

      if (descriptor.componentType === "custom-tags" || descriptor.componentType === "custom-cascader") {
        continue;
      }

      fields.push(descriptor);
    }

    return fields;
  }

  function collectStandaloneGroups(includeOptions) {
    const groups = [];
    const nodes = [];
    const seenWrappers = new Set();

    for (const node of Array.from(document.querySelectorAll(FIELD_SELECTOR))) {
      if (!shouldCapture(node) || isInsideRepeatableTable(node)) {
        continue;
      }

      const component = getComponentInfo(node);
      const groupKey = component.wrapperId || component.wrapperSelector;
      if (!groupKey || seenWrappers.has(groupKey)) {
        continue;
      }

      if (component.type === "custom-tags") {
        const group = buildMultiValueGroup(node, includeOptions);
        if (group) {
          group.memberNodes.forEach((member) => nodes.push(member));
          delete group.memberNodes;
          groups.push(group);
          seenWrappers.add(groupKey);
        }
        continue;
      }

      if (component.type === "custom-cascader") {
        const group = buildCascaderGroup(node, includeOptions);
        if (group) {
          group.memberNodes.forEach((member) => nodes.push(member));
          delete group.memberNodes;
          groups.push(group);
          seenWrappers.add(groupKey);
        }
      }
    }

    return { groups, nodes };
  }

  function collectRepeatableGroups(includeOptions) {
    const groups = [];
    const nodes = [];

    for (const table of Array.from(document.querySelectorAll("table"))) {
      const group = buildRepeatableGroup(table, includeOptions);
      if (!group) {
        continue;
      }

      group.memberNodes.forEach((member) => nodes.push(member));
      delete group.memberNodes;
      groups.push(group);
    }

    return { groups, nodes };
  }

  function buildRepeatableGroup(table, includeOptions) {
    const rows = getDataRows(table);
    const capturedRows = [];
    const memberNodes = [];
    const headers = getTableHeaders(table);

    for (const [rowIndex, row] of rows.entries()) {
      const rowFields = captureRowFields(row, rowIndex, headers, includeOptions);
      if (!rowFields.length) {
        continue;
      }

      rowFields.forEach((field) => {
        if (field._node) {
          memberNodes.push(field._node);
          delete field._node;
        }
      });

      capturedRows.push({
        rowIndex,
        fields: rowFields
      });
    }

    if (!capturedRows.length) {
      return null;
    }

    return {
      kind: "repeatable-table",
      key: buildSelector(table),
      label: getGroupLabel(table),
      tableSelector: buildSelector(table),
      addRowSelector: findAddRowSelector(table),
      addRowText: findAddRowText(table),
      headers,
      rows: capturedRows,
      memberNodes
    };
  }

  function captureRowFields(row, rowIndex, headers, includeOptions) {
    const seenRadioGroups = new Set();
    const fields = [];
    const cells = Array.from(row.querySelectorAll("td"));

    cells.forEach((cell, columnIndex) => {
      const localSeenWrappers = new Set();
      const fieldNodes = Array.from(cell.querySelectorAll(FIELD_SELECTOR));

      for (const node of fieldNodes) {
        if (!shouldCapture(node)) {
          continue;
        }

        const component = getComponentInfo(node);
        const wrapperKey = component.wrapperId || component.wrapperSelector;
        let descriptor = null;

        if (component.type === "custom-tags" && wrapperKey) {
          if (localSeenWrappers.has(wrapperKey)) {
            continue;
          }
          localSeenWrappers.add(wrapperKey);
          const group = buildMultiValueGroup(node, includeOptions);
          if (group) {
            descriptor = group.field;
          }
        } else if (component.type === "custom-cascader" && wrapperKey) {
          if (localSeenWrappers.has(wrapperKey)) {
            continue;
          }
          localSeenWrappers.add(wrapperKey);
          const group = buildCascaderGroup(node, includeOptions);
          if (group) {
            descriptor = group.field;
            if (group.detailField) {
              fields.push({
                ...group.detailField,
                rowIndex,
                columnIndex,
                columnLabel: headers[columnIndex] || ""
              });
            }
          }
        } else {
          descriptor = buildFieldDescriptor(node, {
            includeOptions,
            seenRadioGroups,
            forceNative: false
          });
        }

        if (!descriptor) {
          continue;
        }

        fields.push({
          ...descriptor,
          rowIndex,
          columnIndex,
          columnLabel: headers[columnIndex] || "",
          _node: node
        });
      }
    });

    return fields;
  }

  function buildMultiValueGroup(node, includeOptions) {
    const field = buildFieldDescriptor(node, {
      includeOptions,
      seenRadioGroups: new Set(),
      forceNative: false
    });

    if (!field) {
      return null;
    }

    return {
      kind: "multi-value-field",
      key: field.wrapperId || field.wrapperSelector || field.selector,
      label: getFieldTitle(field),
      field,
      values: Array.isArray(field.value) ? field.value : [],
      memberNodes: [node]
    };
  }

  function buildCascaderGroup(node, includeOptions) {
    const field = buildFieldDescriptor(node, {
      includeOptions,
      seenRadioGroups: new Set(),
      forceNative: false
    });

    if (!field) {
      return null;
    }

    const detailNode = findLinkedDetailField(node);
    let detailField = null;
    const memberNodes = [node];

    if (detailNode) {
      detailField = buildFieldDescriptor(detailNode, {
        includeOptions,
        seenRadioGroups: new Set(),
        forceNative: true
      });
      if (detailField) {
        memberNodes.push(detailNode);
      }
    }

    return {
      kind: "cascader-field",
      key: field.wrapperId || field.wrapperSelector || field.selector,
      label: getFieldTitle(field),
      field,
      path: field.path || [],
      detailField,
      memberNodes
    };
  }

  function buildFieldDescriptor(node, options) {
    const includeOptions = Boolean(options?.includeOptions);
    const forceNative = Boolean(options?.forceNative);
    const seenRadioGroups = options?.seenRadioGroups || new Set();
    const selector = buildSelector(node);

    if (!selector) {
      return null;
    }

    const component = forceNative ? getNativeComponentInfo(node) : getComponentInfo(node);
    const base = {
      selector,
      tag: node.tagName.toLowerCase(),
      name: getName(node),
      label: getLabel(node),
      context: getContext(node),
      componentType: component.type,
      wrapperSelector: component.wrapperSelector,
      wrapperId: component.wrapperId,
      readonly: isReadonlyNode(node),
      placeholder: node.getAttribute("placeholder") || ""
    };

    if (node instanceof HTMLInputElement && node.type === "radio") {
      const group = getRadioGroupInfo(node);
      if (seenRadioGroups.has(group.groupKey)) {
        return null;
      }

      seenRadioGroups.add(group.groupKey);
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

    if (component.type === "custom-cascader") {
      const path = parsePathValue(node);
      return {
        ...base,
        type: "text",
        value: path.join("/"),
        path
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
    if (getAdapterType(preset) === "fxiaoke" || hasFxiaokeFields(preset)) {
      return fillFxiaokePage(preset);
    }

    return fillGenericPage(preset);
  }

  function hasFxiaokeFields(preset) {
    const fields = Array.isArray(preset?.simpleFields) ? preset.simpleFields : preset?.fields;
    return Array.isArray(fields) && fields.some((field) => field?.fxiaokeApiName);
  }

  async function fillFxiaokePage(preset) {
    const template = normalizePreset(preset);
    const outcomes = [];
    const enabledFields = template.simpleFields
      .filter((field) => isFxiaokeFieldEnabled(field))
      .sort((left, right) => getFxiaokeFillWeight(left) - getFxiaokeFillWeight(right));
    const skipped = template.simpleFields
      .filter((field) => !isFxiaokeFieldEnabled(field))
      .map((field) => ({ field: getFieldTitle(field), apiName: field.fxiaokeApiName || "", status: "skipped", reason: "not-enabled" }));

    const accountFields = enabledFields.filter((field) => field.fxiaokeApiName === "account_id");
    const remainingFields = enabledFields.filter((field) => field.fxiaokeApiName !== "account_id");

    // Fxiaoke reconfigures the opportunity form after a customer is selected.
    // Do not write dependent values until that state transition is confirmed.
    for (const field of accountFields) {
      const result = await fillFxiaokeField(field);
      if (!result.ok) {
        outcomes.push({ field: getFieldTitle(field), apiName: field.fxiaokeApiName, status: "failed", reason: result.reason || "account-not-confirmed" });
        return buildFxiaokeFillResult(outcomes, skipped, template, remainingFields, "account-not-confirmed");
      }
      outcomes.push({ field: getFieldTitle(field), apiName: field.fxiaokeApiName, status: "filled" });
      const settled = await waitForFxiaokeFormRefresh(5000);
      if (!settled) {
        outcomes.push({ field: getFieldTitle(field), apiName: field.fxiaokeApiName, status: "failed", reason: "account-form-not-ready" });
        return buildFxiaokeFillResult(outcomes, skipped, template, remainingFields, "account-form-not-ready");
      }
    }

    const pending = remainingFields;

    for (let attempt = 0; pending.length && attempt < 3; attempt += 1) {
      const retry = [];
      for (const field of pending) {
        const result = field.fxiaokeApiName
          ? await fillFxiaokeField(field)
          : { ok: await applyField(field, document), reason: "generic-field" };
        if (result.ok) {
          outcomes.push({ field: getFieldTitle(field), apiName: field.fxiaokeApiName || "", status: "filled" });
          await waitForDomSettled(120);
        } else if (attempt < 2 && shouldRetryFxiaokeField(result.reason)) {
          retry.push(field);
        } else {
          outcomes.push({ field: getFieldTitle(field), apiName: field.fxiaokeApiName || "", status: "failed", reason: result.reason || "not-applied" });
        }
      }
      pending.splice(0, pending.length, ...retry);
      if (retry.length) {
        await waitForDomSettled(350);
      }
    }

    return buildFxiaokeFillResult(outcomes, skipped, template);
  }

  function buildFxiaokeFillResult(outcomes, skipped, template, blockedFields = [], blockedReason = "") {
    const blocked = blockedFields.map((field) => ({
      field: getFieldTitle(field),
      apiName: field.fxiaokeApiName || "",
      status: "skipped",
      reason: blockedReason
    }));
    const allOutcomes = outcomes.concat(blocked);
    const failures = allOutcomes.filter((item) => item.status === "failed").map((item) => item.field);
    return {
      ok: true,
      adapter: "fxiaoke",
      failures,
      outcomes: allOutcomes,
      skipped,
      blockedReason,
      diagnostics: collectFxiaokeDiagnostics(template)
    };
  }

  function shouldRetryFxiaokeField(reason) {
    return reason === "disabled" || reason === "not-found" || reason === "lookup-option-not-found";
  }

  function isFxiaokeFieldEnabled(field) {
    if (field.enabled === false) {
      return false;
    }
    return field.enabled === true || hasFxiaokeCapturedValue(field.value);
  }

  function getFxiaokeFillWeight(field) {
    if (field.fxiaokeApiName === "account_id") {
      return 0;
    }
    if (field.componentType === "fxiaoke-text" || field.componentType === "fxiaoke-date" || field.componentType === "fxiaoke-currency") {
      return 1;
    }
    if (field.componentType === "fxiaoke-select") {
      return 2;
    }
    if (field.componentType === "fxiaoke-tiled") {
      return 3;
    }
    return 4;
  }

  async function fillFxiaokeField(field) {
    const wrapper = findFxiaokeWrapper(field);
    if (!wrapper) {
      return { ok: false, reason: "not-found" };
    }
    if (wrapper.classList.contains("field-comp-disabled")) {
      return { ok: false, reason: "disabled" };
    }

    const control = getFxiaokeControl(wrapper);
    if (!control) {
      return { ok: false, reason: "no-control" };
    }

    wrapper.scrollIntoView({ block: "center", inline: "nearest" });

    if (field.componentType === "fxiaoke-select" || field.componentType === "fxiaoke-lookup" || field.componentType === "fxiaoke-tiled") {
      return fillFxiaokeSelect(wrapper, control, field.value);
    }

    if (field.componentType === "fxiaoke-currency") {
      return fillFxiaokeCurrency(wrapper, control, field.value);
    }

    const nativeApplied = await nativeReplaceText(control, field.value);
    if (nativeApplied) {
      const nativeOk = await waitForFxiaokeValue(wrapper, field.value, 1200);
      if (nativeOk) {
        return { ok: true, reason: "" };
      }
    }
    setControlValue(control, field.value);
    dispatchFieldEvents(control);
    const ok = await waitForFxiaokeValue(wrapper, field.value, 1000);
    return { ok, reason: ok ? "" : "value-not-applied" };
  }

  async function fillFxiaokeCurrency(wrapper, control, value) {
    const overlay = wrapper.querySelector(".crm-action-fakeiptwrap");
    if (overlay) {
      control.focus({ preventScroll: true });
      await wait(80);
      const nativeApplied = await nativeTypeText(value);
      if (nativeApplied && await waitForFxiaokeValue(wrapper, value, 1400)) {
        return { ok: true, reason: "" };
      }
    }

    setControlValue(control, value);
    dispatchFieldEvents(control);
    const ok = await waitForFxiaokeValue(wrapper, value, 1200);
    return { ok, reason: ok ? "" : "currency-not-applied" };
  }

  function findFxiaokeWrapper(field) {
    if (field.fxiaokeApiName) {
      const selector = `.j-comp-wrap[data-apiname="${escapeAttribute(field.fxiaokeApiName)}"]`;
      const matches = Array.from(document.querySelectorAll(selector));
      const visible = matches.find((node) => isVisible(node) && !node.closest(".f-disable"));
      if (visible) {
        return visible;
      }
    }

    if (field.label) {
      const item = Array.from(document.querySelectorAll(".f-g-item.j-item-wrap"))
        .find((node) => isVisible(node) && normalizeText(node.querySelector(".f-g-item-label")?.textContent || "") === field.label);
      return item?.querySelector(".j-comp-wrap[data-apiname]") || null;
    }

    return null;
  }

  async function fillFxiaokeSelect(wrapper, control, value) {
    const desiredValues = Array.isArray(value)
      ? value.map((item) => normalizeText(String(item))).filter(Boolean)
      : [normalizeText(String(value ?? ""))].filter(Boolean);
    if (!desiredValues.length) {
      return { ok: true, reason: "" };
    }
    const desired = desiredValues[0];

    if (wrapper.querySelector(".crm-field-selecttile")) {
      const tiles = Array.from(wrapper.querySelectorAll("label.item"));
      for (const tile of tiles) {
        const selected = tile.classList.contains("checked");
        const wanted = desiredValues.includes(normalizeText(tile.textContent || ""));
        if (selected !== wanted) {
          await nativeClick(tile);
          await wait(80);
        }
      }
      const ok = await waitForFxiaokeTiles(wrapper, desiredValues, 1200);
      return { ok, reason: ok ? "" : "selection-not-confirmed" };
    }

    if (wrapper.querySelector(".crm-action-field-lookup")) {
      return fillFxiaokeLookup(wrapper, desired);
    }

    const panel = await openFxiaokeSelectPanel(wrapper, control);
    if (!panel) {
      return { ok: false, reason: "panel-not-opened" };
    }
    const option = await findFxiaokePanelOption(panel, desired, 1200);
    if (!option) {
      return { ok: false, reason: "option-not-found" };
    }

    await nativeClick(option);
    const ok = await waitForFxiaokeValue(wrapper, desired, 1500);
    return { ok, reason: ok ? "" : "selection-not-confirmed" };
  }

  async function openFxiaokeSelectPanel(wrapper, control) {
    const triggers = [
      wrapper.querySelector(".j-select-input"),
      wrapper.querySelector(".j-ipt-target"),
      wrapper.querySelector(".select-tit"),
      control
    ].filter((node, index, nodes) => node instanceof HTMLElement && nodes.indexOf(node) === index);

    for (const trigger of triggers) {
      await nativeClick(trigger);
      if (trigger instanceof HTMLInputElement) {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
      }
      const panel = await waitForFxiaokePanel(wrapper, 450);
      if (panel) {
        return panel;
      }
      triggerChoice(trigger);
      const fallbackPanel = await waitForFxiaokePanel(wrapper, 250);
      if (fallbackPanel) {
        return fallbackPanel;
      }
    }
    return null;
  }

  async function waitForFxiaokeTiles(wrapper, expectedValues, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const selected = Array.from(wrapper.querySelectorAll("label.item.checked"))
        .map((node) => normalizeText(node.textContent || ""));
      if (selected.length === expectedValues.length && expectedValues.every((value) => selected.includes(value))) {
        return true;
      }
      await wait(60);
    }
    return false;
  }

  async function fillFxiaokeLookup(wrapper, desired) {
    const input = wrapper.querySelector(".j-search-ipt");
    if (!(input instanceof HTMLInputElement) || input.disabled) {
      return { ok: false, reason: "lookup-disabled" };
    }

    const resolvedDesired = resolveFxiaokeLookupValue(wrapper, desired);

    if (hasFxiaokeLookupSelection(wrapper, resolvedDesired)) {
      return { ok: true, reason: "already-selected" };
    }

    // Lookup search must remain focused until a result is explicitly selected.
    // Blurring with Tab makes Fxiaoke validate the partial query as an invalid value.
    const nativeApplied = await nativeReplaceText(input, resolvedDesired, { commit: false });
    if (!nativeApplied) {
      triggerChoice(input);
      setControlValue(input, resolvedDesired);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const option = await findFxiaokePanelOption(wrapper, resolvedDesired, 4000, ".j-search-item");
    if (!option) {
      return { ok: false, reason: "lookup-option-not-found" };
    }
    await nativeClick(option);
    const ok = await waitForFxiaokeLookupSelection(wrapper, resolvedDesired, 2200);
    return { ok, reason: ok ? "" : "lookup-not-confirmed" };
  }

  function resolveFxiaokeLookupValue(wrapper, desired) {
    const wanted = normalizeText(desired);
    const candidates = Array.from(wrapper.querySelectorAll(".j-search-item [data-title]"))
      .map((node) => normalizeText(node.getAttribute("data-title") || ""))
      .filter(Boolean);
    if (candidates.includes(wanted)) {
      return wanted;
    }
    return candidates.find((candidate) => wanted.length > candidate.length
      && wanted.length % candidate.length === 0
      && candidate.repeat(wanted.length / candidate.length) === wanted) || wanted;
  }

  function hasFxiaokeLookupSelection(wrapper, desired) {
    const wanted = normalizeText(desired);
    return Array.from(wrapper.querySelectorAll(".j-search-item.r-selected"))
      .some((node) => getFxiaokeOptionValue(node) === wanted);
  }

  async function waitForFxiaokeLookupSelection(wrapper, desired, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (hasFxiaokeLookupSelection(wrapper, desired)
        && !Array.from(wrapper.querySelectorAll(".fm-error")).some((node) => isVisible(node))) {
        return true;
      }
      await wait(80);
    }
    return false;
  }

  async function waitForFxiaokeFormRefresh(timeoutMs) {
    const startedAt = Date.now();
    let stableSince = 0;
    let lastSignature = "";
    while (Date.now() - startedAt < timeoutMs) {
      const signature = Array.from(document.querySelectorAll(".j-comp-wrap[data-apiname]"))
        .filter((node) => isVisible(node))
        .map((node) => `${node.getAttribute("data-apiname")}:${node.classList.contains("field-comp-disabled")}`)
        .join("|");
      if (signature && signature === lastSignature) {
        if (!stableSince) {
          stableSince = Date.now();
        }
        if (Date.now() - stableSince >= 500) {
          return true;
        }
      } else {
        lastSignature = signature;
        stableSince = 0;
      }
      await wait(100);
    }
    return false;
  }

  async function waitForFxiaokePanel(wrapper, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const panel = Array.from(wrapper.querySelectorAll(".crm-w-panel, .list-menu"))
        .find((node) => node instanceof HTMLElement && isVisible(node));
      if (panel) {
        return panel;
      }
      await wait(60);
    }
    return null;
  }

  async function findFxiaokePanelOption(root, desired, timeoutMs, selector = "li[action-type='itemclick']") {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const option = Array.from(root.querySelectorAll(selector))
        .find((node) => node instanceof HTMLElement && isVisible(node) && getFxiaokeOptionValue(node) === desired);
      if (option) {
        return option;
      }
      await wait(60);
    }
    return null;
  }

  function getFxiaokeOptionValue(node) {
    const titled = Array.from(node.querySelectorAll("[data-title]"))
      .map((child) => normalizeText(child.getAttribute("data-title") || ""))
      .find(Boolean);
    return titled || normalizeText(node.textContent || "");
  }

  async function findFxiaokeOption(desired, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const matches = Array.from(document.querySelectorAll("[role='option'], li, label.item, .select-item, .option, .j-option, .j-select-item, .j-search-item, .crm-w-select-item"))
        .filter((node) => node instanceof HTMLElement && isVisible(node))
        .filter((node) => normalizeText(node.textContent || "") === desired);
      if (matches.length) {
        matches.sort((a, b) => getElementDepth(b) - getElementDepth(a));
        return matches[0];
      }
      await wait(80);
    }
    return null;
  }

  async function waitForFxiaokeValue(wrapper, expected, timeoutMs) {
    const wanted = normalizeText(String(expected ?? ""));
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const control = getFxiaokeControl(wrapper);
      const values = [
        getFxiaokeDisplayValue(wrapper, control),
        getNodeDisplayValue(control),
        normalizeText(wrapper.querySelector(".crm-action-fakeiptwrap")?.textContent || "")
      ];
      if (values.some((value) => normalizeText(value) === wanted)) {
        return true;
      }
      await wait(80);
    }
    return false;
  }

  async function fillGenericPage(preset) {
    const template = normalizePreset(preset);
    const failures = [];
    const earlySimpleFields = template.simpleFields.filter(isStructuralField);
    const lateSimpleFields = template.simpleFields.filter((field) => !isStructuralField(field));

    for (const field of earlySimpleFields) {
      const ok = await applyField(field, document);
      if (!ok) {
        failures.push(getFieldTitle(field));
      }
    }

    for (const group of template.groups) {
      const result = await fillGroup(group);
      if (!result.ok) {
        failures.push(result.label);
      }
    }

    for (const field of lateSimpleFields) {
      const ok = await applyField(field, document);
      if (!ok) {
        failures.push(getFieldTitle(field));
      }
    }

    for (const field of lateSimpleFields) {
      const verified = await ensureFieldValue(field, document, 2);
      if (!verified && !failures.includes(getFieldTitle(field))) {
        failures.push(getFieldTitle(field));
      }
    }

    return {
      ok: true,
      adapter: "generic",
      failures
    };
  }

  function normalizePreset(preset) {
    if (preset?.version === TEMPLATE_VERSION) {
      return {
        version: TEMPLATE_VERSION,
        adapterType: getAdapterType(preset),
        simpleFields: Array.isArray(preset.simpleFields) ? preset.simpleFields : [],
        groups: Array.isArray(preset.groups) ? preset.groups : []
      };
    }

    return {
      version: TEMPLATE_VERSION,
      adapterType: getAdapterType(preset),
      simpleFields: Array.isArray(preset?.fields) ? preset.fields : [],
      groups: []
    };
  }

  function getAdapterType(preset) {
    return preset?.adapterType === "fxiaoke" ? "fxiaoke" : "generic";
  }

  async function fillGroup(group) {
    if (group.kind === "multi-value-field") {
      const ok = await fillMultiValueGroup(group);
      return { ok, label: group.label || "multi-value field" };
    }

    if (group.kind === "cascader-field") {
      const ok = await fillCascaderGroup(group);
      return { ok, label: group.label || "cascader field" };
    }

    if (group.kind === "repeatable-table") {
      const ok = await fillRepeatableGroup(group);
      return { ok, label: group.label || "repeatable table" };
    }

    return { ok: true, label: group.label || "group" };
  }

  async function fillRepeatableGroup(group) {
    const table = findRepeatableTable(group);
    if (!table) {
      return false;
    }

    let rows = getDataRows(table);
    if (rows.length < group.rows.length) {
      const addButton = findAddRowButton(group, table);
      if (!addButton) {
        return false;
      }

      while (rows.length < group.rows.length) {
        const previousCount = rows.length;
        triggerChoice(addButton);
        const grown = await waitForRowCount(table, previousCount + 1, 2000);
        if (!grown) {
          return false;
        }
        rows = getDataRows(table);
      }
    }

    for (const row of group.rows) {
      const liveRow = rows[row.rowIndex];
      if (!liveRow) {
        return false;
      }

      const orderedFields = orderFieldsForFill(row.fields);
      for (const field of orderedFields) {
        const ok = await applyField(field, liveRow);
        if (!ok) {
          return false;
        }
      }
    }

    for (const row of group.rows) {
      const liveRow = rows[row.rowIndex];
      if (!liveRow) {
        return false;
      }

      const verificationFields = orderFieldsForVerification(row.fields);
      for (const field of verificationFields) {
        const verified = await ensureFieldValue(field, liveRow, 2);
        if (!verified) {
          return false;
        }
      }
    }

    return true;
  }

  async function fillMultiValueGroup(group) {
    const node = findField(group.field, document);
    if (!node || !(node instanceof HTMLInputElement)) {
      return false;
    }

    const wrapper = resolveChoiceWrapper(group.field, node);
    if (!wrapper) {
      return false;
    }

    clearTags(wrapper);
    for (const value of group.values || []) {
      let popupRoots = await openChoicePopup(wrapper, node);
      let option = await findPopupOptionInContext(popupRoots, String(value), 800);
      if (!option) {
        setControlValue(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(120);
        popupRoots = getActivePopupRoots();
        option = await findPopupOptionInContext(popupRoots, String(value), 1200);
      }
      if (!option) {
        return false;
      }
      triggerChoice(option);
      const selected = await waitForTagValue(wrapper, String(value), 1000);
      if (!selected) {
        return false;
      }
    }

    return true;
  }

  async function fillCascaderGroup(group) {
    const node = findField(group.field, document);
    if (!node) {
      return false;
    }

    const wrapper = resolveChoiceWrapper(group.field, node);
    if (!wrapper) {
      return false;
    }

    if (Array.isArray(group.path) && group.path.length) {
      await openChoicePopup(wrapper, node);
      const selected = await selectCascaderPath(group.path, node);
      if (!selected) {
        return false;
      }

      const confirmed = await waitForCascaderValue(node, group.path, 1500);
      if (!confirmed) {
        return false;
      }

      const display = parsePathValue(node).join("/");
      if (!display.includes(group.path[group.path.length - 1])) {
        return false;
      }
    }

    if (group.detailField) {
      const ok = await applyField(group.detailField, document);
      if (!ok) {
        return false;
      }
    }

    return true;
  }

  async function applyField(field, scope) {
    if (field.type === "radio") {
      return findAndSelectRadio(field, scope);
    }

    const node = findField(field, scope);
    if (!node) {
      return false;
    }

    if (field.componentType === "custom-select") {
      return fillCustomSelectField(field, node);
    }

    if (field.type === "tags") {
      return fillTagsField(field, node);
    }

    if (field.type === "checkbox" && node instanceof HTMLInputElement) {
      node.checked = Boolean(field.value);
      dispatchFieldEvents(node);
      return true;
    }

    if (field.type === "select-multiple" && node instanceof HTMLSelectElement) {
      const wanted = new Set(Array.isArray(field.value) ? field.value : []);
      Array.from(node.options).forEach((option) => {
        option.selected = wanted.has(option.value) || wanted.has(option.text);
      });
      dispatchFieldEvents(node);
      return true;
    }

    if (field.componentType === "custom-date") {
      setControlValue(node, field.value);
      dispatchFieldEvents(node);
      return waitForControlValue(node, field.value, 800);
    }

    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      setControlValue(node, field.value);
      dispatchFieldEvents(node);
      return waitForControlValue(node, field.value, 800);
    }

    if (node instanceof HTMLElement && field.type === "contenteditable") {
      node.textContent = field.value == null ? "" : String(field.value);
      dispatchFieldEvents(node);
      return true;
    }

    return false;
  }

  async function fillCustomSelectField(field, node) {
    const desired = field.value == null ? "" : String(field.value).trim();
    if (!desired) {
      return true;
    }

    const wrapper = resolveChoiceWrapper(field, node);
    if (!wrapper) {
      return false;
    }

    const popupRoots = await openChoicePopup(wrapper, node);
    const option = await findPopupOptionInContext(popupRoots, desired, 1500);
    if (!option) {
      return false;
    }
    triggerChoice(option);
    const selected = await waitForSelection(node, desired, 1500);
    if (!selected) {
      return false;
    }
    await closeActivePopups();
    await waitForDomSettled(400);

    return matchesFieldValue(field, node);
  }

  async function fillTagsField(field, node) {
    if (!Array.isArray(field.value)) {
      return true;
    }

    const wrapper = resolveChoiceWrapper(field, node);
    if (!wrapper || !(node instanceof HTMLInputElement)) {
      return false;
    }

    clearTags(wrapper);
    for (const value of field.value) {
      let popupRoots = await openChoicePopup(wrapper, node);
      let option = await findPopupOptionInContext(popupRoots, String(value), 800);
      if (!option) {
        setControlValue(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(120);
        popupRoots = getActivePopupRoots();
        option = await findPopupOptionInContext(popupRoots, String(value), 1200);
      }
      if (!option) {
        return false;
      }

      triggerChoice(option);
      const selected = await waitForTagValue(wrapper, String(value), 1000);
      if (!selected) {
        return false;
      }
      await closeActivePopups();
    }

    return true;
  }

  function findField(field, scope) {
    const root = scope instanceof Element || scope instanceof Document ? scope : document;

    if (field.name) {
      const named = safeQueryWithin(root, `[name="${escapeAttribute(field.name)}"], #${escapeCss(field.name)}`);
      if (named) {
        return named;
      }
    }

    if (field.wrapperId) {
      const wrappedById = safeQueryWithin(root, `#${escapeCss(field.wrapperId)} input, #${escapeCss(field.wrapperId)} textarea, #${escapeCss(field.wrapperId)} select`);
      if (wrappedById) {
        return wrappedById;
      }
    }

    if (field.columnIndex != null && root instanceof Element) {
      const cells = Array.from(root.querySelectorAll("td"));
      const targetCell = cells[field.columnIndex];
      if (targetCell) {
        const inCell = findFieldInContainer(field, targetCell);
        if (inCell) {
          return inCell;
        }
      }
    }

    const scoped = findFieldInContainer(field, root);
    if (scoped) {
      return scoped;
    }

    if (field.selector) {
      const selectorMatch = safeQuery(field.selector);
      if (selectorMatch) {
        return selectorMatch;
      }
    }

    return null;
  }

  function findFieldInContainer(field, container) {
    if (!(container instanceof Element || container instanceof Document)) {
      return null;
    }

    if (field.wrapperSelector) {
      const wrapped = safeQueryWithin(container, `${field.wrapperSelector} input, ${field.wrapperSelector} textarea, ${field.wrapperSelector} select`);
      if (wrapped) {
        return wrapped;
      }
    }

    if (field.label) {
      const candidates = Array.from(container.querySelectorAll(FIELD_SELECTOR));
      const exact = candidates.find((node) => getLabel(node) === field.label);
      if (exact) {
        return exact;
      }
    }

    if (field.placeholder) {
      const placeholderMatch = safeQueryWithin(container, `[placeholder="${escapeAttribute(field.placeholder)}"]`);
      if (placeholderMatch) {
        return placeholderMatch;
      }
    }

    return safeQueryWithin(container, FIELD_SELECTOR);
  }

  function findAndSelectRadio(field, scope) {
    const root = scope instanceof Element || scope instanceof Document ? scope : document;
    const radios = Array.from(root.querySelectorAll('input[type="radio"]'));
    const target = radios.find((radio) => getRadioLabel(radio) === field.value || radio.value === field.value);
    if (!target) {
      return false;
    }

    target.click();
    dispatchFieldEvents(target);
    return true;
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

  function isInsideRepeatableTable(node) {
    const table = node.closest("table");
    if (!table) {
      return false;
    }

    const rows = getDataRows(table);
    return rows.some((row) => row.contains(node));
  }

  function getDataRows(table) {
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    return rows.filter((row) => {
      if (row.querySelector(".StyledResult-hdQdDC, .muya-result-content")) {
        return false;
      }
      return row.querySelector(FIELD_SELECTOR);
    });
  }

  function getTableHeaders(table) {
    return Array.from(table.querySelectorAll("thead th")).map((th) => normalizeText(th.textContent || ""));
  }

  function getGroupLabel(element) {
    const sectionTitle = element.closest("form, section, div")?.querySelector("label, .sc-cSxQHt, h2, h3");
    if (sectionTitle) {
      return normalizeText(sectionTitle.textContent || "");
    }
    return "";
  }

  function findAddRowSelector(table) {
    const candidates = Array.from(table.parentElement?.parentElement?.querySelectorAll("button") || []);
    const button = candidates.find((candidate) => /添加|新增|add/i.test(normalizeText(candidate.textContent || "")));
    return button ? buildSelector(button) : "";
  }

  function findAddRowText(table) {
    const candidates = Array.from(table.parentElement?.parentElement?.querySelectorAll("button") || []);
    const button = candidates.find((candidate) => {
      const text = normalizeText(candidate.textContent || "");
      return /add/i.test(text) || text.includes("添加") || text.includes("娣诲姞");
    });
    return button ? normalizeText(button.textContent || "") : "";
  }

  function findLinkedDetailField(node) {
    const row = node.closest(".StyledRow-ggetrT, .muya-row-wrapper");
    if (!row) {
      return null;
    }

    const inputs = Array.from(row.querySelectorAll("input:not([readonly])"));
    return inputs.find((input) => /详细地址|门牌号|小区|楼栋/.test(input.getAttribute("placeholder") || "")) || null;
  }

  function parsePathValue(node) {
    const value = getNodeDisplayValue(node);
    if (!value) {
      return [];
    }
    return value.split("/").map((part) => part.trim()).filter(Boolean);
  }

  function getNodeDisplayValue(node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      return normalizeText(node.value || "");
    }
    return normalizeText(node.textContent || "");
  }

  function getComponentInfo(node) {
    const tagsWrapper = node.closest(".muya-tags-input-input-wrapper, .muya-tags-input-wrapper, .muya-tags-input-tags-wrapper");
    const comboboxWrapper = node.closest('[role="combobox"]');
    const inputWrapper = node.closest(".muya-input-input-wrapper");
    const wrapper = tagsWrapper || comboboxWrapper || inputWrapper;
    const className = [wrapper?.className || "", node.className || ""].join(" ");
    let type = "native";

    if (tagsWrapper || String(className).includes("muya-tags-input")) {
      type = "custom-tags";
    } else if (String(className).includes("muya-cascader")) {
      type = "custom-cascader";
    } else if (String(className).includes("muya-select")) {
      type = "custom-select";
    } else if (isReadonlyNode(node) && looksLikeDateField(node)) {
      type = "custom-date";
    }

    return {
      type,
      wrapperId: wrapper?.id || "",
      wrapperSelector: wrapper ? buildSelector(wrapper) : ""
    };
  }

  function getNativeComponentInfo(node) {
    return {
      type: isReadonlyNode(node) && looksLikeDateField(node) ? "custom-date" : "native",
      wrapperId: "",
      wrapperSelector: ""
    };
  }

  function isReadonlyNode(node) {
    return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
      ? node.readOnly
      : false;
  }

  function looksLikeDateField(node) {
    const text = `${node.getAttribute("placeholder") || ""} ${getLabel(node)}`.toLowerCase();
    return text.includes("时间") || text.includes("日期") || /\d{4}-\d{2}-\d{2}/.test(getNodeDisplayValue(node));
  }

  function getTagValues(node) {
    const wrapper = node.closest(".muya-tags-input-input-wrapper, .muya-tags-input-wrapper, .muya-tags-input-tags-wrapper");
    if (!wrapper) {
      return [];
    }

    return Array.from(wrapper.querySelectorAll(".muya-tag-children-wrapper, .StyledTagText-dIUACg"))
      .map((tag) => normalizeText(tag.textContent || ""))
      .filter(Boolean);
  }

  function clearTags(wrapper) {
    const closeButtons = Array.from(wrapper.querySelectorAll(".muya-tag-close-icon, .StyledCloseIcon-hbRQlO"));
    closeButtons.forEach((button) => {
      if (button instanceof HTMLElement) {
        triggerChoice(button);
      }
    });
  }

  async function waitForTagValue(wrapper, value, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const values = Array.from(wrapper.querySelectorAll(".muya-tag-children-wrapper, .StyledTagText-dIUACg"))
        .map((tag) => normalizeText(tag.textContent || ""));
      if (values.includes(value)) {
        return true;
      }
      await wait(80);
    }
    return false;
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

    return node.closest(".muya-tags-input-input-wrapper, [role='combobox'], .muya-input-input-wrapper");
  }

  function openChoiceWrapper(wrapper, node) {
    const target = wrapper.querySelector("button, input, [role='button']") || node || wrapper;
    triggerChoice(target);
    if (target instanceof HTMLElement) {
      target.focus();
    }
  }

  async function openChoicePopup(wrapper, node) {
    await closeActivePopups();
    const before = getActivePopupRoots();
    openChoiceWrapper(wrapper, node);
    const roots = await waitForPopupRoots(before, 1200);
    return prioritizePopupRoots(roots, wrapper, node);
  }

  async function findPopupOption(text, timeoutMs) {
    const wanted = normalizeText(text);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const option = getVisiblePopupCandidates().find((node) => normalizeText(node.textContent || "") === wanted);
      if (option) {
        return option;
      }
      await wait(80);
    }

    return null;
  }

  async function findPopupOptionInContext(contextRoots, text, timeoutMs) {
    const wanted = normalizeText(text);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const roots = contextRoots?.length ? contextRoots : getActivePopupRoots();
      const option = findBestOptionInRoots(roots, wanted);
      if (option) {
        return option;
      }
      await wait(80);
    }

    return null;
  }

  function findBestOptionInRoots(roots, wanted) {
    const pool = [];
    for (const root of roots) {
      const candidates = Array.from(root.querySelectorAll("[role='option'], [role='treeitem'], li, button, div, span"));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) {
          continue;
        }
        if (!isVisible(candidate)) {
          continue;
        }
        if (normalizeText(candidate.textContent || "") !== wanted) {
          continue;
        }
        pool.push(candidate);
      }
    }

    pool.sort((a, b) => getElementDepth(b) - getElementDepth(a));
    return pool[0] || null;
  }

  function getVisiblePopupCandidates() {
    const selectors = [
      "[role='option']",
      "[role='treeitem']",
      "[role='menuitem']",
      ".muya-menu-item",
      ".muya-cascader-menu-item",
      ".muya-select-option",
      ".muya-popper *",
      ".muya-dropdown *",
      "li",
      "button",
      "div"
    ];

    return Array.from(document.querySelectorAll(selectors.join(", "))).filter((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const text = normalizeText(node.textContent || "");
      return Boolean(text) && isVisible(node);
    });
  }

  function getActivePopupRoots() {
    const selectors = [
      ".muya-cascader-menu",
      ".muya-select-menu",
      ".muya-light-select-menu",
      ".muya-menu",
      ".muya-popover",
      ".muya-popper",
      ".StyledBaseMenu-gFFcFt",
      ".StyledPopper-ibAbQz",
      "[role='listbox']",
      "[role='tree']",
      "[role='menu']"
    ];

    const explicitRoots = Array.from(document.querySelectorAll(selectors.join(", "))).filter((node) => {
      return node instanceof HTMLElement && isVisible(node);
    });
    if (explicitRoots.length) {
      return explicitRoots;
    }

    return Array.from(document.querySelectorAll("body > div, body > ul")).filter((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        return false;
      }
      return /muya|menu|cascader|dropdown|popover/i.test(String(node.className || ""));
    });
  }

  async function waitForPopupRoots(previousRoots, timeoutMs) {
    const previousSet = new Set(previousRoots);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const current = getActivePopupRoots();
      const fresh = current.filter((root) => !previousSet.has(root));
      if (fresh.length) {
        return fresh;
      }
      if (current.length) {
        return current;
      }
      await wait(80);
    }

    return getActivePopupRoots();
  }

  function prioritizePopupRoots(roots, wrapper, node) {
    const anchor = wrapper instanceof HTMLElement ? wrapper : node;
    if (!(anchor instanceof HTMLElement) || !roots.length) {
      return roots;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const scored = roots
      .filter((root) => root instanceof HTMLElement)
      .map((root) => ({
        root,
        score: getPopupDistance(anchorRect, root.getBoundingClientRect())
      }))
      .sort((a, b) => a.score - b.score);

    return scored.map((item) => item.root);
  }

  async function waitForRowCount(table, minCount, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (getDataRows(table).length >= minCount) {
        return true;
      }
      await wait(100);
    }
    return false;
  }

  function triggerChoice(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    const eventInit = { bubbles: true, cancelable: true, composed: true, view: window };
    node.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mousedown", { ...eventInit, button: 0 }));
    node.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mouseup", { ...eventInit, button: 0 }));
    node.click();
  }

  async function nativeClick(node) {
    const point = getElementCenter(node);
    if (!point) {
      triggerChoice(node);
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: "fxNativeClick", ...point });
      if (response?.ok) {
        return true;
      }
    } catch (_error) {
      // The standard DOM event path remains available when debugger access is unavailable.
    }
    triggerChoice(node);
    return false;
  }

  async function nativeReplaceText(node, value, options = {}) {
    const point = getElementCenter(node);
    if (!point) {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "fxNativeReplaceText",
        ...point,
        text: value == null ? "" : String(value),
        commit: options.commit !== false
      });
      return response?.ok === true;
    } catch (_error) {
      return false;
    }
  }

  async function nativeTypeText(value) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "fxNativeTypeText",
        text: value == null ? "" : String(value)
      });
      return response?.ok === true;
    } catch (_error) {
      return false;
    }
  }

  function getElementCenter(node) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  function findRepeatableTable(group) {
    if (group.tableSelector) {
      const direct = safeQuery(group.tableSelector);
      if (direct) {
        return direct;
      }
    }

    const expectedHeaders = Array.isArray(group.headers) ? group.headers.filter(Boolean) : [];
    const wantedLabel = normalizeText(group.label || "");

    for (const table of Array.from(document.querySelectorAll("table"))) {
      const headers = getTableHeaders(table).filter(Boolean);
      if (expectedHeaders.length && headers.join("|") !== expectedHeaders.join("|")) {
        continue;
      }
      if (!wantedLabel) {
        return table;
      }
      const label = normalizeText(getGroupLabel(table) || "");
      if (label.includes(wantedLabel)) {
        return table;
      }
    }

    return null;
  }

  function findAddRowButton(group, table) {
    if (group.addRowSelector) {
      const direct = safeQuery(group.addRowSelector);
      if (direct) {
        return direct;
      }
    }

    const wantedText = normalizeText(group.addRowText || "");
    for (const scope of getAncestorScopes(table, 7)) {
      const buttons = Array.from(scope.querySelectorAll("button"));
      if (wantedText) {
        const exact = buttons.find((button) => normalizeText(button.textContent || "") === wantedText);
        if (exact) {
          return exact;
        }
      }

      const fallback = buttons.find((button) => {
        const text = normalizeText(button.textContent || "");
        return /add/i.test(text) || text.includes("添加") || text.includes("娣诲姞");
      });
      if (fallback) {
        return fallback;
      }
    }

    return null;
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function getPopupDistance(anchorRect, popupRect) {
    const dx = Math.abs(anchorRect.left - popupRect.left);
    const dy = popupRect.top >= anchorRect.bottom
      ? popupRect.top - anchorRect.bottom
      : Math.abs(anchorRect.top - popupRect.top);
    return dx + (dy * 2);
  }

  async function waitForSelection(node, desired, timeoutMs) {
    const startedAt = Date.now();
    const wanted = normalizeText(String(desired));
    while (Date.now() - startedAt < timeoutMs) {
      if (readChoiceValue(node) === wanted) {
        return true;
      }
      await wait(80);
    }
    return false;
  }

  async function waitForDomSettled(idleMs) {
    return new Promise((resolve) => {
      let timer = window.setTimeout(done, idleMs);
      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(done, idleMs);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      function done() {
        observer.disconnect();
        resolve();
      }
    });
  }

  async function closeActivePopups() {
    const activeRoots = getActivePopupRoots();
    if (!activeRoots.length) {
      return;
    }

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    document.body?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    document.body?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    document.body?.click();
    await wait(80);
  }

  function isStructuralField(field) {
    const wrapperId = String(field.wrapperId || "");
    const label = getFieldTitle(field);
    return wrapperId.startsWith("customerTransitionType_")
      || label.includes("客户交接类型")
      || label === "新开"
      || label.includes("开户/生效");
  }

  function getElementDepth(node) {
    let depth = 0;
    let current = node;
    while (current.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function getAncestorScopes(node, maxDepth) {
    const scopes = [];
    let current = node.parentElement;
    let depth = 0;
    while (current && depth < maxDepth) {
      scopes.push(current);
      current = current.parentElement;
      depth += 1;
    }
    return scopes;
  }

  async function selectCascaderPath(path, node) {
    for (let index = 0; index < path.length; index += 1) {
      const targetText = normalizeText(path[index]);
      const menus = getVisibleCascaderMenus();
      const menu = menus[Math.min(index, menus.length - 1)];
      if (!menu) {
        return false;
      }

      const item = findCascaderItem(menu, targetText);
      if (!item) {
        return false;
      }

      const isLast = index === path.length - 1;
      if (!isLast) {
        const expanded = await expandCascaderBranch(item, index + 2);
        if (!expanded) {
          return false;
        }
        continue;
      }

      triggerChoice(item);
      const leafSelected = await waitForCascaderValue(node, path.slice(0, index + 1), 1200);
      if (!leafSelected) {
        await wait(180);
      }
    }

    return true;
  }

  function getVisibleCascaderMenus(popupRoots = getActivePopupRoots()) {
    const menus = [];
    for (const root of popupRoots) {
      const found = Array.from(root.querySelectorAll(".muya-cascader-menu"));
      for (const menu of found) {
        if (menu instanceof HTMLElement && isVisible(menu)) {
          menus.push(menu);
        }
      }
    }

    return menus.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }

  function findCascaderItem(menu, wanted) {
    const items = Array.from(menu.querySelectorAll(".muya-cascader-menu-item, [role='menuitem']"));
    return items.find((item) => {
      if (!(item instanceof HTMLElement) || !isVisible(item)) {
        return false;
      }
      const textNode = item.querySelector(".Paragraph-dEBTKe, .StyledCascaderMenuItemContent-kvmnew, span, div");
      const text = normalizeText(textNode?.textContent || item.textContent || "");
      return text === wanted;
    }) || null;
  }

  async function waitForCascaderMenuCount(minCount, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (getVisibleCascaderMenus().length >= minCount) {
        return true;
      }
      await wait(80);
    }
    return false;
  }

  async function expandCascaderBranch(item, minMenuCount) {
    revealCascaderBranch(item);
    if (await waitForCascaderMenuCount(minMenuCount, 500)) {
      return true;
    }

    const button = item.querySelector("button");
    if (button instanceof HTMLElement) {
      triggerChoice(button);
      if (await waitForCascaderMenuCount(minMenuCount, 500)) {
        return true;
      }
    }

    triggerChoice(item);
    return waitForCascaderMenuCount(minMenuCount, 700);
  }

  function revealCascaderBranch(item) {
    if (!(item instanceof HTMLElement)) {
      return;
    }

    const init = { bubbles: true, cancelable: true, composed: true, view: window };
    item.dispatchEvent(new PointerEvent("pointerenter", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    item.dispatchEvent(new MouseEvent("mouseenter", init));
    item.dispatchEvent(new PointerEvent("pointermove", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    item.dispatchEvent(new MouseEvent("mousemove", init));
    item.dispatchEvent(new PointerEvent("pointerover", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    item.dispatchEvent(new MouseEvent("mouseover", init));

    const button = item.querySelector("button");
    if (button instanceof HTMLElement) {
      button.focus();
    }
  }

  async function waitForCascaderValue(node, path, timeoutMs) {
    const wantedSegments = Array.isArray(path) ? path.map((part) => normalizeText(String(part))) : [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = parsePathValue(node);
      const matches = wantedSegments.every((segment, index) => current[index] === segment);
      if (matches && current.length >= wantedSegments.length) {
        return true;
      }
      await wait(80);
    }
    return false;
  }

  async function waitForControlValue(node, value, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (matchesFieldValue({ type: node instanceof HTMLInputElement ? node.type : "text", value }, node)) {
        return true;
      }
      await wait(60);
    }
    return false;
  }

  function dispatchFieldEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function ensureFieldValue(field, scope, attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const node = findField(field, scope);
      if (node && matchesFieldValue(field, node)) {
        return true;
      }

      const ok = await applyField(field, scope);
      if (!ok) {
        continue;
      }

      const refreshed = findField(field, scope);
      if (refreshed && matchesFieldValue(field, refreshed)) {
        return true;
      }

      await waitForDomSettled(250);
    }

    const finalNode = findField(field, scope);
    return Boolean(finalNode && matchesFieldValue(field, finalNode));
  }

  function matchesFieldValue(field, node) {
    if (field.type === "radio" && node instanceof HTMLInputElement) {
      return node.checked && (getRadioLabel(node) === field.value || node.value === field.value);
    }

    if (field.type === "checkbox" && node instanceof HTMLInputElement) {
      return node.checked === Boolean(field.value);
    }

    if (field.type === "tags") {
      const actualTags = getTagValues(node);
      const expectedTags = Array.isArray(field.value) ? field.value.map((value) => normalizeText(String(value))) : [];
      return expectedTags.every((value) => actualTags.includes(value));
    }

    if (field.componentType === "custom-select") {
      return readChoiceValue(node) === normalizeText(String(field.value ?? ""));
    }

    if (field.componentType === "custom-cascader") {
      const actualPath = parsePathValue(node);
      const expectedPath = Array.isArray(field.path) ? field.path.map((part) => normalizeText(String(part))) : [];
      return expectedPath.every((part, index) => actualPath[index] === part);
    }

    const expected = normalizeText(String(field.value ?? ""));
    const actual = normalizeText(getNodeDisplayValue(node));
    return actual === expected;
  }

  function readChoiceValue(node) {
    const value = normalizeText(getNodeDisplayValue(node));
    if (value) {
      return value;
    }
    if (node instanceof HTMLInputElement) {
      return normalizeText(node.getAttribute("title") || node.getAttribute("placeholder") || "");
    }
    return "";
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

  function orderFieldsForFill(fields) {
    return [...fields].sort((left, right) => getFieldOrderWeight(left) - getFieldOrderWeight(right));
  }

  function orderFieldsForVerification(fields) {
    return [...fields].sort((left, right) => getFieldVerificationWeight(left) - getFieldVerificationWeight(right));
  }

  function getFieldOrderWeight(field) {
    if (field.type === "tags") {
      return 1;
    }
    if (field.componentType === "custom-select") {
      return 3;
    }
    return 2;
  }

  function getFieldVerificationWeight(field) {
    if (field.componentType === "custom-select") {
      return 1;
    }
    if (field.type === "tags") {
      return 2;
    }
    return 3;
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

    const cell = node.closest("td, th");
    if (cell) {
      const header = cell.parentElement?.parentElement?.parentElement?.querySelectorAll("thead th");
      if (header?.length) {
        const index = getCellIndex(cell);
        const matchingHeader = header[index];
        if (matchingHeader) {
          return normalizeText(matchingHeader.textContent || "");
        }
      }
    }

    const previous = node.previousElementSibling;
    if (previous) {
      return normalizeText(previous.textContent || "");
    }

    return "";
  }

  function getRadioGroupInfo(node) {
    const scope = node.closest(FIELD_CONTAINER_SELECTOR) || document;
    const nodes = Array.from(scope.querySelectorAll('input[type="radio"]'));
    return {
      groupKey: node.name || buildSelector(scope instanceof Element ? scope : node),
      nodes
    };
  }

  function getRadioLabel(node) {
    const label = node.closest("label");
    return label ? normalizeText(label.innerText) : node.value || "";
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

    return parts.join(" | ");
  }

  function getSelectOptions(node) {
    return Array.from(node.options).map((option) => ({
      value: option.value,
      text: normalizeText(option.textContent || ""),
      selected: option.selected
    }));
  }

  function getFieldTitle(field) {
    return field.label || field.name || field.placeholder || field.selector || "field";
  }

  function flattenTemplate(template) {
    const fields = [...(template.simpleFields || [])];

    for (const group of template.groups || []) {
      if (group.kind === "repeatable-table") {
        group.rows.forEach((row) => row.fields.forEach((field) => fields.push(field)));
        continue;
      }

      if (group.field) {
        fields.push(group.field);
      }

      if (group.detailField) {
        fields.push(group.detailField);
      }
    }

    return fields;
  }

  function collectFxiaokeDiagnostics(template) {
    const fields = flattenTemplate(template);
    const components = fields.reduce((summary, field) => {
      const key = field.componentType || "native";
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});

    const clickableCandidates = Array.from(document.querySelectorAll("button, [role='button'], [role='option'], [role='menuitem'], a"))
      .filter((node) => node instanceof HTMLElement && isVisible(node))
      .slice(0, 80)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute("role") || "",
        text: normalizeText(node.textContent || "").slice(0, 80),
        selector: buildSelector(node)
      }));

    const wrappers = fields
      .filter((field) => field.wrapperId || field.wrapperSelector || field.fxiaokeApiName)
      .slice(0, 80)
      .map((field) => ({
        label: getFieldTitle(field),
        componentType: field.componentType,
        fxiaokeApiName: field.fxiaokeApiName || "",
        wrapperId: field.wrapperId,
        wrapperSelector: field.wrapperSelector
      }));

    return {
      purpose: "fxiaoke-adapter-bootstrap",
      note: "First-stage diagnostics only. Use these candidates with a real Fxiaoke snapshot to add precise adapter rules.",
      fieldCount: fields.length,
      groupCount: Array.isArray(template.groups) ? template.groups.length : 0,
      components,
      wrappers,
      clickableCandidates
    };
  }

  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function safeQueryWithin(root, selector) {
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
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

  function getCellIndex(cell) {
    let index = 0;
    let sibling = cell.previousElementSibling;
    while (sibling) {
      index += 1;
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

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
})();
