importScripts("defaults.js");

const RULE_TAB_NONE = 1001;
const RULE_INITIATOR = 1002;

// ChatGPT normally refuses to be shown inside a frame (X-Frame-Options / CSP frame-ancestors).
// These session rules strip those headers ONLY for frames that are not inside a normal tab
// (i.e. our side panel), so chatgpt.com tabs keep their normal protection.
async function setup() {
  try {
    // Lets the content script inside the ChatGPT frame read the pending screenshot job.
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  } catch (e) { console.warn("setAccessLevel", e); }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) { console.warn("setPanelBehavior", e); }

  const removeHeaders = {
    type: "modifyHeaders",
    responseHeaders: [
      { header: "x-frame-options", operation: "remove" },
      { header: "content-security-policy", operation: "remove" },
      { header: "content-security-policy-report-only", operation: "remove" }
    ]
  };
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_TAB_NONE, RULE_INITIATOR],
      addRules: [
        {
          id: RULE_TAB_NONE,
          priority: 1,
          action: removeHeaders,
          condition: {
            requestDomains: ["chatgpt.com", "openai.com"],
            resourceTypes: ["sub_frame"],
            tabIds: [chrome.tabs.TAB_ID_NONE]
          }
        },
        {
          id: RULE_INITIATOR,
          priority: 1,
          action: removeHeaders,
          condition: {
            requestDomains: ["chatgpt.com", "openai.com"],
            resourceTypes: ["sub_frame"],
            initiatorDomains: [chrome.runtime.id]
          }
        }
      ]
    });
  } catch (e) { console.error("DNR rules", e); }
}

setup();
chrome.runtime.onStartup.addListener(setup);
chrome.runtime.onInstalled.addListener(async (details) => {
  await setup();
  if (details.reason === "install") {
    const { settings } = await chrome.storage.sync.get("settings");
    if (!settings) await chrome.storage.sync.set({ settings: { ...SNAP_DEFAULTS } });
    chrome.runtime.openOptionsPage();
  } else if (details.reason === "update") {
    // One-time change: "new chat for every screenshot" is now OFF by default.
    const { settings } = await chrome.storage.sync.get("settings");
    if (settings && (settings.v || 1) < 2) {
      await chrome.storage.sync.set({ settings: { ...settings, newChat: false, v: 2 } });
    }
  }
});

// Reads the selected text in the page (including inside text boxes and editors).
function readSelection() {
  const el = document.activeElement;
  if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|url|email|tel|)$/i.test(el.type || "")))) {
    try {
      const t = el.value.substring(el.selectionStart || 0, el.selectionEnd || 0);
      if (t.trim()) return t;
    } catch (e) {}
  }
  const sel = window.getSelection ? window.getSelection() : null;
  return sel ? sel.toString() : "";
}

// Asks the page itself to copy the selection (works in editors such as Google Docs
// that don't use normal page text).
function copySelection() {
  try { return document.execCommand("copy"); } catch (e) { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstText = (results) =>
  ((results || []).map((r) => (r && r.result) || "").find((t) => String(t).trim()) || "").trim();

async function inject(tabId, func, allFrames) {
  return chrome.scripting.executeScript({ target: allFrames ? { tabId, allFrames: true } : { tabId }, func });
}

// Offscreen document used to read/write the clipboard (service workers can't).
async function ensureOffscreen() {
  try {
    const existing = chrome.runtime.getContexts
      ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
      : [];
    if (existing.length) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Read the text the user selected and copied from the page"
    });
  } catch (e) {
    if (!/single offscreen/i.test(String(e && e.message))) throw e;
  }
}
const clip = (type, text) => chrome.runtime.sendMessage({ target: "offscreen", type, text });

async function getSelectedText(tab) {
  const errors = [];

  // 1) Main page.
  try {
    const t = firstText(await inject(tab.id, readSelection, false));
    if (t) return { text: t };
  } catch (e) { errors.push(e.message || String(e)); }

  // 2) All frames (selection inside an embedded frame).
  try {
    const t = firstText(await inject(tab.id, readSelection, true));
    if (t) return { text: t };
  } catch (e) { errors.push(e.message || String(e)); }

  // 3) Copy fallback for special editors (Google Docs etc.).
  try {
    await ensureOffscreen();
    const marker = "__snap_to_chatgpt_" + Date.now();
    await clip("write", marker);
    try { await inject(tab.id, copySelection, true); } catch (e) { await inject(tab.id, copySelection, false); }
    await sleep(150);
    const t = String((await clip("read")) || "").trim();
    if (t && t !== marker) return { text: t };
  } catch (e) { errors.push(e.message || String(e)); }

  return { errors };
}

// Presses Ctrl+C (Cmd+C on Mac) in the tab, like you would yourself. Used for PDFs,
// because Chrome's PDF viewer only accepts real key presses. Chrome shows a short
// "started debugging this browser" bar while this runs; it detaches right away.
async function pressCopyInTab(tabId) {
  const target = { tabId };
  const isMac = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
  const key = { modifiers: isMac ? 4 : 2, key: "c", code: "KeyC", windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...key, commands: ["copy"] });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await sleep(250);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

// Copies the selection with a real Ctrl+C and reads it from the clipboard.
// Your previous clipboard is put back if nothing was selected.
async function copyWithKeyPress(tab) {
  await ensureOffscreen();
  const previous = String((await clip("read")) || "");
  const marker = "__snap_to_chatgpt_" + Date.now();
  await clip("write", marker);
  try {
    await pressCopyInTab(tab.id);
  } catch (e) {
    if (previous) await clip("write", previous);
    throw e;
  }
  const t = String((await clip("read")) || "").trim();
  if (t && t !== marker) return t;
  if (previous) await clip("write", previous);
  return "";
}

async function isPdfTab(tab) {
  if (/\.pdf($|[?#])/i.test(tab.url || "")) return true;
  try {
    const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.contentType });
    return r && r[0] && r[0].result === "application/pdf";
  } catch (e) {
    return false;
  }
}

async function sendSelection(tab) {
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  // Open the panel first, while we still have the shortcut's user gesture.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.warn("sidePanel.open", e));

  let text = "", errors = [], error = "";

  if (await isPdfTab(tab)) {
    // Chrome's PDF viewer only reacts to real key presses, so the extension presses
    // Ctrl+C for you and takes the text from the clipboard.
    try {
      text = await copyWithKeyPress(tab);
    } catch (e) { errors.push(e.message || String(e)); }
    if (!text) {
      error = errors.length
        ? "Couldn't copy from the PDF (" + errors[0] + "). Press Ctrl+C yourself, then the shortcut."
        : "No text selected in the PDF. Select some text, then press the shortcut.";
    }
  } else {
    ({ text = "", errors = [] } = await getSelectedText(tab));
    if (!text && !/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || "")) {
      try { text = await copyWithKeyPress(tab); } catch (e) { errors.push(e.message || String(e)); }
    }
    if (!text) {
      const url = tab.url || "";
      if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(url) || /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(url)) {
        error = "Chrome doesn't let extensions read text on this page (" + url.split("/")[0] + "//…). Try it on a normal web page.";
      } else if (errors.length) {
        error = "Couldn't read the selected text: " + errors[0];
      } else {
        error = "No text selected. Select some text on the page first, then press the shortcut.";
      }
    }
  }
  if (!text) console.warn("[Snap to ChatGPT] selection failed", tab.url, errors);

  await chrome.storage.session.set({
    job: text ? { id, mode: "text", text, ts: Date.now() } : { id, mode: "text", ts: Date.now(), error }
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;
  if (command === "send-selection") { sendSelection(tab); return; }
  if (command !== "quick-ask" && command !== "prompt-history") return;
  const mode = command === "quick-ask" ? "auto" : "pick";
  const windowId = tab.windowId;
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());

  // Both calls start in the same tick: the capture is requested first so the page is
  // photographed before the panel opens, and sidePanel.open() still has the shortcut's
  // user gesture. captureVisibleTab only ever captures the tab's content area, so the
  // side panel (if already open) is never part of the screenshot.
  const capture = chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  chrome.sidePanel.open({ windowId }).catch((e) => console.warn("sidePanel.open", e));

  capture
    .then((image) => chrome.storage.session.set({ job: { id, mode, image, ts: Date.now() } }))
    .catch((err) =>
      chrome.storage.session.set({
        job: {
          id,
          mode,
          ts: Date.now(),
          error:
            "Couldn't capture this page (" + (err && err.message ? err.message : err) +
            "). Chrome doesn't allow screenshots of chrome:// pages, the Web Store or other extension pages."
        }
      })
    );
});
