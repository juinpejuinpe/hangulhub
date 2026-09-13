import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { convertPaper, generateMcq, generateMock, hasApiKey } from "../ai.js";
import { useAuth } from "../auth.jsx";
import FilePicker from "../components/FilePicker.jsx";
import { ErrorBox, Spinner, useToast } from "../components/ui.jsx";
import { createTest, getCourse, listChapters, listFiles } from "../data.js";
import { useAsync } from "../hooks.js";

const KINDS = {
  mcq: {
    title: "AI Multiple Choice",
    blurb:
      "Build a quiz from this chapter's files, or leave them out for a general grammar quiz at your course's target level.",
    cta: "Generate quiz",
    papersOnly: false,
    busyLabel: "Writing questions…",
  },
  mock: {
    title: "AI Mock Paper",
    blurb:
      "A brand-new paper modelled on your past papers: same sections, same marks, new questions.",
    cta: "Generate mock paper",
    papersOnly: true,
    busyLabel: "Building a full mock paper — this can take a minute…",
  },
  paper: {
    title: "Paper → Online Test",
    blurb:
      "Turn an uploaded past paper into an interactive test, keeping its real sections and question counts.",
    cta: "Convert to online test",
    papersOnly: true,
    busyLabel: "Reading the paper and rebuilding it online…",
  },
};

export default function GenerateTest() {
  const { courseId, chapterId, kind } = useParams();
  const config = KINDS[kind] || KINDS.mcq;
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [selected, setSelected] = useState(null);
  const [count, setCount] = useState(10);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data, loading, error: loadError } = useAsync(
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

  const files = data?.files || [];
  const suggested = useMemo(() => {
    const papers = files.filter((file) => file.kind === "text");
    return config.papersOnly && papers.length ? papers : files;
  }, [files, config.papersOnly]);

  // Pre-select the sensible sources once the chapter loads.
  useEffect(() => {
    if (selected === null && files.length) {
      setSelected(new Set(suggested.map((file) => file.id)));
    }
  }, [files, suggested, selected]);

  async function generate() {
    const chosen = files.filter((file) => selected?.has(file.id));
    if (!chosen.length && kind !== "mcq") {
      return toast("Choose at least one source file.", "error");
    }
    if (!hasApiKey()) {
      return toast("Add your DeepSeek API key in AI settings first (⚙ in the top bar).", "error");
    }
    setBusy(true);
    setError("");
    try {
      let content;
      if (kind === "mcq") {
        content = await generateMcq({ files: chosen, count, prompt, target: data?.course?.target });
      } else if (kind === "paper") {
        content = await convertPaper({ files: chosen, prompt });
      } else {
        content = await generateMock({ files: chosen, prompt, target: data?.course?.target });
      }
      const testId = await createTest(user.uid, {
        kind: kind || "mcq",
        courseId,
        chapterId,
        files: chosen,
        title: content.title,
        prompt,
        target: data?.course?.target || "",
        content,
      });
      toast(`${content.title} is ready.`);
      navigate(`/test/${testId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><Spinner label="Loading chapter…" /></div>;
  if (loadError) return <div className="page"><ErrorBox error={loadError} /></div>;

  const questionCount = (kind === "mcq" ? count : 0);

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/c/${courseId}`}>{data.course?.name}</Link> /{" "}
        <Link to={`/c/${courseId}/ch/${chapterId}`}>{data.chapter?.name}</Link> / {config.title}
      </div>
      <h1>{config.title}</h1>
      <p className="sub">{config.blurb}</p>

      {hasApiKey() ? null : (
        <div className="error-banner">
          No DeepSeek API key yet — open <b>AI settings</b> (the ⚙ in the top bar) and paste
          your key. It stays in this browser.
        </div>
      )}

      <div className="card">
        <FilePicker
          files={files}
          selected={selected || new Set()}
          onChange={setSelected}
          label="Source files"
          emptyHint={
            kind === "mcq"
              ? "No files needed — without sources the quiz comes from general knowledge at your target level."
              : "Upload the past paper first (Files → Upload), then come back here."
          }
        />

        {kind === "mcq" ? (
          <div className="field">
            <label htmlFor="mcq-count">How many questions?</label>
            <input
              id="mcq-count"
              className="input"
              type="number"
              min="1"
              max="200"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="ai-prompt">
            {kind === "mqc" ? "Focus" : "Anything specific? (optional)"}
          </label>
          <textarea
            id="ai-prompt"
            className="input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              kind === "mcq"
                ? "e.g. past-tense endings and particles, TOPIK I level"
                : kind === "paper"
                  ? "e.g. keep the reading section only"
                  : "e.g. focus on the reading section and make it slightly harder"
            }
          />
        </div>

        <ErrorBox error={error} />
        <button type="button" className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? config.busyLabel : config.cta}
        </button>
        {busy ? <span className="text-soft small" style={{ marginLeft: 10 }}>Leave this tab open.</span> : null}
      </div>
    </div>
  );
}
