"use strict";

function fileVisual(meta) {
  const ext = (meta.ext || "").toLowerCase();
  if (meta.kind === "table") return "📊";
  if (ext === "pdf") return "📕";
  if (ext === "docx") return "📘";
  if (ext === "txt" || ext === "md") return "📄";
  return "📁";
}

function fileDesc(meta) {
  const bits = [];
  if (meta.kind === "table") {
    bits.push(`table · ${meta.rowCount ?? 0} rows`);
  } else {
    bits.push(`text · ${meta.chars ?? 0} chars`);
    if (meta.pages) bits.push(`${meta.pages} pages`);
  }
  bits.push(fmtBytes(meta.size));
  bits.push(fmtDate(meta.uploadedAt));
  return bits.join(" · ");
}

function fileTypeLabel(meta) {
  if (meta.kind === "table") return `<span class="pill table">vocab list</span>`;
  return `<span class="pill paper">document</span>`;
}

const Files = {
  async render() {
    const ctx = getContext();
    if (!ctx.course || !ctx.chapter) return noContextHtml();
    const files = ctx.chapter.files || [];
    const ws = $("#workspace");
    ws.innerHTML = `
      <div class="page">
        <div class="breadcrumb">
          <a data-act="open-course" data-course="${ctx.course.id}">${esc(ctx.course.name)}</a>
          &nbsp;/&nbsp;
          <a data-act="open-chapter" data-course="${ctx.course.id}"
             data-chapter="${ctx.chapter.id}">${esc(ctx.chapter.name)}</a>
          &nbsp;/&nbsp; Files
        </div>
        <div class="toolbar">
          <div><h1>Files</h1>
          <p class="sub">Upload your vocabulary lists and past papers. Everything stays on this computer.</p></div>
        </div>

        <div class="card">
          <h3>Add files</h3>
          <div class="dropzone" id="dropzone">
            <div class="dz-big">Drag &amp; drop files here</div>
            <div class="text-soft" style="font-size:13px">or</div>
            <button class="btn btn-primary" id="pick-file-btn">Choose local files</button>
            <input type="file" id="file-input" multiple
                   accept=".xlsx,.xlsm,.csv,.tsv,.txt,.md,.docx,.pdf">
            <p class="text-soft" style="font-size:12px;margin:10px 0 0">
              Supported: Excel (.xlsx), CSV/TSV, plain text, Word (.docx), digital PDF.
              Excel files work best for vocabulary flashcards; PDFs and Word docs for past papers.</p>
          </div>
          <details style="margin-top:12px">
            <summary class="linkish" style="cursor:pointer">…or paste text directly</summary>
            <div style="margin-top:10px">
              <textarea class="input" id="paste-area" rows="6"
                placeholder="Paste a vocabulary list (word — meaning per line) or a short paper."></textarea>
              <div style="margin-top:8px;display:flex;gap:8px">
                <input class="input" id="paste-name" style="max-width:260px"
                       placeholder="Name (optional)">
                <button class="btn btn-primary" id="paste-btn">Save pasted text</button>
              </div>
            </div>
          </details>
        </div>

        <div class="card">
          <h3>Files in this chapter <span class="text-soft" style="font-weight:400">(${files.length})</span></h3>
          ${files.length ? files.map((f) => `
            <div class="file-row">
              <span class="file-icon">${fileVisual(f)}</span>
              <div class="file-main">
                <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
                <div class="file-meta">${fileTypeLabel(f)} ${esc(fileDesc(f))}</div>
              </div>
              <button class="btn btn-small" data-act="preview" data-file="${f.id}">Preview</button>
              <button class="btn btn-small btn-danger" data-act="delete-file"
                      data-file="${f.id}">Delete</button>
            </div>`).join("")
        : `<p class="text-soft" style="margin:4px 0">No files yet — drop some in above.</p>`}
        </div>
      </div>`;

    bindDropzone(ctx);
    bindFileActions(ctx, files);
  },
};

function bindDropzone(ctx) {
  const dz = $("#dropzone");
  const input = $("#file-input");
  const pick = $("#pick-file-btn");
  pick.onclick = () => input.click();
  input.onchange = () => {
    const files = Array.from(input.files);
    input.value = "";
    if (files.length) uploadFiles(ctx, files);
  };
  ["dragenter", "dragover"].forEach((type) =>
    dz.addEventListener(type, (ev) => { ev.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((type) =>
    dz.addEventListener(type, (ev) => { ev.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (ev) => {
    const files = Array.from(ev.dataTransfer.files || []);
    if (files.length) uploadFiles(ctx, files);
  });
  $("#paste-btn").onclick = async () => {
    const text = $("#paste-area").value;
    const name = $("#paste-name").value.trim() || null;
    if (!text.trim()) { UI.toast("Type something to save first.", "error"); return; }
    try {
      await UI.wait(API.pasteFile(ctx.course.id, ctx.chapter.id, text, name),
                    "Saving pasted text…");
      UI.toast("Saved.");
      await refreshAll();
      Files.render();
    } catch (err) { handleApiError(err); }
  };
}

async function uploadFiles(ctx, files) {
  let done = 0;
  const total = files.length;
  const badge = UI.busy(`Uploading 0/${total}…`);
  for (const file of files) {
    try {
      UI.setBusyLabel(`Reading ${file.name}…`);
      await API.uploadFile(ctx.course.id, ctx.chapter.id, file);
      done++;
      UI.setBusyLabel(`Uploaded ${done}/${total}…`);
    } catch (err) {
      UI.toast(`${file.name}: ${err.message}`, "error", 6000);
    }
  }
  badge();
  if (done) {
    UI.toast(done === total ? `Imported ${total} file${total > 1 ? "s" : ""}.`
                            : `Imported ${done} of ${total}.`);
    await refreshAll();
    Files.render();
  }
}

function bindFileActions(ctx, files) {
  const ws = $("#workspace");
  $$("[data-act=preview]", ws).forEach((btn) =>
    btn.onclick = () => {
      const file = files.find((f) => f.id === btn.dataset.file);
      if (file) previewFileModal(file);
    });
  $$("[data-act=delete-file]", ws).forEach((btn) =>
    btn.onclick = async () => {
      const file = files.find((f) => f.id === btn.dataset.file);
      if (!file) return;
      const yes = await UI.confirm("Delete this file?",
        `“${file.name}” will be removed from the chapter. Flashcards and tests already built from it stay.`,
        "Delete file");
      if (!yes) return;
      try {
        await API.deleteFile(ctx.course.id, ctx.chapter.id, btn.dataset.file);
        await refreshAll();
        Files.render();
        UI.toast("File deleted.");
      } catch (err) { handleApiError(err); }
    });
  const openCourse = $("[data-act=open-course]", ws);
  if (openCourse) openCourse.onclick = () => {
    State.active = { courseId: ctx.course.id, page: "course" };
    render();
  };
  const openChapter = $("[data-act=open-chapter]", ws);
  if (openChapter) openChapter.onclick = () => {
    State.active = { courseId: ctx.course.id, chapterId: ctx.chapter.id, page: "chapter" };
    render();
  };
}

async function previewFileModal(meta) {
  const m = UI.modal(`
    <h2>${esc(meta.name)}</h2>
    <div class="text-soft" style="font-size:13px;margin:-6px 0 10px">${fileDesc(meta)}</div>
    <div id="preview-body"><div class="spinner" style="margin:30px auto"></div></div>
    <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, { wide: true });
  try {
    const data = await API.filePreview(meta.id);
    const body = m.$("#preview-body");
    if (data.kind === "table") {
      const head = data.headers.map((h) => `<th>${esc(h)}</th>`).join("");
      const rows = data.rows.slice(0, 40).map((r) =>
        `<tr>${data.headers.map((h) => `<td>${esc(r[h] ?? "")}</td>`).join("")}</tr>`).join("");
      body.innerHTML = `
        <p class="text-soft" style="font-size:13px">${data.rowCount} data rows
          ${data.headerRow ? "(first row treated as headers)" : ""}</p>
        <div style="overflow:auto;max-height:55vh">
          <table class="map-preview"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    } else {
      body.innerHTML = `
        <p class="text-soft" style="font-size:13px">${data.chars ?? 0} characters extracted
          ${data.pages ? `· ${data.pages} pages` : ""}</p>
        <div style="max-height:55vh;overflow:auto;background:#fbfaf7;border:1px solid var(--line);
                    border-radius:10px;padding:14px;white-space:pre-wrap;font-size:13px;line-height:1.55">${esc(data.text || "(no text)")}</div>`;
    }
  } catch (err) {
    m.$("#preview-body").innerHTML = `<div class="error-banner">${esc(err.message)}</div>`;
  }
}

/** Modal that lets the user tick files. Returns Set of file ids or null. */
function pickFilesModal(files, options = {}) {
  const allowNone = options.allowNone || false;
  const title = options.title || "Choose files";
  return new Promise((resolve) => {
    const items = (files || []).map((f) => `
      <label class="file-row" style="cursor:pointer">
        <input type="checkbox" class="pick-check" value="${f.id}"
               ${options.preselected && options.preselected.includes(f.id) ? "checked" : ""}>
        <span class="file-icon">${fileVisual(f)}</span>
        <span class="file-main">
          <span class="file-name">${esc(f.name)}</span>
          <span class="file-meta">${esc(fileDesc(f))}</span>
        </span>
      </label>`).join("");
    const m = UI.modal(`
      <h2>${esc(title)}</h2>
      <p class="text-soft" style="margin:-4px 0 10px;font-size:13px">${esc(options.hint || "")}</p>
      <div style="max-height:46vh;overflow-y:auto">${items || '<p class="text-soft">No files yet.</p>'}</div>
      <div class="modal-actions">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" data-action="ok">${esc(options.okLabel || "Use selected files")}</button>
      </div>`, { wide: true });
    m.$("[data-action=ok]").onclick = () => {
      const chosen = new Set(
        $$(".pick-check:checked", m.el).map((el) => el.value));
      if (!allowNone && chosen.size === 0) {
        UI.toast("Pick at least one file.", "error");
        return;
      }
      m.close();
      resolve(chosen);
    };
  });
}
