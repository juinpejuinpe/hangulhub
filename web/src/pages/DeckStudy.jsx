import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorBox, Spinner, useToast } from "../components/ui.jsx";
import { getDeck, relearnDeck, saveDeck } from "../data.js";
import { applyAnswer, currentCard, deckProgress, isComplete } from "../study.js";

export default function DeckStudy() {
  const { deckId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const found = await getDeck(user.uid, deckId);
        if (!alive) return;
        if (!found) throw new Error("Deck not found.");
        setDeck(found);
        setFlipped(false);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [deckId, user.uid]);

  const card = deck ? currentCard(deck) : null;
  const progress = deck ? deckProgress(deck) : { total: 0, learned: 0, percent: 0 };
  const complete = deck ? Boolean(deck.study?.completed) || isComplete(deck) : false;

  const answer = useCallback(
    async (verdict) => {
      if (!deck || !card || !flipped) return;
      const next = applyAnswer(deck, card.id, verdict);
      setDeck(next);
      setFlipped(false);
      if (verdict === "correct") toast("Learned — moving on.");
      else if (verdict === "wrong") toast("It will come back later.");
      else toast("Noted as uncertain — it will come back later.");
      try {
        await saveDeck(user.uid, next);
      } catch (err) {
        toast(err.message, "error");
      }
    },
    [deck, card, flipped, toast, user.uid]
  );

  useEffect(() => {
    function onKey(event) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === " ") {
        event.preventDefault();
        setFlipped((value) => !value);
      } else if (event.key === "1") answer("correct");
      else if (event.key === "2") answer("uncertain");
      else if (event.key === "3") answer("wrong");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [answer]);

  async function relearn() {
    if (!window.confirm("Put every card back into the random pool and reset the familiarity to 0%?")) return;
    try {
      const fresh = await relearnDeck(user.uid, deck);
      setDeck(fresh);
      setFlipped(false);
      toast("All cards are back in the pool.");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  if (loading) return <div className="page"><Spinner label="Loading deck…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!deck) return null;

  const back = `/c/${deck.courseId}/ch/${deck.chapterId}/flashcards`;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={back}>Flashcards</Link> / {deck.name}
      </div>
      <div className="deck-top">
        <div className="grow">
          <h1>{deck.name}</h1>
          <div className="text-soft small">
            {complete
              ? `All ${progress.total} cards learned`
              : `${deck.study?.order?.length ?? 0} of ${progress.total} cards left this round`}
          </div>
        </div>
        <Link className="btn btn-small" to={back}>← Library</Link>
        <button type="button" className="btn btn-small" onClick={relearn}>↻ Relearn</button>
      </div>

      <div className="card">
        <div className="mini-stats">
          <span className="mono strong">Familiarity: {progress.percent}%</span>
          <span>{progress.learned} of {progress.total} known</span>
          <span>
            {deck.stats?.correct || 0} ✓ · {deck.stats?.wrong || 0} ✗ · {deck.stats?.uncertain || 0} ~
          </span>
        </div>
        <div className="progress"><div style={{ width: `${progress.percent}%` }} /></div>
      </div>

      {complete || !card ? (
        <div className="card deck-done">
          <div className="big" aria-hidden="true">🎉</div>
          <h2>Round complete — 100%</h2>
          <p className="text-soft">
            You marked every card correct. Relearn shuffles everything back into the pool.
          </p>
        </div>
      ) : (
        <>
          <div className="card-stage">
            <div
              className={`flashcard${flipped ? " flipped" : ""}`}
              onClick={() => setFlipped((value) => !value)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") setFlipped((value) => !value);
              }}
            >
              <div className="face front">
                <span className="face-tag">Front</span>
                <div className="front-text">{card.front}</div>
                <span className="flip-hint">tap to see answer</span>
              </div>
              <div className="face back">
                <span className="face-tag">Answer</span>
                <div className="back-text">{card.back || "—"}</div>
              </div>
            </div>
          </div>
          <div className="verdict-bar">
            <button type="button" className="verdict-btn ok" disabled={!flipped} onClick={() => answer("correct")}>
              ✓ Correct
            </button>
            <button type="button" className="verdict-btn mid" disabled={!flipped} onClick={() => answer("uncertain")}>
              ~ Uncertain
            </button>
            <button type="button" className="verdict-btn wrong" disabled={!flipped} onClick={() => answer("wrong")}>
              ✗ Wrong
            </button>
          </div>
          <p className="text-soft center small">
            <span className="kbd">Space</span> flip · <span className="kbd">1</span> correct ·{" "}
            <span className="kbd">2</span> uncertain · <span className="kbd">3</span> wrong
          </p>
        </>
      )}
    </div>
  );
}
