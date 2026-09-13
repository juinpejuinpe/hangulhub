import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorBox, formatDate, Spinner, useToast } from "../components/ui.jsx";
import { addFile, deleteFile, getCourse, listChapters, listFiles } from "../data.js";
import { useAsync } from "../hooks.js";
import { fileExtension, parseTextFile, SUPPORTED_EXTENSIONS } from "../lib/parsers.js";

export default function Files() {
  const { courseId, chapterId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(
    async () => {
      const [course, chapters, files] = await Promise.all([
        getCourse(user.uid, courseId),
        listChapters(user.uid, courseId),
        listFiles(user.uid, courseId, chapterId),
      ]);
      return { course, chapter: chapters.find((c) => c.id === chapterId), files };
    },
    [user.uid, courseId, chapterId]
  );

  async function save(name, text) {
    setBusy(true);
    try {
      const ext = fileExtension(name) || "txt";
      const content = parseTextFile(name, text);
      await addFile(user.uid, {
        courseId,
        chapterId,
        name,
        ext,
        kind: content.kind,
        content,
      });
      toast(`Added ${name}.`);
      await reload();
      return true;
    } catch (err) {
      toast(err.message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    await save(file.name, text);
  }

  async function onPaste(event) {
    event.preventDefault();
    if (!pasteText.trim()) return;
    const name = pasteName.trim() || "pasted text";
    const ok = await save(name.includes(".") ? name : `${name}.txt`, pasteText);
    if (ok) {
      setPasteName("");
      setPasteText("");
    }
  }

  async function remove(file) {
    if (!window.confirm(`Delete ${file.name}?`)) return;
    try {
      await deleteFile(user.uid, file.id);
      toast("File deleted.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  if (loading) return <div className="page"><Spinner label="Loading files…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const { course, chapter, files } = data;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/c/${courseId}`}>{course?.name}</Link> /{" "}
        <Link to={`/c/${courseId}/ch/${chapterId}`}>{chapter?.name}</Link> / Files
      </div>
      <h1>Files</h1>
      <p className="sub">
        Vocabulary tables and reading text. Supported here: {SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(", ")}.
      </p>

      <div className="card">
        <h3>Upload a file</h3>
        <label className="dropzone">
          <input
            type="file"
            accept=".txt,.md,.csv,.tsv"
            onChange={onUpload}
            disabled={busy}
          />
          <div className="dz-big">Choose a file</div>
          <div className="text-soft">
            A vocab list like <code>학교, school</code> per line becomes flashcards later.
          </div>
        </label>
      </div>

      <form className="card" onSubmit={onPaste}>
        <h3>Or paste text</h3>
        <div className="field">
          <label htmlFor="paste-name">Name</label>
          <input
            id="paste-name"
            className="input"
            value={pasteName}
            onChange={(event) => setPasteName(event.target.value)}
            placeholder="e.g. week2-vocab.txt"
          />
        </div>
        <div className="field">
          <label htmlFor="paste-text">Content</label>
          <textarea
            id="paste-text"
            className="input"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={"학교 school\n책 book\n친구 friend"}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !pasteText.trim()}>
          Save text
        </button>
      </form>

      <div className="card">
        <h3>Files in this chapter</h3>
        {files.length === 0 ? (
          <p className="text-soft">Nothing here yet.</p>
        ) : (
          files.map((file) => (
            <div className="file-block" key={file.id}>
              <div className="row-card">
                <span className="file-icon" aria-hidden="true">
                  {file.kind === "table" ? "📊" : "📄"}
                </span>
                <div className="grow">
                  <div className="title">{file.name}</div>
                  <div className="meta">
                    {file.kind === "table"
                      ? `${(file.content?.rows || []).length} rows`
                      : `${(file.content?.lines || []).length} lines`}{" "}
                    · added {formatDate(file.createdAt)}
                  </div>
                </div>
                <button type="button" className="btn btn-small btn-danger" onClick={() => remove(file)}>
                  Delete
                </button>
              </div>
              <details className="preview">
                <summary>Preview</summary>
                <FilePreview file={file} />
              </details>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FilePreview({ file }) {
  const content = file.content || {};
  if (content.kind === "table") {
    const headers = content.headers || [];
    return (
      <div className="table-scroll">
        <table className="map-preview">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {(content.rows || []).slice(0, 5).map((row, index) => (
              <tr key={index}>
                {headers.map((header) => <td key={header}>{row[header]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre className="text-preview">{(content.lines || []).slice(0, 8).join("\n")}</pre>
  );
}
