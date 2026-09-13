"use strict";

const Flashcards = {
  async render() {
    const active = State.active || {};
    if (active.deckId) {
      return this.renderStudy(active.deckId);
    }
    const ctx = getContext();
    if (!ctx.course || !ctx.chapter) return noContextHtml();
    const eligible = (ctx.chapter.files || [])
      .filter((f) => f.kind === "table" || ["txt", "md", "pdf"].includes(f.ext));
    const ws = $("#workspace");
    ws.innerHTML = `
      <div class="page">
        ${breadcrumbHtml(ctx, "Flashcards")}
        <h1>Flashcards</h1>
        <p class="sub">Type your own cards, or build a deck from a vocabulary list — then study in random order.</p>

        <div class="card">
          <h3>✍️ Write your own cards</h3>
          <p class="text-soft" style="margin:0 0 12px;font-size:13.5px">
            Front is what you'll be tested on, back is the answer. Blank fronts are skipped.
            Press <span class="kbd">Enter</span> in a back box to move to the next card —
            at the end of the list it adds a new row.
          </p>
          <div class="field" style="margin-bottom:10px">
            <label>Deck name</label>
            <input class="input" id="manual-name" placeholder="e.g. Words I keep forgetting">
          </div>
          <div class="manual-head"><span>Front</span><span>Back</span><span></span></div>
          <div id="manual-rows"></div>
          <div class="manual-actions">
            <button class="btn btn-small" id="manual-add-row">＋ Add row</button>
            <span class="text-soft" id="manual-count"></span>
            <button class="btn btn-primary" id="manual-save">Save deck</button>
          </div>
        </div>

        <div class="card">
          <h3>Build a deck from files</h3>
          <p class="text-soft" style="margin:0 0 12px;font-size:13.5px">
            Choose one or more files. Each row becomes a card (front = the word,
            back = its meaning). PDF vocab lists work too.
            ${eligible.length ? "" : "This chapter has no vocabulary files yet."}
          </p>
          <button class="btn btn-primary" id="build-deck-btn"
                  ${eligible.length ? "" : "disabled"}>＋ Build from files…</button>
          ${eligible.length ? "" : `<a class="btn" style="margin-left:8px" data-goto="files">Add files</a>`}
        </div>

        <div class="card">
          <h3>Deck library</h3>
          <div id="deck-library"><div class="spinner" style="margin:24px auto"></div></div>
        </div>
      </div>`;
    ws.querySelector("#build-deck-btn").onclick = () => this.buildFlow(ctx, eligible);
    ws.querySelector("[data-goto=files]")?.addEventListener("click", () => {
      State.active = { ...active, page: "files" };
      render();
    });

    const rows = ws.querySelector("#manual-rows");
    const countEl = ws.querySelector("#manual-count");
    const writer = this.bindRows(rows, (n) => {
      countEl.textContent = n ? `${n} card${n === 1 ? "" : "s"} ready` : "Type at least one card";
    });
    for (let i = 0; i < 3; i++) writer.addRow(false);
    writer.update();
    ws.querySelector("#manual-add-row").onclick = () => writer.addRow(true);
    ws.querySelector("#manual-save").onclick = async () => {
      const cards = this.readCards(rows);
      if (!cards.length) return UI.toast("Add at least one card first.", "error");
      const name = ws.querySelector("#manual-name").value.trim() || "My cards";
      try {
        const { deck } = await UI.wait(
          API.createManualDeck({ courseId: ctx.course.id, chapterId: ctx.chapter.id, name, cards }),
          "Saving deck…");
        await refreshAll();
        ws.querySelector("#manual-name").value = "";
        rows.innerHTML = "";
        for (let i = 0; i < 3; i++) writer.addRow(false);
        writer.update();
        await this.renderLibrary(ctx);
        UI.toast(`Saved “${deck.name}” — ${deck.cards.length} cards.`);
      } catch (err) { handleApiError(err); }
    };
    await this.renderLibrary(ctx);
  },

  manualRowHtml(card = {}) {
    return `
      <div class="manual-row" data-card-id="${esc(card.id || "")}">
        <input class="input m-front" placeholder="Korean word or question" value="${esc(card.front || "")}">
        <input class="input m-back" placeholder="Meaning or answer" value="${esc(card.back || "")}">
        <button type="button" class="rm" title="Remove this card" aria-label="Remove this card">✕</button>
      </div>`;
  },

  bindRows(container, onCount) {
    const update = () => { if (onCount) onCount(this.readCards(container).length); };
    const addRow = (focus) => {
      container.insertAdjacentHTML("beforeend", this.manualRowHtml());
      if (focus) container.lastElementChild.querySelector(".m-front").focus();
      update();
    };
    container.addEventListener("click", (ev) => {
      const rm = ev.target.closest(".rm");
      if (!rm) return;
      const row = rm.closest(".manual-row");
      if (container.querySelectorAll(".manual-row").length <= 1) {
        row.querySelectorAll("input").forEach((input) => { input.value = ""; });
        row.querySelector(".m-front").focus();
      } else {
        row.remove();
      }
      update();
    });
    container.addEventListener("input", update);
    container.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const row = ev.target.closest(".manual-row");
      if (!row) return;
      if (ev.target.classList.contains("m-front")) {
        row.querySelector(".m-back").focus();
        return;
      }
      const all = Array.from(container.querySelectorAll(".manual-row"));
      const next = all[all.indexOf(row) + 1];
      if (next) next.querySelector(".m-front").focus();
      else addRow(true);
    });
    return { addRow, update };
  },

  readCards(container) {
    return Array.from(container.querySelectorAll(".manual-row")).map((row) => ({
      id: row.dataset.cardId || undefined,
      front: row.querySelector(".m-front").value.trim(),
      back: row.querySelector(".m-back").value.trim(),
    })).filter((card) => card.front);
  },

  async renderLibrary(ctx) {
    const box = $("#deck-library");
    if (!box) return;
    try {
      const { decks } = await API.get(`/api/listings?${objToQs({ courseId: ctx.course.id, chapterId: ctx.chapter.id })}`);
      if (!decks.length) {
        box.innerHTML = `<p class="text-soft" style="margin:4px 0">No decks yet — write one above, or build a deck from files.</p>`;
        return;
      }
      box.innerHTML = decks.map((d) => `
        <div class="row-card">
          <div style="text-align:center;min-width:64px">
            <div class="mono" style="font-weight:800;font-size:17px">${d.percent}%</div>
            <div class="text-soft" style="font-size:11px">${d.learned}/${d.total} known</div>
          </div>
          <div class="grow">
            <div class="title">${esc(d.name)}</div>
            <div class="meta">${d.total} cards ·
              ${d.source === "manual" ? "written by you" : "from files"} ·
              created ${fmtDate(d.createdAt)}
              ${d.completed ? "· round complete ✓" : d.percent > 0 ? "· in progress" : "· not started"}</div>
          </div>
          <button class="btn btn-small" data-edit-deck="${d.id}">✎ Edit cards</button>
          <button class="btn btn-primary btn-small" data-deck="${d.id}">Study</button>
          <button class="btn btn-small btn-danger" data-delete-deck="${d.id}">Delete</button>
        </div>`).join("");
      $$("[data-deck]", box).forEach((b) =>
        b.onclick = () => {
          State.active = { ...State.active, deckId: b.dataset.deck };
          render();
        });
      $$("[data-edit-deck]", box).forEach((b) =>
        b.onclick = async () => {
          try {
            const { deck } = await API.getDeck(b.dataset.editDeck);
            this.editDeckModal(deck);
          } catch (err) { handleApiError(err); }
        });
      $$("[data-delete-deck]", box).forEach((b) =>
        b.onclick = async () => {
          const yes = await UI.confirm("Delete this deck?",
            "The deck and its learning history will be removed.", "Delete deck");
          if (!yes) return;
          try {
            await API.deleteDeck(b.dataset.deleteDeck);
            await refreshAll();
            this.render();
          } catch (err) { handleApiError(err); }
        });
    } catch (err) { handleApiError(err); }
  },

  editDeckModal(deck) {
    const m = UI.modal(`
      <h2>Edit cards</h2>
      <p class="text-soft" style="margin-top:-6px;font-size:13px">
        Type over any text, add cards, or remove the ones you no longer need.
        Cards you keep hold on to their learning progress.</p>
      <div class="field">
        <label>Deck name</label>
        <input class="input" id="edit-deck-name" value="${esc(deck.name || "")}">
      </div>
      <div class="manual-head"><span>Front</span><span>Back</span><span></span></div>
      <div id="edit-rows" class="scroll"></div>
      <button class="btn btn-small" id="edit-add-row" style="margin-top:4px">＋ Add row</button>
      <div class="modal-actions">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="edit-save">Save changes</button>
      </div>`, { wide: true });

    const rows = m.$("#edit-rows");
    const cards = deck.cards || [];
    cards.forEach((card) =>
      rows.insertAdjacentHTML("beforeend", this.manualRowHtml(card)));
    if (!cards.length) rows.insertAdjacentHTML("beforeend", this.manualRowHtml());
    const writer = this.bindRows(rows, (n) => {
      m.$("#edit-save").textContent = n ? `Save ${n} card${n === 1 ? "" : "s"}` : "Save changes";
    });
    m.$("#edit-add-row").onclick = () => writer.addRow(true);
    m.$("#edit-save").onclick = async () => {
      const next = this.readCards(rows);
      if (!next.length) return UI.toast("Keep at least one card with a front side.", "error");
      try {
        await API.updateDeckCards(deck.id, next, m.$("#edit-deck-name").value.trim());
        m.close();
        await refreshAll();
        UI.toast(`Saved ${next.length} card${next.length === 1 ? "" : "s"}.`);
        Flashcards.render();
      } catch (err) { handleApiError(err); }
    };
  },

  async buildFlow(ctx, eligible) {
    const chosen = await pickFilesModal(eligible, {
      title: "Choose vocabulary files",
      hint: "Tick the files whose rows should become flashcards. You can combine several files into one deck.",
      okLabel: "Next: map columns",
    });
    if (!chosen) return;
    const metas = eligible.filter((f) => chosen.has(f.id));
    const previews = {};
    for (const meta of metas) {
      try { previews[meta.id] = await API.filePreview(meta.id); }
      catch { UI.toast(`Could not read ${meta.name}`, "error"); }
    }
    this.mappingModal(ctx, metas, previews);
  },

  mappingModal(ctx, metas, previews) {
    const blocks = metas.map((meta) => {
      const content = previews[meta.id];
      if (!content) return "";
      if (content.kind === "table") {
        const headers = content.headers || [];
        const sample = content.rows.slice(0, 3);
        const rowHtml = sample.map((r) => `<tr>${
          headers.map((h) => `<td>${esc(r[h] ?? "")}</td>`).join("")}</tr>`).join("");
        return `
          <div class="card" data-file="${meta.id}">
            <h3>${esc(meta.name)} <span class="text-soft" style="font-weight:400">· ${content.rowCount} rows</span></h3>
            <div class="grid2">
              <div class="field">
                <label>Front (e.g. Korean word)</label>
                <select class="input map-front">${headers.map((h) =>
                  `<option ${/word|korean|hangul|english|term|vocab|front/i.test(h) && !/meaning|back|def/i.test(h) ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>
              </div>
              <div class="field">
                <label>Back — meanings to show</label>
                <div class="chip-row map-back">${headers.map((h) =>
                  `<label class="chip ${/meaning|def|english|trans|뜻|뜻풀이|back|reading|pron/i.test(h) ? "selected" : ""}">
                    <input type="checkbox" value="${esc(h)}" style="display:none" ${/meaning|def|english|trans|뜻|back|reading|pron/i.test(h) ? "checked" : ""}>${esc(h)}</label>`).join("")}</div>
              </div>
            </div>
            <details><summary class="linkish" style="cursor:pointer">Preview rows</summary>
              <table class="map-preview"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
              <tbody>${rowHtml}</tbody></table></details>
          </div>`;
      }
      const pairs = previewPairs(content);
      return `
        <div class="card" data-file="${meta.id}">
          <h3>${esc(meta.name)}
            <span class="pill table" style="margin-left:6px">line pairs auto-detected</span>
          </h3>
          ${pairs.length ? pairs.slice(0, 5).map(([a, b]) =>
            `<div class="pair-preview"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join("")
          : `<p class="error-banner">No word → meaning pairs were detected.
              Expected lines like <code>학교 — school</code> (tab, comma, hyphen or equals).</p>`}
        </div>`;
    }).join("");
    if (!blocks) { UI.toast("Could not read the chosen files.", "error"); return; }

    const m = UI.modal(`
      <h2>Map your deck</h2>
      <p class="text-soft" style="font-size:13px;margin-top:-6px">
        Front is what you're tested on; back is what appears when you flip.</p>
      <div class="field"><label>Deck name</label>
        <input class="input" id="deck-name" placeholder="e.g. Week 1 vocab"></div>
      ${blocks}
      <div class="modal-actions">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="create-deck-btn">Build deck</button>
      </div>`, { wide: true });

    $$(".map-back label.chip", m.el).forEach((chip) =>
      chip.addEventListener("click", (ev) => {
        ev.preventDefault();
        const box = chip.querySelector("input");
        box.checked = !box.checked;
        chip.classList.toggle("selected", box.checked);
      }));
    m.$("#create-deck-btn").onclick = async () => {
      const name = m.$("#deck-name").value.trim() || "Vocabulary deck";
      const files = metas.map((meta) => {
        const content = previews[meta.id];
        const block = m.$(`[data-file="${meta.id}"]`);
        if (!content || !block) return null;
        if (content.kind === "table") {
          const front = block.querySelector(".map-front").value;
          const back = Array.from(block.querySelectorAll(".map-back input:checked"))
            .map((el) => el.value);
          return { fileId: meta.id, front, back };
        }
        return { fileId: meta.id };
      }).filter(Boolean);
      try {
        const { deck } = await UI.wait(
          API.buildDeck({ courseId: ctx.course.id, chapterId: ctx.chapter.id, name, files }),
          "Building deck…");
        m.close();
        await refreshAll();
        State.active = { courseId: ctx.course.id, chapterId: ctx.chapter.id,
                         page: "flashcards", deckId: deck.id };
        render();
        UI.toast(`Deck ready — ${deck.cards.length} cards.`);
      } catch (err) {
        handleApiError(err);
      }
    };
  },

  async renderStudy(deckId) {
    const ctx = getContext();
    const ws = $("#workspace");
    ws.innerHTML = `<div class="page"><div class="spinner" style="margin:70px auto"></div></div>`;
    let deck;
    try {
      deck = (await API.getDeck(deckId)).deck;
    } catch (err) {
      State.active = { ...State.active, deckId: undefined };
      render();
      return handleApiError(err);
    }
    const course = (State.courses || []).find((c) => c.id === deck.courseId);
    const chapter = course && (course.chapters || []).find((ch) => ch.id === deck.chapterId);
    const cards = deck.cards || [];
    const study = deck.study || { order: cards.map((c) => c.id), index: 0, completed: false };
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    const learned = cards.filter((c) => c.learned).length;
    const percent = cards.length ? Math.round(learned / cards.length * 100) : 0;
    const completed = study.completed || cards.length === 0 ||
      cards.every((c) => c.learned);

    const renderCard = () => {
      if (completed) {
        ws.innerHTML = `
          <div class="page">
            ${breadcrumbHtml({ course, chapter }, "Flashcards")}
            <div class="deck-top">
              <div class="grow"><h1 style="margin:0">${esc(deck.name)}</h1></div>
              <div class="right">
                <button class="btn btn-small" id="back-decks">← Deck library</button>
                <button class="btn btn-small" id="edit-cards-btn">✎ Edit cards</button>
                <button class="btn btn-small" id="relearn-btn">↻ Relearn</button>
              </div>
            </div>
            <div class="card deck-done">
              <div class="big">🎉</div>
              <h2>Round complete — 100%</h2>
              <p class="text-soft">You marked every card correct. Relearn shuffles everything
                 back into the pool and resets the counters.</p>
              <div class="mini-stats">
                <span>${cards.length} cards</span>
                <span>${(deck.stats || {}).correct || 0} correct</span>
                <span>${(deck.stats || {}).wrong || 0} wrong</span>
                <span>${(deck.stats || {}).uncertain || 0} uncertain</span>
              </div>
            </div>
          </div>`;
        bindDeckTop();
        return;
      }
      const order = study.order || [];
      const currentId = order[Math.min(study.index || 0, order.length - 1)];
      const card = byId[currentId];
      if (!card) { ws.innerHTML = `<div class="page"><div class="error-banner">Deck state is empty.</div></div>`; return; }
      ws.innerHTML = `
        <div class="page">
          ${breadcrumbHtml({ course, chapter }, "Flashcards")}
          <div class="deck-top">
            <div class="grow">
              <h1 style="margin:0">${esc(deck.name)}</h1>
              <div class="text-soft" style="font-size:12.5px;margin-top:3px">
                Card ${cards.length - order.length + 1} of ${cards.length} left to learn this round
              </div>
            </div>
            <button class="btn btn-small" id="back-decks">← Library</button>
            <button class="btn btn-small" id="edit-cards-btn">✎ Edit cards</button>
            <button class="btn btn-small" id="relearn-btn">↻ Relearn</button>
          </div>
          <div class="card">
            <div class="mini-stats" style="margin-bottom:10px">
              <span class="mono" style="font-weight:750">Familiarity: ${percent}%</span>
              <span>${learned} of ${cards.length} known</span>
              <span>${(deck.stats || {}).correct || 0} ✓ · ${(deck.stats || {}).wrong || 0} ✗ ·
                     ${(deck.stats || {}).uncertain || 0} ~</span>
            </div>
            <div class="progress" id="deck-progress"><div style="width:${percent}%"></div></div>
          </div>
          <div class="card-stage">
            <div class="flashcard" id="flashcard" data-flipped="0">
              <div class="face front">
                <span class="front-tag">Front</span>
                <div class="front-text">${esc(card.front)}</div>
                <span class="flip-hint">tap to see answer</span>
              </div>
              <div class="face back">
                <span class="back-tag">Answer</span>
                <div class="back-text">${esc(card.back || "—")}</div>
              </div>
            </div>
          </div>
          <div class="verdict-bar">
            <button class="verdict-btn ok" data-verdict="correct" disabled>✓ Correct</button>
            <button class="verdict-btn mid" data-verdict="uncertain" disabled>~ Uncertain</button>
            <button class="verdict-btn wrong" data-verdict="wrong" disabled>✗ Wrong</button>
          </div>
          <p class="text-soft" style="text-align:center;font-size:12.5px">
            <span class="kbd">Space</span> flip ·
            <span class="kbd">1</span> correct · <span class="kbd">2</span> uncertain ·
            <span class="kbd">3</span> wrong</p>`;

      const cardEl = $("#flashcard");
      const verdictBtns = $$(".verdict-btn");
      let busyAnswer = false;
      const flip = (flipped) => {
        cardEl.classList.toggle("flipped", flipped);
        cardEl.dataset.flipped = flipped ? "1" : "0";
        verdictBtns.forEach((b) => { b.disabled = !flipped; });
      };
      cardEl.addEventListener("click", () => flip(cardEl.dataset.flipped !== "1"));
      const choose = async (verdict) => {
        if (busyAnswer || cardEl.dataset.flipped !== "1") return;
        busyAnswer = true;
        try {
          deck = (await API.answerDeck(deckId, card.id, verdict)).deck;
          document.removeEventListener("keydown", onKey);
          if (deck.study) { study.order = deck.study.order; study.index = deck.study.index; study.completed = deck.study.completed; }
          deck.stats = deck.stats || {};
          if (verdict === "correct") {
            UI.toast("Learned — moving on.");
          } else if (verdict === "wrong") {
            UI.toast("It will come back later.", "info");
          } else {
            UI.toast("Noted as uncertain — it will come back later.", "info");
          }
          Flashcards.renderStudy(deckId);
        } catch (err) {
          busyAnswer = false;
          handleApiError(err);
        }
      };
      verdictBtns.forEach((b) => b.addEventListener("click", () => choose(b.dataset.verdict)));
      if (State._studyKeyHandler) {
        document.removeEventListener("keydown", State._studyKeyHandler);
      }
      State._studyKeyHandler = onKey;
      document.addEventListener("keydown", onKey);
      function onKey(ev) {
        if (!$("#flashcard")) {
          document.removeEventListener("keydown", onKey);
          State._studyKeyHandler = null;
          return;
        }
        if (ev.key === " ") { ev.preventDefault(); flip(cardEl.dataset.flipped !== "1"); }
        else if (ev.key === "1") choose("correct");
        else if (ev.key === "2") choose("uncertain");
        else if (ev.key === "3") choose("wrong");
      }
      bindDeckTop();
    };

    const bindDeckTop = () => {
      const edit = $("#edit-cards-btn");
      if (edit) edit.onclick = () => Flashcards.editDeckModal(deck);
      const back = $("#back-decks");
      if (back) back.onclick = () => {
        State.active = { ...State.active, deckId: undefined };
        render();
      };
      const relearn = $("#relearn-btn");
      if (relearn) relearn.onclick = async () => {
        const yes = await UI.confirm("Relearn this deck?",
          "All cards go back into the random pool and the familiarity stats reset to 0%.",
          "Relearn", false);
        if (!yes) return;
        try {
          deck = (await API.relearnDeck(deckId)).deck;
          UI.toast("All cards are back in the pool.");
          Flashcards.renderStudy(deckId);
        } catch (err) { handleApiError(err); }
      };
    };
    renderCard();
  },
};

function previewPairs(content) {
  const pairs = [];
  const re = /\t|\s{2,}| \| | [-=] |::?|: /;
  for (const line of (content.lines || []).slice(0, 50)) {
    if (!line.trim()) continue;
    const parts = line.split(re, 2).map((s) => s.trim());
    if (parts.length > 1 && parts[0] && parts[1]) {
      pairs.push([parts[0], parts.slice(1).join(" ")]);
      continue;
    }
    // Korean word followed by English text: "학교 school"
    const firstHangul = line.search(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/);
    if (firstHangul >= 0) {
      let boundary = -1;
      for (let i = firstHangul; i < line.length; i++) {
        if (i > firstHangul && /[A-Za-z]/.test(line[i])) { boundary = i; break; }
      }
      if (boundary > 0) {
        const front = line.slice(0, boundary).trim();
        const back = line.slice(boundary).trim();
        if (front && back) pairs.push([front, back]);
      }
    }
  }
  return pairs;
}
