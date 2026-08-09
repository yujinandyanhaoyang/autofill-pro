chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith("fxNative") || !sender.tab?.id) {
    return false;
  }

  runNativeInteraction(sender.tab.id, message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function runNativeInteraction(tabId, message) {
  await debuggerCommand(tabId, "attach");
  try {
    if (message.type === "fxNativeClick") {
      await sendMouseClick(tabId, message.x, message.y);
      return;
    }

    if (message.type === "fxNativeReplaceText") {
      await sendMouseClick(tabId, message.x, message.y);
      await replaceFocusedText(tabId, message.text);
      return;
    }

    if (message.type === "fxNativeTypeText") {
      await replaceFocusedText(tabId, message.text);
      return;
    }

    throw new Error("Unsupported native interaction.");
  } finally {
    await debuggerCommand(tabId, "detach");
  }
}

async function replaceFocusedText(tabId, text) {
  await sendKey(tabId, "rawKeyDown", "a", "KeyA", 2);
  await sendKey(tabId, "keyUp", "a", "KeyA", 2);
  await sendKey(tabId, "rawKeyDown", "Backspace", "Backspace");
  await sendKey(tabId, "keyUp", "Backspace", "Backspace");
  await debuggerCommand(tabId, "Input.insertText", { text: String(text || "") });
  await sendKey(tabId, "rawKeyDown", "Tab", "Tab");
  await sendKey(tabId, "keyUp", "Tab", "Tab");
}

function debuggerCommand(tabId, method, params) {
  if (method === "attach") {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  if (method === "detach") {
    return new Promise((resolve, reject) => {
      chrome.debugger.detach({ tabId }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

async function sendMouseClick(tabId, x, y) {
  await debuggerCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await debuggerCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
}

function sendKey(tabId, type, key, code, modifiers = 0) {
  return debuggerCommand(tabId, "Input.dispatchKeyEvent", { type, key, code, modifiers });
}
