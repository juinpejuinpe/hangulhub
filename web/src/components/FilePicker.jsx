import { useMemo } from "react";

/**
 * Chip list for choosing which chapter files an AI request should read.
 * Selection is a Set of file ids.
 */
export default function FilePicker({ files, selected, onChange, emptyHint, label = "Source files" }) {
  const usable = useMemo(() => files.filter((file) => file.content), [files]);
  const allIds = usable.map((file) => file.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  if (!usable.length) {
    return (
      <div className="field">
        <label>{label}</label>
        <p className="text-soft small">{emptyHint || "No files in this chapter yet."}</p>
      </div>
    );
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="chip-row">
        {usable.map((file) => (
          <label className={`chip${selected.has(file.id) ? " selected" : ""}`} key={file.id}>
            <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggle(file.id)} />
            {file.name}
          </label>
        ))}
      </div>
      <div className="picker-actions">
        <button type="button" className="btn-ghost" onClick={() => onChange(new Set(allIds))}>
          {allSelected ? "All selected" : "Select all"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => onChange(new Set())}>
          Clear
        </button>
      </div>
    </div>
  );
}
