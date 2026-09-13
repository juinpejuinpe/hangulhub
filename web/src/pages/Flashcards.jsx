import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { blankRow, CardRows, cardsFromRows, rowsFromCards } from "../components/CardRows.jsx";
import { ErrorBox, formatDate, Modal, Spinner, useToast } from "../components/ui.jsx";
import {
  createDeck,
  deleteDeck,
  getCourse,
  listChapters,
  listDecks,
  listFiles,
  pairsFromFiles,
  updateDeckCards,
} from "../data.js";
import { useAsync } from "../hooks.js";
import { pairsFromPreview } from "../lib/parsers.js";

const eligible = (file) => file.kind === "table" || ["txt", "md"].includes(file.ext);

export default function Flashcards() {
  const { courseId, chapterId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [rows, setRows] = useState([blankRow(), blankRow(), blankRow()]);
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(
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

  const ready = cardsFromRows(rows).length;

  async function saveManual() {
    const cards = cardsFromRows(rows);
    if (!cards.length) return toast("Add at least one card first.", "error");
    setSaving(true);
    try {
      const deckName = name.trim() || "My cards";
      await createDeck(user.uid, {
        courseId,
        chapterId,
        name: deckName,
        pairs: cards.map((card) => [card.front, card.back]),
        source: "manual",
      });
      setName("");
      setRows([blankRow(), blankRow(), blankRow()]);
      toast(`Saved “${deckName}”.`);
      await reload();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeDeck(deck) {
    if (!window.confirm(`Delete the deck “${deck.name}”?`)) return;
    try {
      await deleteDeck(user.uid, deck.id);
      toast("Deck deleted.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  if (loading) return <div className="page"><Spinner label="Loading flashcards…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const { course, chapter, files, decks } = data;
  const usable = files.filter(eligible);

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/c/${courseId}`}>{course?.name}</Link> /{" "}
        <Link to={`/c/${courseId}/ch/${chapterId}`}>{chapter?.name}</Link> / Flashcards
      </div>
      <h1>Flashcards</h1>
      <p className="sub">Write your own cards, or build a deck from a file — then study in random order.</p>

      <div className="card">
        <h3>✍️ Write your own cards</h3>
        <p className="text-soft small">
          Front is what you&apos;re tested on, back is the answer. Blank fronts are skipped. Press{" "}
          <span className="kbd">Enter</span> in a back box to move to the next card — at the end of
          the list it adds a row.
        </p>
        <div className="field">
          <label htmlFor="deck-name">Deck name</label>
          <input
            id="deck-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Words I keep forgetting"
          />
        </div>
        <CardRows rows={rows} setRows={setRows} />
        <div className="manual-actions">
          <button type="button" className="btn btn-small" onClick={() => setRows((list) => [...list, blankRow()])}>
            ＋ Add row
          </button>
          <span className="text-soft">
            {ready ? `${ready} card${ready === 1 ? "" : "s"} ready` : "Type at least one card"}
          </span>
          <button type="button" className="btn btn-primary" onClick={saveManual} disabled={saving || !ready}>
            {saving ? "Saving…" : "Save deck"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Build a deck from files</h3>
        <p className="text-soft small">
          {usable.length
            ? "Each row becomes a card (front = the word, back = its meaning)."
            : "This chapter has no vocabulary files yet."}
        </p>
        <button type="button" className="btn btn-primary" disabled={!usable.length} onClick={() => setBuilding(true)}>
          ＋ Build from files…
        </button>
        {usable.length ? null : (
          <Link className="btn" to={`/c/${courseId}/ch/${chapterId}/files`} style={{ marginLeft: 8 }}>
            Add files
          </Link>
        )}
      </div>

      <div className="card">
        <h3>Deck library</h3>
        {decks.length === 0 ? (
          <p className="text-soft">No decks yet — write one above, or build a deck from files.</p>
        ) : (
          decks.map((deck) => {
            const total = (deck.cards || []).length;
            const learned = (deck.cards || []).filter((card) => card.learned).length;
            const percent = total ? Math.round((learned / total) * 100) : 0;
            return (
              <div className="row-card" key={deck.id}>
                <div className="deck-score">
                  <div className="mono">{percent}%</div>
                  <div className="text-soft tiny">{learned}/{total} known</div>
                </div>
                <div className="grow">
                  <div className="title">{deck.name}</div>
                  <div className="meta">
                    {total} cards · {deck.source === "manual" ? "written by you" : "from files"} ·
                    created {formatDate(deck.createdAt)}
                  </div>
                </div>
                <button type="button" className="btn btn-small" onClick={() => setEditing(deck)}>
                  ✎ Edit cards
                </button>
                <Link className="btn btn-small btn-primary" to={`/deck/${deck.id}`}>Study</Link>
                <button type="button" className="btn btn-small btn-danger" onClick={() => removeDeck(deck)}>
                  Delete
                </button>
              </div>
            );
          })
        )}
      </div>

      {building ? (
        <BuildModal
          files={usable}
          onClose={() => setBuilding(false)}
          onCreate={async (deckName, selected, mapping) => {
            try {
              const pairs = pairsFromFiles(selected, mapping);
              if (!pairs.length) throw new Error("No word → meaning pairs were detected in those files.");
              await createDeck(user.uid, { courseId, chapterId, name: deckName, pairs });
              setBuilding(false);
              toast(`Deck ready — ${pairs.length} cards.`);
              reload();
            } catch (err) {
              toast(err.message, "error");
            }
          }}
        />
      ) : null}

      {editing ? (
        <EditModal
          deck={editing}
          onClose={() => setEditing(null)}
          onSave={async (deckName, nextRows) => {
            const cards = cardsFromRows(nextRows);
            if (!cards.length) return toast("Keep at least one card with a front side.", "error");
            try {
              await updateDeckCards(user.uid, editing, cards, deckName);
              setEditing(null);
              toast(`Saved ${cards.length} card${cards.length === 1 ? "" : "s"}.`);
              reload();
            } catch (err) {
              toast(err.message, "error");
            }
          }}
        />
      ) : null}
    </div>
  );
}

function BuildModal({ files, onClose, onCreate }) {
  const [deckName, setDeckName] = useState("");
  const [chosen, setChosen] = useState(() => new Set(files.map((file) => file.id)));
  const [mapping, setMapping] = useState(() => {
    const initial = {};
    files.forEach((file) => {
      if (file.kind !== "table") return;
      const headers = file.content?.headers || [];
      const guessFront = headers.find((h) => /word|korean|hangul|term|vocab/i.test(h)) || headers[0];
      const guessesBack = headers.filter((h) => h !== guessFront && /meaning|def|english|trans|pron|reading/i.test(h));
      initial[file.id] = {
        front: guessFront,
        back: guessesBack.length ? guessesBack : headers.filter((h) => h !== guessFront).slice(0, 1),
      };
    });
    return initial;
  });

  const selected = files.filter((file) => chosen.has(file.id));

  function toggle(id) {
    setChosen((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBack(fileId, column) {
    setMapping((map) => {
      const entry = map[fileId] || { front: "", back: [] };
      const back = entry.back.includes(column)
        ? entry.back.filter((c) => c !== column)
        : [...entry.back, column];
      return { ...map, [fileId]: { ...entry, back } };
    });
  }

  return (
    <Modal
      title="Build a deck from files"
      onClose={onClose}
      wide
      actions={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected.length}
            onClick={() => onCreate(deckName, selected, mapping)}
          >
            Build deck
          </button>
        </>
      )}
    >
      <div className="field">
        <label htmlFor="build-name">Deck name</label>
        <input
          id="build-name"
          className="input"
          value={deckName}
          onChange={(event) => setDeckName(event.target.value)}
          placeholder="e.g. Week 1 vocab"
        />
      </div>

      {files.map((file) => {
        const headers = file.content?.headers || [];
        const entry = mapping[file.id];
        return (
          <div className="card" key={file.id}>
            <label className="check-row">
              <input type="checkbox" checked={chosen.has(file.id)} onChange={() => toggle(file.id)} />
              <b>{file.name}</b>
              {file.kind === "table"
                ? <span className="text-soft"> · {(file.content?.rows || []).length} rows</span>
                : <span className="pill">line pairs auto-detected</span>}
            </label>

            {file.kind === "table" && chosen.has(file.id) ? (
              <div className="grid2">
                <div className="field">
                  <label htmlFor={`front-${file.id}`}>Front column</label>
                  <select
                    id={`front-${file.id}`}
                    className="input"
                    value={entry?.front || headers[0] || ""}
                    onChange={(event) =>
                      setMapping((map) => ({
                        ...map,
                        [file.id]: { ...map[file.id], front: event.target.value },
                      }))
                    }
                  >
                    {headers.map((header) => <option key={header}>{header}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Back columns</label>
                  <div className="chip-row">
                    {headers.map((header) => (
                      <label className={`chip${entry?.back?.includes(header) ? " selected" : ""}`} key={header}>
                        <input
                          type="checkbox"
                          checked={entry?.back?.includes(header) || false}
                          onChange={() => toggleBack(file.id, header)}
                        />
                        {header}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {file.kind !== "table" && chosen.has(file.id) ? (
              <div className="pair-list">
                {pairsFromPreview(file.content).map(([front, back], index) => (
                  <div className="pair-preview" key={index}>
                    <b>{front}</b>
                    <span>{back}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </Modal>
  );
}

function EditModal({ deck, onClose, onSave }) {
  const [deckName, setDeckName] = useState(deck.name || "");
  const [rows, setRows] = useState(() => {
    const existing = rowsFromCards(deck.cards);
    return existing.length ? existing : [blankRow()];
  });
  const ready = cardsFromRows(rows).length;

  return (
    <Modal
      title="Edit cards"
      onClose={onClose}
      wide
      actions={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready}
            onClick={() => onSave(deckName, rows)}
          >
            {ready ? `Save ${ready} card${ready === 1 ? "" : "s"}` : "Save changes"}
          </button>
        </>
      )}
    >
      <p className="text-soft small">
        Type over any text, add cards, or remove the ones you no longer need. Cards you keep hold on
        to their learning progress.
      </p>
      <div className="field">
        <label htmlFor="edit-name">Deck name</label>
        <input
          id="edit-name"
          className="input"
          value={deckName}
          onChange={(event) => setDeckName(event.target.value)}
        />
      </div>
      <CardRows rows={rows} setRows={setRows} scrollable />
      <button type="button" className="btn btn-small" onClick={() => setRows((list) => [...list, blankRow()])}>
        ＋ Add row
      </button>
    </Modal>
  );
}
