import { useEffect, useRef, useState } from "react";

export function blankRow() {
  return { key: Math.random().toString(36).slice(2), id: undefined, front: "", back: "" };
}

export function rowsFromCards(cards) {
  return (cards || []).map((card) => ({
    key: card.id,
    id: card.id,
    front: card.front,
    back: card.back || "",
  }));
}

export function cardsFromRows(rows) {
  return rows
    .filter((row) => row.front.trim())
    .map((row) => ({ id: row.id, front: row.front.trim(), back: row.back.trim() }));
}

/**
 * The front/back editor shared by "Write your own cards" and "Edit cards".
 * Enter in a front box jumps to its back; Enter in a back box moves to the next
 * card, adding a row when you reach the end.
 */
export function CardRows({ rows, setRows, scrollable = false }) {
  const containerRef = useRef(null);
  const [focusIndex, setFocusIndex] = useState(null);

  useEffect(() => {
    if (focusIndex === null) return;
    const row = containerRef.current?.querySelectorAll(".manual-row")[focusIndex];
    row?.querySelector(".m-front")?.focus();
    setFocusIndex(null);
  }, [focusIndex, rows]);

  const rowAt = (index) =>
    containerRef.current?.querySelectorAll(".manual-row")[index] || null;

  function update(index, field, value) {
    setRows((list) =>
      list.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addAfter(index) {
    setRows((list) => {
      const next = [...list];
      next.splice(index + 1, 0, blankRow());
      return next;
    });
    setFocusIndex(index + 1);
  }

  function removeAt(index) {
    setRows((list) => (list.length <= 1 ? [blankRow()] : list.filter((_, i) => i !== index)));
  }

  function onKeyDown(event, index) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.target.dataset.field === "front") {
      rowAt(index)?.querySelector(".m-back")?.focus();
      return;
    }
    if (index < rows.length - 1) {
      rowAt(index + 1)?.querySelector(".m-front")?.focus();
    } else {
      addAfter(index);
    }
  }

  return (
    <>
      <div className="manual-head">
        <span>Front</span>
        <span>Back</span>
        <span />
      </div>
      <div className={`manual-rows${scrollable ? " scroll" : ""}`} ref={containerRef}>
        {rows.map((row, index) => (
          <div className="manual-row" key={row.key}>
            <input
              className="input m-front"
              data-field="front"
              value={row.front}
              placeholder="Korean word or question"
              onChange={(event) => update(index, "front", event.target.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            />
            <input
              className="input m-back"
              data-field="back"
              value={row.back}
              placeholder="Meaning or answer"
              onChange={(event) => update(index, "back", event.target.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            />
            <button
              type="button"
              className="rm"
              onClick={() => removeAt(index)}
              aria-label="Remove this card"
              title="Remove this card"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
