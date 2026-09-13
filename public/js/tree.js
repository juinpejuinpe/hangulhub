"use strict";

const MODULES = [
  { key: "files", icon: "📁", label: "Files" },
  { key: "flashcards", icon: "🃏", label: "Flashcards" },
  { key: "mcq", icon: "❓", label: "AI Multiple Choice" },
  { key: "paper", icon: "📝", label: "Paper → Online Test" },
  { key: "mock", icon: "📄", label: "AI Mock Paper" },
  { key: "chat", icon: "💬", label: "Ask AI" },
];

const Tree = {
  render() {
    const courses = State.courses || [];
    const el = $("#course-tree");
    if (!courses.length) {
      el.innerHTML = `
        <div class="sidebar-empty">
          No courses yet.<br>Create one to start organising your exam prep.
        </div>`;
      return;
    }
    const active = State.active || {};
    el.innerHTML = courses.map((course) => {
      const courseOpen = active.courseId === course.id ||
        (!active.courseId && courses.length === 1);
      const chapters = course.chapters || [];
      const chapHtml = chapters.map((ch) => {
        const chapterOpen = active.courseId === course.id &&
          (active.chapterId === ch.id || (active.page === "chapter" && !active.chapterId));
        const modules = MODULES.map((m) => {
          const isActive = active.courseId === course.id &&
            active.chapterId === ch.id && active.page === m.key;
          return `<button class="tree-module ${isActive ? "active" : ""}"
                    data-act="module" data-course="${course.id}"
                    data-chapter="${ch.id}" data-module="${m.key}">
                    <span class="m-icon">${m.icon}</span>${m.label}</button>`;
        }).join("");
        return `
          <div class="tree-chapter">
            <div class="tree-chapter-head ${chapterOpen ? "open" : ""}"
                 data-act="chapter" data-course="${course.id}" data-chapter="${ch.id}">
              <span class="caret">▶</span>
              <span class="tree-chapter-name" title="${esc(ch.name)}">${esc(ch.name)}</span>
              <span class="tree-count">${(ch.files || []).length}</span>
              <button class="tree-more" data-act="chapter-menu"
                      data-course="${course.id}" data-chapter="${ch.id}" title="Chapter actions">⋯</button>
            </div>
            ${chapterOpen ? `<div class="tree-modules">${modules}</div>` : ""}
          </div>`;
      }).join("");
      return `
        <div class="tree-course">
          <div class="tree-course-head ${courseOpen ? "open" : ""}"
               data-act="course" data-course="${course.id}">
            <span class="caret">▶</span>
            <span class="tree-course-name" title="${esc(course.name)}">${esc(course.name)}</span>
            <span class="tree-count">${chapters.length} ch</span>
            <button class="tree-more" data-act="course-menu" data-course="${course.id}"
                    title="Course actions">⋯</button>
          </div>
          <div class="tree-chapters">
            ${chapHtml}
            <button class="tree-module" style="color:var(--brand)"
                    data-act="add-chapter" data-course="${course.id}">＋ Add chapter</button>
          </div>
        </div>`;
    }).join("");
  },
};

function bindTree() {
  const tree = $("#course-tree");
  tree.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const courseId = btn.dataset.course;
    const chapterId = btn.dataset.chapter;

    if (act === "course") {
      State.active = { courseId, page: "course" };
      render();
    } else if (act === "chapter") {
      State.active = { courseId, chapterId, page: "chapter" };
      render();
    } else if (act === "module") {
      State.active = { courseId, chapterId, page: btn.dataset.module };
      render();
    } else if (act === "add-chapter") {
      const name = await UI.prompt("New chapter", "", "e.g. Past papers 2024, Vocabulary set 1");
      if (!name) return;
      try {
        await API.addChapter(courseId, name);
        await refreshTree();
        State.active = { courseId, page: "course" };
        render();
        UI.toast("Chapter added.");
      } catch (err) { handleApiError(err); }
    } else if (act === "course-menu") {
      courseMenu(courseId);
    } else if (act === "chapter-menu") {
      chapterMenu(courseId, chapterId);
    }
  });
}

function courseMenu(courseId) {
  const course = (State.courses || []).find((c) => c.id === courseId);
  if (!course) return;
  const m = UI.modal(`
    <h2>${esc(course.name)}</h2>
    <div class="field">
      <label>Target exam / level</label>
      <input class="input" id="course-target" value="${esc(course.target || "")}"
             placeholder="e.g. TOPIK II — aiming for Level 5">
    </div>
    <div class="inline-actions">
      <button class="btn btn-primary" data-action="save">Save</button>
      <button class="btn btn-danger" data-action="delete">Delete course</button>
    </div>
    <p class="text-soft" style="font-size:12.5px;margin-top:12px">
      Deleting removes this course, its files, decks and tests from the local data folder.</p>`);
  m.$("[data-action=save]").onclick = async () => {
    const target = m.$("#course-target").value.trim();
    try {
      await API.updateCourse(courseId, { target });
      m.close();
      await refreshTree();
      UI.toast("Course updated.");
    } catch (err) { handleApiError(err); }
  };
  m.$("[data-action=delete]").onclick = async () => {
    const yes = await UI.confirm("Delete this course?",
      `“${course.name}” and everything inside it will be removed. This cannot be undone.`,
      "Delete course");
    if (!yes) return;
    try {
      await API.deleteCourse(courseId);
      m.close();
      if (State.active && State.active.courseId === courseId) {
        State.active = {};
      }
      await refreshTree();
      UI.toast("Course deleted.");
    } catch (err) { handleApiError(err); }
  };
}

function chapterMenu(courseId, chapterId) {
  const course = (State.courses || []).find((c) => c.id === courseId);
  const chapter = course && (course.chapters || []).find((ch) => ch.id === chapterId);
  if (!course || !chapter) return;
  const m = UI.modal(`
    <h2>Chapter: ${esc(chapter.name)}</h2>
    <div class="field">
      <label>Rename chapter</label>
      <input class="input" id="chapter-name" value="${esc(chapter.name)}">
    </div>
    <div class="inline-actions">
      <button class="btn btn-primary" data-action="rename">Rename</button>
      <button class="btn btn-danger" data-action="delete">Delete chapter</button>
    </div>`);
  m.$("[data-action=rename]").onclick = async () => {
    const name = m.$("#chapter-name").value.trim();
    if (!name) return;
    try {
      await API.renameChapter(courseId, chapterId, name);
      m.close();
      await refreshTree();
      UI.toast("Chapter renamed.");
    } catch (err) { handleApiError(err); }
  };
  m.$("[data-action=delete]").onclick = async () => {
    const yes = await UI.confirm("Delete this chapter?",
      `“${chapter.name}” and its files, decks and tests will be removed.`,
      "Delete chapter");
    if (!yes) return;
    try {
      await API.deleteChapter(courseId, chapterId);
      m.close();
      if (State.active && State.active.courseId === courseId &&
          State.active.chapterId === chapterId) {
        State.active = { courseId, page: "course" };
      }
      await refreshTree();
      UI.toast("Chapter deleted.");
    } catch (err) { handleApiError(err); }
  };
}
