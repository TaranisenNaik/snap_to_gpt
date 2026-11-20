const $ = (id) => document.getElementById(id);
const KEY = SNAP_HISTORY_KEY;

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  const s = { ...SNAP_DEFAULTS, ...(settings || {}) };
  $("defaultPrompt").value = s.defaultPrompt;
  $("newChat").checked = !!s.newChat;
}

$("save").onclick = async () => {
  const settings = {
    defaultPrompt: $("defaultPrompt").value.trim() || SNAP_DEFAULTS.defaultPrompt,
    autoSend: true,
    v: 2,
    newChat: $("newChat").checked
  };
  await chrome.storage.sync.set({ settings });
  $("defaultPrompt").value = settings.defaultPrompt;
  $("savedMsg").classList.add("show");
  setTimeout(() => $("savedMsg").classList.remove("show"), 1500);
};

function loadShortcuts() {
  const labels = {
    "quick-ask": "Ask — screenshot + default prompt",
    "prompt-history": "Pick prompt — screenshot + choose from history (↑/↓)"
  };
  chrome.commands.getAll((cmds) => {
    const t = $("shortcuts");
    t.innerHTML = "";
    cmds.filter((c) => labels[c.name]).forEach((c) => {
      const tr = t.insertRow();
      tr.insertCell().textContent = labels[c.name];
      const k = tr.insertCell();
      k.style.textAlign = "right";
      k.innerHTML = c.shortcut ? `<kbd></kbd>` : `<span class="muted">not set</span>`;
      if (c.shortcut) k.firstChild.textContent = c.shortcut;
    });
  });
}
$("changeKeys").onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });

async function getHistory() {
  const r = await chrome.storage.local.get(KEY);
  return Array.isArray(r[KEY]) ? r[KEY] : [];
}
async function setHistory(h) {
  await chrome.storage.local.set({ [KEY]: h.slice(-SNAP_MAX_HISTORY) });
}

async function renderHistory() {
  const h = await getHistory();
  const ol = $("history");
  ol.innerHTML = "";
  if (!h.length) {
    ol.innerHTML = `<li class="muted">No prompts yet.</li>`;
    return;
  }
  h.forEach((text, i) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = text;
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Delete";
    del.onclick = async () => {
      const cur = await getHistory();
      cur.splice(i, 1);
      await setHistory(cur);
    };
    li.append(span, del);
    ol.appendChild(li);
  });
  ol.scrollTop = ol.scrollHeight;
}

async function addPrompt() {
  const text = $("newPrompt").value.trim();
  if (!text) return;
  const h = (await getHistory()).filter((x) => x !== text);
  h.push(text);
  await setHistory(h);
  $("newPrompt").value = "";
}
$("add").onclick = addPrompt;
$("newPrompt").addEventListener("keydown", (e) => { if (e.key === "Enter") addPrompt(); });
$("clear").onclick = async () => {
  if (confirm("Delete all saved prompts?")) await setHistory([]);
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY]) renderHistory();
});

loadSettings();
loadShortcuts();
renderHistory();
