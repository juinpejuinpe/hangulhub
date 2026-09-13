"use strict";

const Views = {
  course(course) {
    const ws = $("#workspace");
    const chapters = course.chapters || [];
    ws.innerHTML = `
      <div class="page">
        <div class="toolbar">
          <div>
            <h1>${esc(course.name)}</h1>
            <p class="sub">${course.target
              ? `Target: <b>${esc(course.target)}</b>`
              : "No target exam set yet — edit the course to add one."}
              · created ${fmtDate(course.createdAt)}</p>
          </div>
          <div class="right">
            <button class="btn btn-small" data-edit-course>Edit course</button>
          </div>
        </div>

        <div class="stat-row" style="margin-bottom:18px">
          <div class="stat"><div class="num">${course.stats?.chapters ?? chapters.length}</div>
            <div class="label">chapters</div></div>
          <div class="stat"><div class="num">${course.stats?.files ?? 0}</div>
            <div class="label">files</div></div>
          <div class="stat"><div class="num">${course.stats?.decks ?? 0}</div>
            <div class="label">flashcard decks</div></div>
          <div class="stat"><div class="num">${course.stats?.tests ?? 0}</div>
            <div class="label">AI tests</div></div>
        </div>

        <div class="card">
          <div class="toolbar" style="margin-bottom:6px">
            <h3 style="margin:0">Chapters</h3>
            <button class="btn btn-primary btn-small" id="course-add-chapter">＋ Add chapter</button>
          </div>
          ${chapters.length ? chapters.map((ch) => `
            <div class="row-card" style="cursor:pointer" data-open-chapter="${ch.id}">
              <span style="font-size:20px">📂</span>
              <div class="grow">
                <div class="title">${esc(ch.name)}</div>
                <div class="meta">${(ch.files || []).length} file${(ch.files || []).length === 1 ? "" : "s"}</div>
              </div>
              <button class="btn btn-small" data-open-chapter-btn="${ch.id}">Open</button>
            </div>`).join("")
        : `<p class="text-soft">No chapters yet. Add one, then drop your files into it.</p>`}
        </div>

        <div class="module-grid">
          <button class="module-card" data-act="mock">
            <div class="mc-icon">📄</div>
            <div class="mc-title">AI Mock Paper</div>
            <div class="mc-desc">Generate a brand-new mock paper from every past paper in this course.</div>
          </button>
          <button class="module-card" data-act="files">
            <div class="mc-icon">📁</div>
            <div class="mc-title">Browse files</div>
            <div class="mc-desc">See every file across the chapters.</div>
          </button>
        </div>
      </div>`;

    ws.querySelector("#course-add-chapter").onclick = async () => {
      const name = await UI.prompt("New chapter", "", "e.g. Past papers 2024");
      if (!name) return;
      try {
        await API.addChapter(course.id, name);
        await refreshTree();
        State.active = { courseId: course.id, page: "course" };
        render();
      } catch (err) { handleApiError(err); }
    };
    ws.querySelector("[data-edit-course]").onclick = () => courseMenu(course.id);
    $$("[data-open-chapter]", ws).forEach((el) =>
      el.addEventListener("click", () => openChapter(course.id, el.dataset.openChapter)));
    $$("[data-open-chapter-btn]", ws).forEach((el) =>
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openChapter(course.id, el.dataset.openChapterBtn);
      }));
    ws.querySelector('[data-act="mock"]').onclick = () => {
      State.active = { courseId: course.id, page: "mock" };
      render();
    };
    ws.querySelector('[data-act="files"]').onclick = () => {
      State.active = { courseId: course.id, page: "chapter" };
      render();
      UI.toast("Open a chapter to manage its files.");
    };
  },

  async chapter(chapter) {
    const course = findCourse(chapter.courseId);
    if (!course) return noContextHtml();
    const ws = $("#workspace");
    ws.innerHTML = `
      <div class="page">
        <div class="breadcrumb">
          <a data-goto-course="${course.id}">${esc(course.name)}</a> / ${esc(chapter.name)}
        </div>
        <div class="toolbar">
          <div><h1>${esc(chapter.name)}</h1>
          <p class="sub">${(chapter.files || []).length} file${(chapter.files || []).length === 1 ? "" : "s"}
             in this chapter.</p></div>
          <button class="btn btn-primary btn-small" data-goto-files>＋ Add files</button>
        </div>

        <div class="module-grid" style="margin-bottom:20px">
          ${[
            ["files", "📁", "Files", "Upload vocabulary lists and past papers."],
            ["flashcards", "🃏", "Flashcards", "Build a deck from vocab lists and study it."],
            ["mcq", "❓", "AI Multiple Choice", "Grammar quizzes — with or without files."],
            ["paper", "📝", "Paper → Online Test", "Convert a past paper into an online test."],
            ["mock", "📄", "AI Mock Paper", "New mock papers from your past papers."],
            ["chat", "💬", "Ask AI", "Chat about the files in this chapter."],
          ].map(([key, icon, title, desc]) => `
            <button class="module-card" data-module="${key}">
              <div class="mc-icon">${icon}</div>
              <div class="mc-title">${title}</div>
              <div class="mc-desc">${desc}</div>
            </button>`).join("")}
        </div>

        <div id="chapter-content">
          <div class="card">
            <div class="toolbar" style="margin-bottom:8px">
              <h3 style="margin:0">Recently added files</h3>
              <button class="btn btn-small" data-goto-files>Manage all</button>
            </div>
            <div id="chapter-files"></div>
          </div>
          <div class="grid2">
            <div class="card"><h3>Decks</h3><div id="chapter-decks"></div></div>
            <div class="card"><h3>AI tests</h3><div id="chapter-tests"></div></div>
          </div>
        </div>
      </div>`;

    const goto = (page, extra = {}) => {
      State.active = { courseId: course.id, chapterId: chapter.id, page, ...extra };
      render();
    };
    ws.querySelector("[data-goto-course]").onclick = () => {
      State.active = { courseId: course.id, page: "course" };
      render();
    };
    $$("[data-goto-files]").forEach((b) => b.onclick = () => goto("files"));
    $$("[data-module]").forEach((b) => b.onclick = () => goto(b.dataset.module));

    const filesBox = $("#chapter-files");
    const files = (chapter.files || []).slice().reverse().slice(0, 6);
    filesBox.innerHTML = files.length ? files.map((f) => `
      <div class="file-row">
        <span class="file-icon">${fileVisual(f)}</span>
        <div class="file-main">
          <div class="file-name">${esc(f.name)}</div>
          <div class="file-meta">${esc(fileDesc(f))}</div>
        </div>
      </div>`).join("") : '<p class="text-soft">No files yet.</p>';

    const decksBox = $("#chapter-decks");
    const testsBox = $("#chapter-tests");
    try {
      const data = await API.get(`/api/listings?${objToQs({
        courseId: course.id, chapterId: chapter.id })}`);
      const decks = data.decks || [];
      decksBox.innerHTML = decks.length ? decks.slice(-4).reverse().map((d) => `
        <div class="row-card" style="padding:10px 12px">
          <div class="grow">
            <div class="title">${esc(d.name)}</div>
            <div class="meta">${d.percent}% familiar · ${d.total} cards</div>
          </div>
          <button class="btn btn-small" data-study-deck="${d.id}">Study</button>
        </div>`).join("") : '<p class="text-soft" style="font-size:13px">No decks yet.</p>';
      $$("[data-study-deck]", decksBox).forEach((b) => b.onclick = () =>
        goto("flashcards", { deckId: b.dataset.studyDeck }));

      const tests = (data.tests || []).filter((t) => t.chapterId === chapter.id);
      testsBox.innerHTML = tests.length ? tests.slice(-4).reverse().map((t) => `
        <div class="row-card" style="padding:10px 12px">
          <div class="grow">
            <div class="title">${esc(t.title)}</div>
            <div class="meta">${t.attempts ? `last ${fmtScore(t.lastScore, t.lastMax)}` : "not started"}</div>
          </div>
          <button class="btn btn-small" data-test="${t.id}" data-kind="${t.kind}">
            ${t.attempts ? "Retake" : "Start"}</button>
        </div>`).join("") : '<p class="text-soft" style="font-size:13px">No tests yet.</p>';
      $$("[data-test]", testsBox).forEach((b) => b.onclick = () => {
        const page = { mcq: "mcq", converted: "paper", mock: "mock" }[b.dataset.kind] || "mcq";
        goto(page, { testId: b.dataset.test, attemptId: undefined });
      });
    } catch (err) { handleApiError(err); }
  },
};

function openChapter(courseId, chapterId) {
  State.active = { courseId, chapterId, page: "chapter" };
  render();
}
