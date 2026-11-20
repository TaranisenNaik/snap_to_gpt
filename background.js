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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "quick-ask" && command !== "prompt-history") return;
  if (!tab) return;
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
