// Shared defaults (loaded by the background worker, content script and options page).
self.SNAP_DEFAULTS = {
  defaultPrompt:
    "Explain what's on this screen. If there is an error or a problem, tell me what's causing it and how to fix it.",
  autoSend: true, // Feature 1: send automatically after the screenshot is attached
  newChat: false, // Start a fresh ChatGPT conversation for every screenshot (off by default)
  v: 2            // settings version
};
self.SNAP_HISTORY_KEY = "promptHistory";
self.SNAP_MAX_HISTORY = 100;
