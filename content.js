// Runs inside chatgpt.com, but only does anything when ChatGPT is loaded inside
// this extension's side panel (not in your normal ChatGPT tabs).
(() => {
  const EXT_ORIGIN = "chrome-extension://" + chrome.runtime.id;
  const parentOrigin = location.ancestorOrigins && location.ancestorOrigins[0];
  if (window.top === window || parentOrigin !== EXT_ORIGIN) return;

  const DEFAULTS = self.SNAP_DEFAULTS;
  const HISTORY_KEY = self.SNAP_HISTORY_KEY;
  const MAX_HISTORY = self.SNAP_MAX_HISTORY;

  let busy = false;
  let navigating = false;

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 20000, interval = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }
  const visible = (el) => el && el.getClientRects().length > 0;

  function getEditor() {
    const candidates = [
      ...document.querySelectorAll('#prompt-textarea[contenteditable="true"]'),
      ...document.querySelectorAll("#prompt-textarea"),
      ...document.querySelectorAll('form [contenteditable="true"]'),
      ...document.querySelectorAll("form textarea")
    ];
    return candidates.find(visible) || null;
  }
  const getComposer = (ed) => (ed && (ed.closest("form") || ed.parentElement)) || null;
  const SEND_SELECTORS = [
    '[data-testid="send-button"]',
    "#composer-submit-button",
    'button[aria-label*="Send" i]',
    'form button[type="submit"]'
  ];
  const getSendButton = () => {
    for (const s of SEND_SELECTORS) {
      const b = document.querySelector(s);
      if (b) return b;
    }
    return null;
  };
  const isTextarea = (el) => el && el.tagName === "TEXTAREA";
  const getText = (ed) =>
    !ed ? "" : (isTextarea(ed) ? ed.value : ed.innerText).replace(/​/g, "").trim();

  function setText(ed, text) {
    if (!ed) return;
    ed.focus();
    if (isTextarea(ed)) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(ed, text);
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
    if (!text) {
      document.execCommand("delete", false);
      return;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) document.execCommand("insertParagraph", false);
      if (line) document.execCommand("insertText", false, line);
    });
  }

  function dataUrlToFile(dataUrl, name) {
    const [meta, b64] = dataUrl.split(",");
    const mime = (meta.match(/data:(.*?);/) || [])[1] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  }

  function attachmentCount() {
    const comp = getComposer(getEditor());
    if (!comp) return 0;
    return comp.querySelectorAll('img, [data-testid*="attachment"], button[aria-label*="Remove"]').length;
  }

  async function attachImage(file) {
    const ed = getEditor();
    const before = attachmentCount();
    const attached = () => attachmentCount() > before;

    // 1) Paste — the same thing ChatGPT does when you press Ctrl+V with an image.
    ed.focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    if (await waitFor(attached, 3000)) return true;

    // 2) Fallback: ChatGPT's hidden file input.
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const input = inputs.find((i) => !i.accept || /image|\*/.test(i.accept)) || inputs[0];
    if (input) {
      const dt2 = new DataTransfer();
      dt2.items.add(file);
      input.files = dt2.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (await waitFor(attached, 3000)) return true;
    }

    // 3) Fallback: drag & drop onto the composer.
    const target = getComposer(ed) || ed;
    const dt3 = new DataTransfer();
    dt3.items.add(file);
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt3, bubbles: true, cancelable: true }));
    }
    return !!(await waitFor(attached, 3000));
  }

  // Sends the message automatically: keeps trying (click Send, press Enter, submit
  // the form) until ChatGPT has actually sent it, while the image is still uploading.
  async function sendWhenReady(timeout = 45000) {
    await sleep(500);
    // "Sent" = ChatGPT shows its Stop button, or the box is cleared
    // (text gone, or for an image-only message, the attachment gone).
    const hadText = getText(getEditor()) !== "";
    const startAttachments = attachmentCount();
    const isSent = () =>
      !!document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i]') ||
      (hadText ? getText(getEditor()) === "" : attachmentCount() < startAttachments);
    const t0 = Date.now();
    let attempt = 0;
    while (Date.now() - t0 < timeout) {
      if (isSent()) return true;
      const b = getSendButton();
      const enabled = b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
      if (enabled) {
        attempt++;
        if (attempt % 3 === 1) b.click();
        else if (attempt % 3 === 2) pressEnter();
        else {
          const form = b.closest("form");
          if (form && form.requestSubmit) form.requestSubmit(b.type === "submit" ? b : undefined);
        }
        // Give ChatGPT a moment to react before trying the next way.
        if (await waitFor(isSent, 1500, 100)) return true;
      } else {
        await sleep(300); // upload still running → button disabled
      }
    }
    pressEnter(); // final attempt
    if (await waitFor(isSent, 1500, 100)) return true;
    toast("Couldn't send automatically. Press Enter to send.");
    return false;
  }

  // Simulates pressing Enter in the ChatGPT input box.
  let syntheticEnter = false;
  function pressEnter() {
    const ed = getEditor();
    if (!ed) return;
    ed.focus();
    syntheticEnter = true;
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    ed.dispatchEvent(new KeyboardEvent("keydown", opts));
    ed.dispatchEvent(new KeyboardEvent("keypress", opts));
    ed.dispatchEvent(new KeyboardEvent("keyup", opts));
    syntheticEnter = false;
  }

  async function getSettings() {
    const { settings } = await chrome.storage.sync.get("settings");
    return { ...DEFAULTS, ...(settings || {}) };
  }
  async function loadHistory() {
    const r = await chrome.storage.local.get(HISTORY_KEY);
    return Array.isArray(r[HISTORY_KEY]) ? r[HISTORY_KEY] : [];
  }
  async function saveToHistory(text) {
    text = (text || "").trim();
    if (!text) return;
    let h = (await loadHistory()).filter((x) => x !== text);
    h.push(text); // newest last
    if (h.length > MAX_HISTORY) h = h.slice(-MAX_HISTORY);
    await chrome.storage.local.set({ [HISTORY_KEY]: h });
  }

  // ---------- toast ----------
  function toast(msg) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;" +
      "background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:13px system-ui;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:90vw";
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ---------- prompt-history picker (feature 2) ----------
  let host = null, shadow = null, listEl = null, posTimer = null;
  let history = [];
  let index = 0;          // history.length means "nothing selected / empty input"
  let pickerOpen = false;
  let recordNext = false; // record the next prompt that gets sent

  const CSS = `
    :host { all: initial; }
    .box { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; background: #fff; color: #0d0d0d;
           border: 1px solid #e3e3e3; border-radius: 16px; box-shadow: 0 8px 28px rgba(0,0,0,.16);
           display: flex; flex-direction: column; overflow: hidden; }
    .box.dark { background: #2f2f2f; color: #ececec; border-color: #444; }
    .head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; opacity: .75;
            border-bottom: 1px solid rgba(128,128,128,.25); }
    .head .sp { flex: 1; }
    kbd { font: 11px ui-monospace, monospace; border: 1px solid rgba(128,128,128,.5); border-radius: 4px; padding: 0 4px; }
    .x { cursor: pointer; border: 0; background: none; color: inherit; font-size: 16px; line-height: 1; padding: 0 2px; }
    .list { overflow-y: auto; padding: 4px; scroll-behavior: smooth; }
    .item { padding: 8px 10px; border-radius: 10px; cursor: pointer; white-space: pre-wrap;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .item:hover { background: rgba(128,128,128,.12); }
    .item.sel { background: #10a37f; color: #fff; }
    .empty { padding: 14px 12px; opacity: .7; font-size: 13px; }
  `;

  function isDark() {
    const c = document.documentElement.classList;
    return c.contains("dark") || (!c.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function position() {
    if (!host) return;
    const ed = getEditor();
    const comp = getComposer(ed);
    if (!comp) return;
    const r = (comp.closest("form") || comp).getBoundingClientRect();
    host.style.left = Math.max(8, r.left) + "px";
    host.style.width = Math.min(r.width, window.innerWidth - 16) + "px";
    host.style.bottom = window.innerHeight - r.top + 8 + "px";
    listEl.style.maxHeight = Math.max(120, Math.min(window.innerHeight * 0.5, r.top - 70)) + "px";
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!history.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No past prompts yet. Type one and press Enter — it will be saved here for next time.";
      listEl.appendChild(e);
      return;
    }
    // Oldest at the top, most recent at the bottom (closest to the input box).
    history.forEach((text, i) => {
      const it = document.createElement("div");
      it.className = "item" + (i === index ? " sel" : "");
      it.textContent = text;
      it.title = text;
      it.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
      it.addEventListener("click", () => select(i));
      it.addEventListener("dblclick", () => submit());
      listEl.appendChild(it);
    });
    const sel = listEl.children[index];
    if (sel) sel.scrollIntoView({ block: "nearest" });
    else listEl.scrollTop = listEl.scrollHeight;
  }

  function select(i) {
    index = Math.max(0, Math.min(history.length, i));
    const ed = getEditor();
    setText(ed, index === history.length ? "" : history[index]);
    render();
    if (ed) ed.focus();
  }

  async function openPicker() {
    history = await loadHistory();
    index = history.length;
    if (!host) {
      host = document.createElement("div");
      host.style.cssText = "position:fixed;z-index:2147483646;";
      shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>${CSS}</style>
        <div class="box">
          <div class="head"><span>Past prompts</span><span class="sp"></span>
            <span><kbd>↑</kbd> <kbd>↓</kbd> choose · <kbd>Enter</kbd> send · <kbd>Esc</kbd> hide</span>
            <button class="x" title="Hide">×</button></div>
          <div class="list"></div>
        </div>`;
      listEl = shadow.querySelector(".list");
      shadow.querySelector(".x").addEventListener("click", closePicker);
    }
    shadow.querySelector(".box").classList.toggle("dark", isDark());
    document.documentElement.appendChild(host);
    pickerOpen = true;
    recordNext = true;
    position();
    render();
    clearInterval(posTimer);
    posTimer = setInterval(position, 300);
    const ed = getEditor();
    if (ed) ed.focus();
  }

  function closePicker() {
    pickerOpen = false;
    clearInterval(posTimer);
    if (host) host.remove();
    const ed = getEditor();
    if (ed) ed.focus();
  }

  async function submit() {
    const text = getText(getEditor());
    closePicker();
    if (recordNext) { recordNext = false; await saveToHistory(text); }
    await sendWhenReady();
  }

  function inEditor(target) {
    const ed = getEditor();
    return ed && target && (ed === target || ed.contains(target));
  }

  window.addEventListener("keydown", (e) => {
    if (syntheticEnter || !inEditor(e.target) || e.isComposing) return;
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;

    if (pickerOpen && plain && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const cur = getText(getEditor());
      // Only switch prompts while the box is empty or holds a prompt from the list,
      // so arrows still move the cursor normally when you're editing your own text.
      if (cur !== "" && !history.includes(cur)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!history.length) return;
      select(index + (e.key === "ArrowUp" ? -1 : 1));
    } else if (pickerOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePicker();
    } else if (e.key === "Enter" && plain && (pickerOpen || recordNext)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      submit();
    }
  }, true);

  // Typing your own text clears the highlighted prompt.
  document.addEventListener("input", (e) => {
    if (!pickerOpen || !inEditor(e.target)) return;
    if (history[index] !== getText(getEditor()) && index !== history.length) {
      index = history.length;
      render();
    }
  }, true);

  // Sending with the mouse also saves the prompt to history.
  document.addEventListener("click", (e) => {
    if (!recordNext) return;
    const btn = e.target.closest && e.target.closest(SEND_SELECTORS.join(","));
    if (!btn) return;
    recordNext = false;
    saveToHistory(getText(getEditor()));
    if (pickerOpen) closePicker();
  }, true);

  // ---------- screenshot jobs from the background worker ----------
  const isFreshChat = () => location.pathname === "/";

  async function handleJob(job) {
    if (!job || job.error || !(job.image || job.text) || busy || navigating) return;
    if (Date.now() - job.ts > 120000) { chrome.storage.session.remove("job"); return; }
    busy = true;
    try {
      const settings = await getSettings();

      if (settings.newChat && !job.navigated && !isFreshChat()) {
        navigating = true;
        await chrome.storage.session.set({ job: { ...job, navigated: true } });
        location.href = "https://chatgpt.com/";
        return; // the reloaded page picks the job up again
      }
      await chrome.storage.session.remove("job");

      const ed = await waitFor(getEditor, 30000);
      if (!ed) { toast("Couldn't find the ChatGPT input box. Are you logged in?"); return; }

      if (pickerOpen) closePicker();

      // Third shortcut: paste the selected text and send it (no screenshot).
      if (job.mode === "text") {
        setText(ed, job.text);
        if (!getText(getEditor())) {
          const dt = new DataTransfer();
          dt.setData("text/plain", job.text);
          getEditor().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
          await sleep(300);
        }
        if (getText(getEditor())) await sendWhenReady();
        else toast("Couldn't paste the selected text into ChatGPT.");
        return;
      }

      setText(ed, "");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const ok = await attachImage(dataUrlToFile(job.image, `screenshot-${stamp}.png`));
      if (!ok) toast("Couldn't attach the screenshot automatically.");

      if (job.mode === "auto") {
        const prompt = settings.defaultPrompt || DEFAULTS.defaultPrompt;
        setText(getEditor(), prompt);
        if (!getText(getEditor())) {
          // Fallback: paste the text if typing it didn't work.
          const dt = new DataTransfer();
          dt.setData("text/plain", prompt);
          getEditor().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
          await sleep(200);
        }
        // Auto-enter: always send the default prompt + screenshot.
        if (getText(getEditor())) await sendWhenReady();
        else toast("Couldn't type the default prompt into ChatGPT.");
      } else {
        setText(getEditor(), ""); // input stays empty and selected
        await openPicker();
      }
    } catch (err) {
      console.error("[Snap to ChatGPT]", err);
      toast("Something went wrong: " + err.message);
    } finally {
      busy = false;
    }
  }

  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.job && changes.job.newValue) handleJob(changes.job.newValue);
  });
  chrome.storage.session.get("job").then((r) => handleJob(r.job));
})();
