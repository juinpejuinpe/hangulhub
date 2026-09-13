import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorBox, Spinner } from "../components/ui.jsx";
import { getCourse, listChapters, listDecks, listFiles } from "../data.js";
import { useAsync } from "../hooks.js";

export default function Chapter() {
  const { courseId, chapterId } = useParams();
  const { user } = useAuth();
  const { data, loading, error } = useAsync(
    async () => {
      const [course, chapters, files, decks] = await Promise.all([
        getCourse(user.uid, courseId),
        listChapters(user.uid, courseId),
        listFiles(user.uid, courseId, chapterId),
        listDecks(user.uid, courseId, chapterId),
      ]);
      return { course, chapter: chapters.find((c) => c.id === chapterId), files, decks };
    },
    [user.uid, courseId, chapterId]
  );

  if (loading) return <div className="page"><Spinner label="Loading chapter…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data?.chapter) return <div className="page"><ErrorBox error="Chapter not found." /></div>;

  const { course, chapter, files, decks } = data;
  const base = `/c/${courseId}/ch/${chapterId}`;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/c/${courseId}`}>{course?.name}</Link> / {chapter.name}
      </div>
      <h1>{chapter.name}</h1>
      <p className="sub">{files.length} files · {decks.length} flashcard decks</p>

      <div className="module-grid">
        <Link className="module-card" to={`${base}/files`}>
          <div className="mc-icon" aria-hidden="true">📁</div>
          <div className="mc-title">Files</div>
          <div className="mc-desc">Upload or paste vocabulary lists and reading material.</div>
        </Link>
        <Link className="module-card" to={`${base}/flashcards`}>
          <div className="mc-icon" aria-hidden="true">🃏</div>
          <div className="mc-title">Flashcards</div>
          <div className="mc-desc">Write cards by hand or build a deck from a file.</div>
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
    </div>
  );
}
