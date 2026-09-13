"use strict";

const Chat = {
  async render() {
    const ctx = getContext();
    if (!ctx.course || !ctx.chapter) return noContextHtml();
    const files = ctx.chapter.files || [];
    const selected = new Set(files.map((f) => f.id));
    const ws = $("#workspace");
    ws.innerHTML = `
      <div class="page" style="padding-bottom:30px">
        ${breadcrumbHtml(ctx, "Ask AI")}
        <h1>Ask AI</h1>
        <p class="sub">Chat with your chapter's files — ask for explanations, translations or exam tips.</p>
        <div class="chat-wrap">
          <div class="card" style="padding:12px 16px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="text-soft" style="font-size:13px">Sources for this conversation</span>
              <span>
                <button class="btn btn-small" id="chat-all">All</button>
                <button class="btn btn-small" id="chat-none">None</button>
                <button class="btn btn-small btn-danger" id="chat-clear">New conversation</button>
              </span>
            </div>
            <div class="chip-row chat-files" id="chat-chips" style="margin-top:8px">
              ${files.map((f) => `
                <label class="chip selected"><input type="checkbox" value="${f.id}" checked
                  style="display:none">${esc(f.name)}</label>`).join("") || '<span class="text-soft">No files in this chapter.</span>'}
            </div>
          </div>
          <div class="chat-log" id="chat-log">
            <div class="chat-empty">Ask something about your files — e.g.<br>
              “Explain the grammar in the third question” or “Make me a revision list from the vocabulary file.”</div>
          </div>
          <div class="chat-input-row">
            <textarea class="input" id="chat-input" rows="2"
              placeholder="Ask about your materials… (Enter to send, Shift+Enter for new line)"></textarea>
            <button class="btn btn-primary" id="chat-send">Send</button>
          </div>
        </div>
      </div>`;

    const syncChips = () => {
      $$("#chat-chips input").forEach((box) => {
        box.closest(".chip").classList.toggle("selected", box.checked);
        if (box.checked) selected.add(box.value); else selected.delete(box.value);
      });
    };
    $("#chat-all").onclick = () => {
      $$("#chat-chips input").forEach((b) => { b.checked = true; });
      syncChips();
    };
    $("#chat-none").onclick = () => {
      $$("#chat-chips input").forEach((b) => { b.checked = false; });
      syncChips();
    };
    $("#chat-chips").addEventListener("change", syncChips);
    $("#chat-clear").onclick = async () => {
      const yes = await UI.confirm("Start a new conversation?",
        "The current chat history for this chapter is cleared.", "New conversation", false);
      if (!yes) return;
      try {
        await API.resetChat(ctx.chapter.id);
        this.render();
      } catch (err) { handleApiError(err); }
    };

    const log = $("#chat-log");
    const input = $("#chat-input");
    let history = [];
    const renderLog = (messages) => {
      history = messages;
      if (!messages.length) {
        log.innerHTML = `<div class="chat-empty">Ask something about your files…</div>`;
        return;
      }
      log.innerHTML = messages.map((m) => m.role === "user"
        ? `<div class="msg user">${esc(m.content)}</div>`
        : `<div class="msg ai">${esc(m.content)}</div>`).join("");
      log.scrollTop = log.scrollHeight;
    };

    const send = async () => {
      const text = input.value.trim();
      if (!text || sending) return;
      input.value = "";
      sending = true;
      renderLog([...history, { role: "user", content: text }]);
      const badge = UI.busy("Thinking…");
      try {
        const data = await API.sendChat(ctx.course.id, ctx.chapter.id,
                                        Array.from(selected), text);
        badge();
        renderLog(data.messages);
      } catch (err) {
        badge();
        handleApiError(err, "Could not reach the AI.");
      } finally {
        sending = false;
      }
    };
    let sending = false;
    $("#chat-send").onclick = send;
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });

    try {
      const { messages } = await API.getChat(ctx.chapter.id);
      renderLog(messages);
    } catch { /* ignore */ }
  },
};
