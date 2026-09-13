"use strict";

const State = {
  courses: [],
  active: {},
};

function findCourse(courseId) {
  return (State.courses || []).find((c) => c.id === courseId);
}

function getContext() {
  const active = State.active || {};
  const course = findCourse(active.courseId);
  if (!course) return { course: null, chapter: null };
  const chapter = (course.chapters || [])
    .find((ch) => ch.id === active.chapterId);
  return {
    course,
    chapter: chapter ? { ...chapter, courseId: course.id } : null,
  };
}

function breadcrumbHtml(ctx, current) {
  if (!ctx || !ctx.course) return "";
  return `
    <div class="breadcrumb">
      <a data-goto-course="${ctx.course.id}">${esc(ctx.course.name)}</a>
      ${ctx.chapter ? ` / <a data-goto-chapter="${ctx.chapter.id}">${esc(ctx.chapter.name)}</a>` : ""}
      ${current ? ` / ${esc(current)}` : ""}
    </div>`;
}

function noContextHtml() {
  return `
    <div class="page">
      <div class="card"><h3>Pick a chapter</h3>
      <p class="text-soft">Open a course and chapter from the left panel to use this function.</p></div>
    </div>`;
}

function render() {
  const active = State.active || {};
  Tree.render();
  const ws = $("#workspace");
  const route = async () => {
    const course = findCourse(active.courseId);
    if (!course) {
      if (!State.courses.length) {
        ws.innerHTML = document.getElementById("welcome").outerHTML;
        bindWelcome();
      } else {
        State.active = { courseId: State.courses[0].id, page: "course" };
        render();
      }
      return;
    }
    if (active.page === "course") {
      Views.course(course);
      return;
    }
    const chapter = (course.chapters || []).find((ch) => ch.id === active.chapterId);
    if (!chapter) {
      State.active = { courseId: course.id, page: "course" };
      render();
      return;
    }
    const ctx = { course, chapter: { ...chapter, courseId: course.id } };
    const map = {
      chapter: () => Views.chapter(ctx.chapter),
      files: () => Files.render(),
      flashcards: () => Flashcards.render(),
      mcq: () => Exams.mcqPage(ctx),
      paper: () => Exams.paperPage(ctx),
      mock: () => Exams.mockPage(ctx),
      chat: () => Chat.render(),
    };
    const fn = map[active.page] || map.chapter;
    await fn();
  };
  ws.scrollTop = 0;
  route();
}

async function refreshTree() {
  try {
    const { courses } = await API.bootstrap();
    State.courses = courses;
    Tree.render();
  } catch (err) {
    UI.toast(err.message, "error", 6000);
  }
}

async function refreshAll() {
  await refreshTree();
}

function bindWelcome() {
  const btn = $("#welcome-add-course") || $("#add-course-btn");
  if (btn) btn.onclick = addCourseModal;
}

function addCourseModal() {
  const m = UI.modal(`
    <h2>New course</h2>
    <div class="field">
      <label>Course name</label>
      <input class="input" id="new-course-name" placeholder="e.g. TOPIK II preparation" autofocus>
    </div>
    <div class="field">
      <label>Target exam / level (optional)</label>
      <input class="input" id="new-course-target" placeholder="e.g. TOPIK II, aiming for Level 5">
      <div class="hint">Used by the AI to pitch questions at the right level.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" data-action="create">Create course</button>
    </div>`);
  m.$("[data-action=create]").onclick = async () => {
    const name = m.$("#new-course-name").value.trim();
    if (!name) { UI.toast("Give the course a name.", "error"); return; }
    try {
      const { course } = await API.addCourse(name, m.$("#new-course-target").value.trim());
      m.close();
      await refreshAll();
      State.active = { courseId: course.id, page: "course" };
      render();
    } catch (err) { handleApiError(err); }
  };
}

function settingsModal() {
  const m = UI.modal(`
    <h2>AI settings</h2>
    <p class="text-soft" style="font-size:13px;margin-top:-8px">
      Connection details for the DeepSeek API. The key is stored only on this computer.</p>
    <div class="field">
      <label>API key</label>
      <input class="input" type="password" id="set-key" placeholder="Leave blank to keep current key">
      <div class="hint" id="key-hint"></div>
    </div>
    <div class="field">
      <label>Base URL</label>
      <input class="input" id="set-url" placeholder="https://api.deepseek.com/v1">
    </div>
    <div class="grid2">
      <div class="field">
        <label>Model</label>
        <input class="input" id="set-model" placeholder="deepseek-v4-flash">
      </div>
      <div class="field">
        <label>Temperature (0–1.5)</label>
        <input class="input" type="number" id="set-temp" min="0" max="1.5" step="0.1">
      </div>
    </div>
    <div id="set-error"></div>
    <div class="modal-actions">
      <button class="btn" data-action="test">Test connection</button>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" data-action="save">Save</button>
    </div>`);

  const showError = (msg) => {
    $("#set-error").innerHTML = msg
      ? `<div class="error-banner">${esc(msg)}</div>` : "";
  };
  API.getSettings().then(({ settings }) => {
    m.$("#key-hint").textContent = settings.apiKeySet
      ? `A key is set (${settings.apiKeyMasked}). Enter a new one to replace it.`
      : "No key set yet.";
    m.$("#set-url").value = settings.base_url || "";
    m.$("#set-model").value = settings.model || "";
    m.$("#set-temp").value = settings.temperature ?? 0.3;
  }).catch(handleApiError);

  m.$("[data-action=save]").onclick = async () => {
    const patch = {
      base_url: m.$("#set-url").value.trim(),
      model: m.$("#set-model").value.trim(),
      temperature: parseFloat(m.$("#set-temp").value),
    };
    const key = m.$("#set-key").value.trim();
    if (key) patch.api_key = key;
    try {
      await API.saveSettings(patch);
      m.close();
      UI.toast("Settings saved.");
    } catch (err) { handleApiError(err); }
  };
  m.$("[data-action=test]").onclick = async () => {
    showError("");
    const badge = UI.busy("Testing the connection…");
    try {
      const patch = {
        base_url: m.$("#set-url").value.trim(),
        model: m.$("#set-model").value.trim(),
      };
      const key = m.$("#set-key").value.trim();
      if (key) patch.api_key = key;
      await API.saveSettings(patch);
      const data = await API.testSettings();
      badge();
      UI.toast(`Connection works — model replied: ${data.reply}`);
    } catch (err) {
      badge();
      showError(err.message);
    }
  };
}

function bindGlobal() {
  $("#add-course-btn").onclick = addCourseModal;
  $("#settings-btn").onclick = settingsModal;
  document.addEventListener("click", (ev) => {
    const courseLink = ev.target.closest("[data-goto-course]");
    if (courseLink) {
      State.active = { courseId: courseLink.dataset.gotoCourse, page: "course" };
      render();
      return;
    }
    const chapterLink = ev.target.closest("[data-goto-chapter]");
    if (chapterLink) {
      const active = State.active;
      State.active = {
        courseId: active.courseId,
        chapterId: chapterLink.dataset.gotoChapter,
        page: "chapter",
      };
      render();
    }
  });
}

async function init() {
  bindGlobal();
  bindTree();
  try {
    const { courses } = await API.bootstrap();
    State.courses = courses;
    if (courses.length) {
      State.active = { courseId: courses[0].id, page: "course" };
    }
  } catch (err) {
    UI.toast(err.message, "error", 8000);
  }
  render();
}

document.addEventListener("DOMContentLoaded", init);
