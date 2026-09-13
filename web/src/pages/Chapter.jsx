import { Link, useParams } from "react-router-dom";
import { hasApiKey } from "../ai.js";
import { useAuth } from "../auth.jsx";
import { ErrorBox, formatDate, Spinner, useToast } from "../components/ui.jsx";
import { deleteTest, getCourse, listChapters, listDecks, listFiles, listTests } from "../data.js";
import { useAsync } from "../hooks.js";

const TEST_KINDS = {
  mcq: "AI Multiple Choice",
  converted: "Paper → Online Test",
  mock: "AI Mock Paper",
};

export default function Chapter() {
  const { courseId, chapterId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    async () => {
      const [course, chapters, files, decks, tests] = await Promise.all([
        getCourse(user.uid, courseId),
        listChapters(user.uid, courseId),
        listFiles(user.uid, courseId, chapterId),
        listDecks(user.uid, courseId, chapterId),
        listTests(user.uid, courseId, chapterId),
      ]);
      return { course, chapter: chapters.find((c) => c.id === chapterId), files, decks, tests };
    },
    [user.uid, courseId, chapterId]
  );

  if (loading) return <div className="page"><Spinner label="Loading chapter…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data?.chapter) return <div className="page"><ErrorBox error="Chapter not found." /></div>;

  const { course, chapter, files, decks, tests } = data;
  const base = `/c/${courseId}/ch/${chapterId}`;

  async function removeTest(test) {
    if (!window.confirm(`Delete “${test.title}” and its attempts?`)) return;
    try {
      await deleteTest(user.uid, test.id);
      toast("Test deleted.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/c/${courseId}`}>{course?.name}</Link> / {chapter.name}
      </div>
      <h1>{chapter.name}</h1>
      <p className="sub">
        {files.length} files · {decks.length} flashcard decks · {tests.length} AI tests
      </p>

      {hasApiKey() ? null : (
        <div className="text-soft small" style={{ marginBottom: 14 }}>
          AI features need a DeepSeek key — add one via the ⚙ in the top bar.
        </div>
      )}

      <div className="module-grid">
        <Link className="module-card" to={`${base}/files`}>
          <div className="mc-icon" aria-hidden="true">📁</div>
          <div className="mc-title">Files</div>
          <div className="mc-desc">Upload past papers, spreadsheets, Word docs or notes.</div>
        </Link>
        <Link className="module-card" to={`${base}/flashcards`}>
          <div className="mc-icon" aria-hidden="true">🃏</div>
          <div className="mc-title">Flashcards</div>
          <div className="mc-desc">Write cards by hand or build a deck from a file.</div>
        </Link>
        <Link className="module-card" to={`${base}/test/mcq`}>
          <div className="mc-icon" aria-hidden="true">❓</div>
          <div className="mc-title">AI Multiple Choice</div>
          <div className="mc-desc">Grammar quizzes — from your files or from scratch.</div>
        </Link>
        <Link className="module-card" to={`${base}/test/paper`}>
          <div className="mc-icon" aria-hidden="true">📝</div>
          <div className="mc-title">Paper → Online Test</div>
          <div className="mc-desc">Turn an uploaded past paper into a sit-and-score test.</div>
        </Link>
        <Link className="module-card" to={`${base}/test/mock`}>
          <div className="mc-icon" aria-hidden="true">📄</div>
          <div className="mc-title">AI Mock Paper</div>
          <div className="mc-desc">A fresh paper modelled on your past papers.</div>
        </Link>
        <Link className="module-card" to={`${base}/chat`}>
          <div className="mc-icon" aria-hidden="true">💬</div>
          <div className="mc-title">Ask AI</div>
          <div className="mc-desc">Chat about this chapter's material.</div>
        </Link>
      </div>

      <div className="card">
        <h3>Decks in this chapter</h3>
        {decks.length === 0 ? (
          <p className="text-soft">No decks yet.</p>
        ) : (
          decks.map((deck) => (
            <div className="row-card" key={deck.id}>
              <div className="grow">
                <Link className="title linkish" to={`/deck/${deck.id}`}>{deck.name}</Link>
                <div className="meta">
                  {(deck.cards || []).length} cards ·{" "}
                  {deck.source === "manual" ? "written by you" : "from files"}
                </div>
              </div>
              <Link className="btn btn-small btn-primary" to={`/deck/${deck.id}`}>Study</Link>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>AI tests in this chapter</h3>
        {tests.length === 0 ? (
          <p className="text-soft">No tests yet.</p>
        ) : (
          tests.map((test) => {
            const last = (test.attempts || []).slice(-1)[0];
            return (
              <div className="row-card" key={test.id}>
                <div className="grow">
                  <Link className="title linkish" to={`/test/${test.id}`}>{test.title}</Link>
                  <div className="meta">
                    {TEST_KINDS[test.kind] || "Test"} · created {formatDate(test.createdAt)}
                    {last ? ` · last score ${last.result?.score ?? 0}/${last.result?.maxScore ?? "?"}` : " · not attempted"}
                  </div>
                </div>
                <Link className="btn btn-small btn-primary" to={`/test/${test.id}`}>
                  {(test.attempts || []).length ? "Retake" : "Sit test"}
                </Link>
                <button type="button" className="btn btn-small btn-danger" onClick={() => removeTest(test)}>
                  Delete
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
