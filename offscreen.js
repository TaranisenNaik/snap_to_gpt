// Reads/writes the clipboard for the background worker (used by the "send selection" shortcut).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;
  const ta = document.getElementById("ta");
  if (msg.type === "write") {
    ta.value = msg.text || "";
    ta.select();
    sendResponse(document.execCommand("copy"));
  } else if (msg.type === "read") {
    ta.value = "";
    ta.focus();
    document.execCommand("paste");
    sendResponse(ta.value);
  }
});
