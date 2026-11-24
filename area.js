// Area screenshot (snipping tool). Loaded into the background worker with importScripts.
// startAreaCapture() freezes the page as a screenshot and lets you drag a rectangle on it;
// the cropped image is then sent to ChatGPT like the other screenshot shortcuts.

// Runs inside the web page (injected with chrome.scripting). Must be self-contained.
function snapAreaPicker(dataUrl) {
  const OLD = document.getElementById("__snap_area_picker");
  if (OLD) OLD.remove();

  const host = document.createElement("div");
  host.id = "__snap_area_picker";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .wrap { position: fixed; inset: 0; cursor: crosshair; user-select: none; outline: none; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .shade { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
      .sel { position: absolute; display: none; border: 2px solid #10a37f; box-sizing: border-box;
             box-shadow: 0 0 0 99999px rgba(0,0,0,.45); }
      .hint { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); background: #111; color: #fff;
              font: 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px; white-space: nowrap;
              box-shadow: 0 4px 16px rgba(0,0,0,.4); pointer-events: none; }
      .size { position: absolute; display: none; background: #10a37f; color: #fff; font: 11px system-ui, sans-serif;
              padding: 2px 6px; border-radius: 4px; pointer-events: none; }
      .bar { position: absolute; display: none; gap: 6px; background: #fff; padding: 6px; border-radius: 10px;
             box-shadow: 0 4px 16px rgba(0,0,0,.35); font: 13px system-ui, sans-serif; cursor: default; }
      .bar button { font: inherit; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; background: #f0f0f0; color: #111; }
      .bar button:hover { filter: brightness(.95); }
      .bar button.primary { background: #10a37f; color: #fff; }
    </style>
    <div class="wrap" tabindex="-1">
      <canvas></canvas>
      <div class="shade"></div>
      <div class="sel"></div>
      <div class="size"></div>
      <div class="hint">Drag to select an area · Esc to cancel</div>
      <div class="bar">
        <button class="primary" data-mode="auto" title="Send with your default prompt (Enter)">Ask ↵</button>
        <button data-mode="pick" title="Choose or type a prompt (H)">Choose prompt (H)</button>
        <button data-act="redo" title="Select again">Redo</button>
        <button data-act="cancel" title="Cancel (Esc)">✕</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const wrap = $(".wrap"), canvas = $("canvas"), shade = $(".shade"), selEl = $(".sel");
  const sizeEl = $(".size"), hint = $(".hint"), bar = $(".bar");

  let bitmap = null, start = null, rect = null, dragging = false;

  // Draw the frozen screenshot. A canvas is used (not <img>) so the page's
  // Content-Security-Policy can't block the image.
  (async () => {
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
  })();

  function cleanup() {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("wheel", block, { capture: true });
    host.remove();
  }
  function block(e) { e.preventDefault(); e.stopPropagation(); }

  function draw() {
    if (!rect) {
      selEl.style.display = sizeEl.style.display = "none";
      shade.style.display = "block";
      return;
    }
    shade.style.display = "none";
    Object.assign(selEl.style, {
      display: "block", left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px"
    });
    sizeEl.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
    Object.assign(sizeEl.style, {
      display: "block", left: rect.x + "px", top: Math.max(0, rect.y - 22) + "px"
    });
  }

  function showBar() {
    bar.style.display = "flex";
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = rect.y + rect.h + 8;
    if (top + bh > innerHeight - 4) top = rect.y - bh - 8;
    if (top < 4) top = Math.min(innerHeight - bh - 4, rect.y + 8);
    const left = Math.min(Math.max(4, rect.x + rect.w - bw), innerWidth - bw - 4);
    bar.style.top = top + "px";
    bar.style.left = left + "px";
  }

  function reset() {
    rect = null;
    bar.style.display = "none";
    hint.style.display = "block";
    draw();
  }

  async function finish(mode) {
    if (!rect || !bitmap) return;
    const sx = bitmap.width / innerWidth, sy = bitmap.height / innerHeight;
    const x = Math.round(rect.x * sx), y = Math.round(rect.y * sy);
    const w = Math.max(1, Math.round(rect.w * sx)), h = Math.max(1, Math.round(rect.h * sy));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    const image = out.toDataURL("image/png");
    cleanup();
    chrome.runtime.sendMessage({ type: "area-selected", mode, image });
  }

  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || bar.contains(e.target)) return;
    e.preventDefault();
    bar.style.display = "none";
    hint.style.display = "none";
    start = { x: e.clientX, y: e.clientY };
    rect = { x: start.x, y: start.y, w: 0, h: 0 };
    dragging = true;
    draw();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(innerWidth, e.clientX));
    const y = Math.max(0, Math.min(innerHeight, e.clientY));
    rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
    draw();
  }, true);
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    if (!rect || rect.w < 5 || rect.h < 5) return reset();
    showBar();
  }, true);

  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.mode) finish(b.dataset.mode);
    else if (b.dataset.act === "redo") reset();
    else cleanup();
  });

  function onKey(e) {
    if (e.key === "Escape") { block(e); cleanup(); }
    else if (e.key === "Enter" && rect && !dragging) { block(e); finish("auto"); }
    else if ((e.key === "h" || e.key === "H") && rect && !dragging) { block(e); finish("pick"); }
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("wheel", block, { capture: true, passive: false });
  window.focus();
  wrap.focus();
}

async function startAreaCapture(tab) {
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  const fail = (msg) =>
    chrome.storage.session.set({ job: { id, mode: "auto", ts: Date.now(), error: msg } });

  // Open the panel first (needs the shortcut's user gesture). Then wait for the page to
  // resize to its new width, so the frozen screenshot lines up with what you see.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.warn("sidePanel.open", e));
  await new Promise((r) => setTimeout(r, 450));

  let image;
  try {
    image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch (err) {
    return fail("Couldn't capture this page (" + (err && err.message ? err.message : err) +
      "). Chrome doesn't allow screenshots of chrome:// pages, the Web Store or other extension pages.");
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: snapAreaPicker, args: [image] });
  } catch (err) {
    return fail("Can't select an area on this page (" + (err && err.message ? err.message : err) + ").");
  }
}

// The picker sends the cropped image back here; hand it to ChatGPT in the side panel.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "area-selected" || !msg.image) return;
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  chrome.storage.session.set({
    job: { id, mode: msg.mode === "pick" ? "pick" : "auto", image: msg.image, ts: Date.now() }
  });
});
