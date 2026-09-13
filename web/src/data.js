// Firestore data layer. Everything is scoped to the signed-in user:
//   users/{uid}/courses/{courseId}
//   users/{uid}/courses/{courseId}/chapters/{chapterId}
//   users/{uid}/files/{fileId}    (courseId + chapterId as fields)
//   users/{uid}/decks/{deckId}    (cards + study state in the document)
//
// Lists are ordered in the browser rather than with orderBy() so the app needs
// no composite indexes.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { newCard, resetStudy, shuffle } from "./study";

const withId = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });

function timeOf(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

const byCreatedAt = (a, b) => timeOf(a.createdAt) - timeOf(b.createdAt);

const coursesCol = (uid) => collection(db, "users", uid, "courses");
const courseRef = (uid, id) => doc(db, "users", uid, "courses", id);
const chaptersCol = (uid, courseId) => collection(courseRef(uid, courseId), "chapters");
const chapterRef = (uid, courseId, id) => doc(chaptersCol(uid, courseId), id);
const filesCol = (uid) => collection(db, "users", uid, "files");
const fileRef = (uid, id) => doc(filesCol(uid), id);
const decksCol = (uid) => collection(db, "users", uid, "decks");
const deckRef = (uid, id) => doc(decksCol(uid), id);
const testsCol = (uid) => collection(db, "users", uid, "tests");
const testRef = (uid, id) => doc(testsCol(uid), id);
const chatsCol = (uid) => collection(db, "users", uid, "chats");
const chatRef = (uid, chapterId) => doc(chatsCol(uid), chapterId);

async function deleteAll(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/* ----------------------------------------------------------------- courses */

export async function listCourses(uid) {
  const snap = await getDocs(coursesCol(uid));
  return snap.docs.map(withId).sort(byCreatedAt);
}

export async function getCourse(uid, courseId) {
  const snap = await getDoc(courseRef(uid, courseId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createCourse(uid, { name, target = "" }) {
  const ref = await addDoc(coursesCol(uid), {
    name: name.trim() || "Untitled course",
    target: target.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCourse(uid, courseId, patch) {
  await updateDoc(courseRef(uid, courseId), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteCourse(uid, courseId) {
  const [chapters, files, decks] = await Promise.all([
    listChapters(uid, courseId),
    listFiles(uid, courseId),
    listDecks(uid, courseId),
  ]);
  await deleteAll([
    ...chapters.map((c) => chapterRef(uid, courseId, c.id)),
    ...files.map((f) => fileRef(uid, f.id)),
    ...decks.map((d) => deckRef(uid, d.id)),
  ]);
  await deleteDoc(courseRef(uid, courseId));
}

/* ---------------------------------------------------------------- chapters */

export async function listChapters(uid, courseId) {
  const snap = await getDocs(chaptersCol(uid, courseId));
  return snap.docs.map(withId).sort(byCreatedAt);
}

export async function createChapter(uid, courseId, name) {
  const ref = await addDoc(chaptersCol(uid, courseId), {
    name: name.trim() || "Untitled chapter",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameChapter(uid, courseId, chapterId, name) {
  await updateDoc(chapterRef(uid, courseId, chapterId), { name: name.trim() });
}

export async function deleteChapter(uid, courseId, chapterId) {
  const [files, decks] = await Promise.all([
    listFiles(uid, courseId, chapterId),
    listDecks(uid, courseId, chapterId),
  ]);
  await deleteAll([
    ...files.map((f) => fileRef(uid, f.id)),
    ...decks.map((d) => deckRef(uid, d.id)),
  ]);
  await deleteDoc(chapterRef(uid, courseId, chapterId));
}

/* ------------------------------------------------------------------- files */

export async function listFiles(uid, courseId, chapterId = null) {
  const clauses = [where("courseId", "==", courseId)];
  if (chapterId) clauses.push(where("chapterId", "==", chapterId));
  const snap = await getDocs(query(filesCol(uid), ...clauses));
  return snap.docs.map(withId).sort(byCreatedAt);
}

export async function addFile(uid, file) {
  const ref = await addDoc(filesCol(uid), {
    courseId: file.courseId,
    chapterId: file.chapterId,
    name: file.name,
    ext: file.ext,
    kind: file.kind,
    content: file.content,
    note: file.note || "",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteFile(uid, fileId) {
  await deleteDoc(fileRef(uid, fileId));
}

/* ------------------------------------------------------------------- decks */

export async function listDecks(uid, courseId, chapterId = null) {
  const clauses = [where("courseId", "==", courseId)];
  if (chapterId) clauses.push(where("chapterId", "==", chapterId));
  const snap = await getDocs(query(decksCol(uid), ...clauses));
  return snap.docs.map(withId).sort(byCreatedAt);
}

export async function getDeck(uid, deckId) {
  const snap = await getDoc(deckRef(uid, deckId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createDeck(uid, { courseId, chapterId, name, pairs, source = "files" }) {
  const cards = pairs.map(([front, back]) => newCard(front, back));
  if (!cards.length) throw new Error("No cards could be built from that input.");
  const deck = resetStudy({ cards, stats: undefined });
  const ref = await addDoc(decksCol(uid), {
    name: name.trim() || "Vocabulary deck",
    courseId,
    chapterId,
    source,
    cards: deck.cards,
    study: deck.study,
    stats: deck.stats,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function saveDeck(uid, deck) {
  await updateDoc(deckRef(uid, deck.id), {
    cards: deck.cards,
    study: deck.study,
    stats: deck.stats || {},
    updatedAt: serverTimestamp(),
  });
}

export async function updateDeckCards(uid, deck, cards, name) {
  const existing = new Map((deck.cards || []).map((card) => [card.id, card]));
  const next = [];
  for (const item of cards) {
    const front = String(item.front || "").trim();
    if (!front) continue;
    const back = String(item.back || "").trim();
    const previous = item.id ? existing.get(item.id) : null;
    next.push(previous ? { ...previous, front, back } : newCard(front, back));
  }
  if (!next.length) throw new Error("A deck needs at least one card with a front side.");

  const keep = new Set(next.map((c) => c.id));
  const order = (deck.study?.order || []).filter((id) => keep.has(id));
  const queued = new Set(order);
  for (const card of next) {
    if (!queued.has(card.id)) {
      order.splice(Math.floor(Math.random() * (order.length + 1)), 0, card.id);
      queued.add(card.id);
    }
  }

  const updated = {
    ...deck,
    name: name?.trim() || deck.name,
    cards: next,
    study: {
      order,
      index: Math.min(deck.study?.index || 0, Math.max(0, order.length - 1)),
      completed: next.every((c) => c.learned),
    },
  };
  await updateDoc(deckRef(uid, deck.id), {
    name: updated.name,
    cards: updated.cards,
    study: updated.study,
    updatedAt: serverTimestamp(),
  });
  return updated;
}

export async function deleteDeck(uid, deckId) {
  await deleteDoc(deckRef(uid, deckId));
}

export async function relearnDeck(uid, deck) {
  const fresh = resetStudy(deck);
  await saveDeck(uid, { ...deck, ...fresh });
  return { ...deck, ...fresh };
}

/* ------------------------------------------------------------------- tests */

export async function listTests(uid, courseId, chapterId = null) {
  const clauses = [where("courseId", "==", courseId)];
  if (chapterId) clauses.push(where("chapterId", "==", chapterId));
  const snap = await getDocs(query(testsCol(uid), ...clauses));
  return snap.docs.map(withId).sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
}

export async function getTest(uid, testId) {
  const snap = await getDoc(testRef(uid, testId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createTest(uid, { kind, courseId, chapterId, files, title, prompt, target, content }) {
  const ref = await addDoc(testsCol(uid), {
    kind,
    courseId,
    chapterId: chapterId || "",
    fileIds: (files || []).map((file) => file.id),
    fileNames: Object.fromEntries((files || []).map((file) => [file.id, file.name])),
    title: title || content?.title || "Untitled test",
    prompt: prompt || "",
    target: target || "",
    content,
    attempts: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function addAttempt(uid, test, attempt) {
  const attempts = [...(test.attempts || []), attempt];
  await updateDoc(testRef(uid, test.id), { attempts, updatedAt: serverTimestamp() });
  return attempts;
}

export async function deleteTest(uid, testId) {
  await deleteDoc(testRef(uid, testId));
}

/* -------------------------------------------------------------------- chat */

export async function getChat(uid, chapterId) {
  const snap = await getDoc(chatRef(uid, chapterId));
  return snap.exists() ? snap.data() : { messages: [] };
}

export async function saveChat(uid, chapterId, messages) {
  await setDoc(
    chatRef(uid, chapterId),
    { messages, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/* ------------------------------------------------------------------ helpers */

export function pairsFromFiles(files, mapping = {}) {
  const pairs = [];
  const seen = new Set();
  for (const file of files) {
    const content = file.content || {};
    let draft = [];
    if (content.kind === "table") {
      const front = mapping[file.id]?.front || content.headers?.[0];
      const backs = mapping[file.id]?.back?.length
        ? mapping[file.id].back
        : content.headers?.slice(1);
      if (!front) continue;
      draft = rowsToPairsLocal(content, front, backs || []);
    } else {
      draft = textToPairsLocal(content);
    }
    for (const [front, back] of draft) {
      const key = `${front.toLowerCase()}\u0000${back.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([front, back]);
    }
  }
  return pairs;
}

function rowsToPairsLocal(content, frontColumn, backColumns) {
  const headers = content.headers || [];
  const out = [];
  for (const row of content.rows || []) {
    const front = String(row[frontColumn] ?? "").trim();
    if (!front) continue;
    const back = backColumns
      .filter((column) => headers.includes(column))
      .map((column) => String(row[column] ?? "").trim())
      .filter(Boolean)
      .join("\n");
    out.push([front, back]);
  }
  return out;
}

function textToPairsLocal(content) {
  const out = [];
  const delimiters = /\t|\s{2,}| \| | [-=] |::?|: /;
  const hangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
  const latin = /[A-Za-z]/;
  for (const line of content.lines || []) {
    if (!line) continue;
    const parts = line.split(delimiters).map((part) => part.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      out.push([parts[0], parts.slice(1).join(" ")]);
      continue;
    }
    const first = line.search(hangul);
    if (first >= 0) {
      let boundary = -1;
      for (let i = first + 1; i < line.length; i += 1) {
        if (latin.test(line[i])) {
          boundary = i;
          break;
        }
      }
      if (boundary > 0) {
        const front = line.slice(0, boundary).trim();
        const back = line.slice(boundary).trim();
        if (front && back) out.push([front, back]);
      }
    }
  }
  return out;
}

export { shuffle };
