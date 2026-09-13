import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorBox, formatDate, Spinner, useToast } from "../components/ui.jsx";
import {
  createChapter,
  deleteChapter,
  getCourse,
  listChapters,
  listDecks,
  listFiles,
  updateCourse,
} from "../data.js";
import { useAsync } from "../hooks.js";

export default function Course() {
  const { courseId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [chapterName, setChapterName] = useState("");
  const [editTarget, setEditTarget] = useState(null);

  const { data, loading, error, reload } = useAsync(
    async () => {
      const [course, chapters, files, decks] = await Promise.all([
        getCourse(user.uid, courseId),
        listChapters(user.uid, courseId),
        listFiles(user.uid, courseId),
        listDecks(user.uid, courseId),
      ]);
      return { course, chapters, files, decks };
    },
    [user.uid, courseId]
  );

  if (loading) return <div className="page"><Spinner label="Loading course…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data?.course) return <div className="page"><ErrorBox error="Course not found." /></div>;

  const { course, chapters, files, decks } = data;

  async function addChapter(event) {
    event.preventDefault();
    if (!chapterName.trim()) return;
    try {
      await createChapter(user.uid, courseId, chapterName);
      setChapterName("");
      toast("Chapter added.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function removeChapter(chapter) {
    if (!window.confirm(`Delete “${chapter.name}” and everything inside it?`)) return;
    try {
      await deleteChapter(user.uid, courseId, chapter.id);
      toast("Chapter deleted.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function saveTarget() {
    try {
      await updateCourse(user.uid, courseId, { target: editTarget });
      setEditTarget(null);
      toast("Saved.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="page">
      <div className="deck-top">
        <div className="grow">
          <h1>{course.name}</h1>
          <p className="sub">
            {editTarget === null ? (
              <>
                Target: <b>{course.target || "not set"}</b>{" "}
                <button type="button" className="btn-ghost" onClick={() => setEditTarget(course.target || "")}>
                  edit
                </button>
              </>
            ) : (
              <span className="inline-form">
                <input
                  className="input"
                  value={editTarget}
                  onChange={(event) => setEditTarget(event.target.value)}
                  placeholder="e.g. TOPIK level 2, 140+"
                />
                <button type="button" className="btn btn-small btn-primary" onClick={saveTarget}>Save</button>
                <button type="button" className="btn btn-small" onClick={() => setEditTarget(null)}>Cancel</button>
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="num">{chapters.length}</div><div className="label">chapters</div></div>
        <div className="stat"><div className="num">{files.length}</div><div className="label">files</div></div>
        <div className="stat"><div className="num">{decks.length}</div><div className="label">flashcard decks</div></div>
      </div>

      <form className="card" onSubmit={addChapter}>
        <h3>Add a chapter</h3>
        <div className="inline-form">
          <input
            className="input"
            value={chapterName}
            onChange={(event) => setChapterName(event.target.value)}
            placeholder="e.g. Week 1 vocabulary"
          />
          <button type="submit" className="btn btn-primary" disabled={!chapterName.trim()}>Add</button>
        </div>
      </form>

      <div className="card">
        <h3>Chapters</h3>
        {chapters.length === 0 ? (
          <p className="text-soft">No chapters yet.</p>
        ) : (
          chapters.map((chapter) => (
            <div className="row-card" key={chapter.id}>
              <span aria-hidden="true">📂</span>
              <div className="grow">
                <Link className="title linkish" to={`/c/${courseId}/ch/${chapter.id}`}>
                  {chapter.name}
                </Link>
                <div className="meta">
                  {files.filter((f) => f.chapterId === chapter.id).length} files ·{" "}
                  {decks.filter((d) => d.chapterId === chapter.id).length} decks · created{" "}
                  {formatDate(chapter.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-small btn-danger"
                onClick={() => removeChapter(chapter)}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
