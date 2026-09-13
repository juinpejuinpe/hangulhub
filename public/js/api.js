"use strict";

async function apiFetch(url, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (options.json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.json);
  }
  let resp;
  try {
    resp = await fetch(url, init);
  } catch {
    throw new Error("Cannot reach the local app server. Is it still running?");
  }
  let data = null;
  try { data = await resp.json(); } catch { /* empty body */ }
  if (!resp.ok) {
    const msg = (data && data.error) || `Request failed (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

const API = {
  get: (url) => apiFetch(url),
  post: (url, json) => apiFetch(url, { method: "POST", json }),
  patch: (url, json) => apiFetch(url, { method: "PATCH", json }),
  del: (url) => apiFetch(url, { method: "DELETE" }),

  bootstrap: () => API.get("/api/bootstrap"),

  addCourse: (name, target) => API.post("/api/courses", { name, target }),
  updateCourse: (id, patch) => API.patch(`/api/courses/${id}`, patch),
  deleteCourse: (id) => API.del(`/api/courses/${id}`),

  addChapter: (courseId, name) =>
    API.post(`/api/courses/${courseId}/chapters`, { name }),
  renameChapter: (courseId, chapterId, name) =>
    API.patch(`/api/courses/${courseId}/chapters/${chapterId}`, { name }),
  deleteChapter: (courseId, chapterId) =>
    API.del(`/api/courses/${courseId}/chapters/${chapterId}`),

  uploadFile: (courseId, chapterId, file, note = "") => {
    const form = new FormData();
    form.append("file", file);
    if (note) form.append("note", note);
    return apiFetch(`/api/courses/${courseId}/chapters/${chapterId}/files`,
                    { method: "POST", body: form });
  },
  pasteFile: (courseId, chapterId, text, name) =>
    API.post(`/api/courses/${courseId}/chapters/${chapterId}/paste`, { text, name }),
  filePreview: (fileId) => API.get(`/api/files/${fileId}/preview`),
  deleteFile: (courseId, chapterId, fileId) =>
    API.del(`/api/courses/${courseId}/chapters/${chapterId}/files/${fileId}`),

  buildDeck: (payload) => API.post("/api/decks", payload),
  createManualDeck: (payload) => API.post("/api/decks/manual", payload),
  getDeck: (deckId) => API.get(`/api/decks/${deckId}`),
  updateDeckCards: (deckId, cards, name) =>
    API.patch(`/api/decks/${deckId}/cards`, { cards, name }),
  answerDeck: (deckId, cardId, verdict) =>
    API.post(`/api/decks/${deckId}/answer`, { cardId, verdict }),
  relearnDeck: (deckId) => API.post(`/api/decks/${deckId}/relearn`, {}),
  deleteDeck: (deckId) => API.del(`/api/decks/${deckId}`),

  generateMcq: (payload) => API.post("/api/ai/mcq", payload),
  convertPaper: (payload) => API.post("/api/ai/paper/convert", payload),
  generateMock: (payload) => API.post("/api/ai/mock", payload),
  getTest: (testId) => API.get(`/api/tests/${testId}`),
  deleteTest: (testId) => API.del(`/api/tests/${testId}`),
  submitAttempt: (testId, answers) =>
    API.post(`/api/tests/${testId}/attempts`, { answers }),

  getChat: (chapterId) => API.get(`/api/chats/${chapterId}`),
  resetChat: (chapterId) => API.del(`/api/chats/${chapterId}`),
  sendChat: (courseId, chapterId, fileIds, text) =>
    API.post("/api/chats/message", { courseId, chapterId, fileIds, text }),

  getSettings: () => API.get("/api/settings"),
  saveSettings: (patch) => API.post("/api/settings", patch),
  testSettings: () => API.post("/api/settings/test", {}),
};
