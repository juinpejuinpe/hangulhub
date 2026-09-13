"use strict";

const UI = {
  toast(message, kind = "info", ms = 3200) {
    const root = $("#toast-root");
    const el = document.createElement("div");
    el.className = `toast ${kind === "error" ? "err" : ""}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 320);
    }, ms);
  },

  busy(label = "Working…") {
    $("#busy-root").classList.remove("hidden");
    $("#busy-label").textContent = label;
    return () => $("#busy-root").classList.add("hidden");
  },

  setBusyLabel(label) {
    $("#busy-label").textContent = label;
  },

  async wait(task, label) {
    const done = this.busy(label);
    try {
      return await task;
    } finally {
      done();
    }
  },

  async withBusy(label, task) {
    const done = this.busy(label);
    try {
      return await task();
    } finally {
      done();
    }
  },

  modal(html, options = {}) {
    const root = $("#modal-root");
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal ${options.wide ? "wide" : ""}" role="dialog">
        <button class="close-x" data-close aria-label="Close">✕</button>
        ${html}
      </div>`;
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop || ev.target.closest("[data-close]")) close();
    });
    root.appendChild(backdrop);
    const onKey = (ev) => { if (ev.key === "Escape") close(); };
    document.addEventListener("keydown", onKey, { once: true });
    return { close, el: backdrop, $: (sel) => backdrop.querySelector(sel) };
  },

  confirm(title, message, confirmLabel = "Delete", danger = true) {
    return new Promise((resolve) => {
      const m = this.modal(`
        <h2>${esc(title)}</h2>
        <p class="text-soft" style="line-height:1.55">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}"
                  data-action="confirm">${esc(confirmLabel)}</button>
        </div>`);
      m.$("[data-action=cancel]").onclick = () => { m.close(); resolve(false); };
      m.$("[data-action=confirm]").onclick = () => { m.close(); resolve(true); };
    });
  },

  prompt(title, value = "", placeholder = "", okLabel = "Save") {
    return new Promise((resolve) => {
      const m = this.modal(`
        <h2>${esc(title)}</h2>
        <div class="field">
          <input class="input" id="prompt-value" value="${esc(value)}"
                 placeholder="${esc(placeholder)}" autofocus>
        </div>
        <div class="modal-actions">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="ok">${esc(okLabel)}</button>
        </div>`);
      const input = m.$("#prompt-value");
      const submit = () => {
        const val = input.value.trim();
        if (!val) return;
        m.close();
        resolve(val);
      };
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
      m.$("[data-action=cancel]").onclick = () => { m.close(); resolve(null); };
      m.$("[data-action=ok]").onclick = submit;
      setTimeout(() => input.focus(), 30);
    });
  },
};

function handleApiError(err, fallback = "Something went wrong.") {
  console.error(err);
  UI.toast(err.message || fallback, "error", 6000);
}
