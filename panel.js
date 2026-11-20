const frame = document.getElementById("gpt");
const toastEl = document.getElementById("toast");
let toastTimer;

function focusFrame() {
  try { window.focus(); frame.focus(); } catch (e) {}
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 7000);
}
toastEl.addEventListener("click", () => (toastEl.hidden = true));

frame.addEventListener("load", focusFrame);
document.getElementById("newChat").onclick = () => (frame.src = "https://chatgpt.com/");
document.getElementById("reload").onclick = () => (frame.src = frame.src);
document.getElementById("settings").onclick = () => chrome.runtime.openOptionsPage();

chrome.commands.getAll((cmds) => {
  const key = (name) => (cmds.find((c) => c.name === name) || {}).shortcut || "not set";
  document.getElementById("hint").textContent =
    `${key("quick-ask")} ask · ${key("prompt-history")} pick prompt`;
});

function onJob(job) {
  if (!job) return;
  if (job.error) {
    showToast(job.error);
    chrome.storage.session.remove("job");
  } else {
    // The content script inside the ChatGPT frame does the actual work; we just make
    // sure keyboard focus lands in the panel so the input box is ready to type in.
    focusFrame();
  }
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.job && changes.job.newValue) onJob(changes.job.newValue);
});
chrome.storage.session.get("job").then((r) => onJob(r.job));
