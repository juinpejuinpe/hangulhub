import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { flattenQuestions, gradeMcq, gradeTest, totalMarks } from "../ai.js";
import { useAuth } from "../auth.jsx";
import { ErrorBox, Spinner, useToast } from "../components/ui.jsx";
import { addAttempt, getTest } from "../data.js";

const TYPE_LABEL = {
  mc: "Multiple choice",
  fill: "Fill the blank",
  short: "Short answer",
  writing: "Writing",
};

export default function TestRunner() {
  const { testId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [test, setTest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const found = await getTest(user.uid, testId);
        if (!alive) return;
        if (!found) throw new Error("Test not found.");
        setTest(found);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [testId, user.uid]);

  const questions = useMemo(() => flattenQuestions(test?.content), [test]);
  const missing = questions.filter((q) => answers[q.id] === undefined || answers[q.id] === "").length;

  function setAnswer(id, value) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  async function submit() {
    if (missing && !window.confirm(
      `Submit anyway? ${missing} question${missing === 1 ? " is" : "s are"} unanswered — they'll be marked wrong.`
    )) return;
    setGrading(true);
    setError("");
    try {
      const graded =
        test.kind === "mcq" ? gradeMcq(test.content, answers) : await gradeTest(test, answers);
      const attempt = {
        id: `att_${Math.random().toString(36).slice(2, 12)}`,
        submittedAt: new Date().toISOString(),
        answers,
        result: graded,
      };
      const attempts = await addAttempt(user.uid, test, attempt);
      setTest((current) => ({ ...current, attempts }));
      setResult(graded);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message);
    } finally {
      setGrading(false);
    }
  }

  if (loading) return <div className="page"><Spinner label="Loading test…" /></div>;
  if (!test) return <div className="page"><ErrorBox error={error || "Test not found."} /></div>;

  const backTo = `/c/${test.courseId}/ch/${test.chapterId}`;
  const marks = totalMarks(test.content);
  const attempts = test.attempts || [];

  if (result) return <ResultView test={test} result={result} backTo={backTo} onRetake={() => { setResult(null); setAnswers({}); }} />;

  return (
    <div className="page">
      <div className="breadcrumb"><Link to={backTo}>← Back to chapter</Link></div>
      <div className="toolbar">
        <div>
          <h1>{test.title}</h1>
          <p className="sub">
            {test.content?.instructions}
            {marks ? ` · ${marks} marks` : ""}
          </p>
        </div>
      </div>

      {(test.content?.sections || []).map((section, sectionIndex) => (
        <div className="section-block" key={sectionIndex}>
          <div className="section-head">
            <h3>{section.title || `Section ${sectionIndex + 1}`}</h3>
            {section.instructions ? <div className="marks">{section.instructions}</div> : null}
            {section.marks ? <div className="marks">{section.marks} marks</div> : null}
          </div>
          {(section.questions || []).map((q, questionIndex) => (
            <div className="q-item" key={q.id}>
              <div className="q-prompt">{q.prompt}</div>
              <div className="q-meta">
                <span>{TYPE_LABEL[q.type] || q.type}</span>
                {q.marks ? <span>{q.marks} mark{q.marks > 1 ? "s" : ""}</span> : null}
                <span>Question {questionIndex + 1}</span>
              </div>
              {q.type === "mc" ? (
                <div className="mc-options">
                  {(q.options || []).map((option, optionIndex) => (
                    <label
                      className={`mc-option${answers[q.id] === String(optionIndex) ? " selected" : ""}`}
                      key={optionIndex}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={optionIndex}
                        checked={answers[q.id] === String(optionIndex)}
                        onChange={() => setAnswer(q.id, String(optionIndex))}
                      />
                      <span className="letter">{String.fromCharCode(65 + optionIndex)}.</span>
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  className="input"
                  value={answers[q.id] || ""}
                  onChange={(event) => setAnswer(q.id, event.target.value)}
                  placeholder={q.type === "writing" ? "Write your answer here…" : "Type your answer…"}
                />
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="card" style={{ textAlign: "center" }}>
        <p className="text-soft">
          {missing
            ? `${missing} question${missing === 1 ? "" : "s"} still unanswered — they'll be marked wrong if you submit now.`
            : "All questions answered — ready to submit."}
        </p>
        <ErrorBox error={error} />
        <button type="button" className="btn btn-primary btn-wide" onClick={submit} disabled={grading}>
          {grading
            ? "Grading…"
            : test.kind === "mcq"
              ? "Finish and see my score"
              : "Finish and get AI grading"}
        </button>
      </div>

      {attempts.length ? (
        <div className="card">
          <h3>Previous attempts</h3>
          {attempts.map((attempt) => (
            <div className="row-card" key={attempt.id}>
              <div className="grow">
                <div className="title">
                  {attempt.result?.score ?? 0} / {attempt.result?.maxScore ?? "?"}
                </div>
                <div className="meta">{new Date(attempt.submittedAt).toLocaleString()}</div>
              </div>
              <button type="button" className="btn btn-small" onClick={() => setResult(attempt.result)}>
                View
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResultView({ test, result, backTo, onRetake }) {
  const score = Number(result.score) || 0;
  const max = Number(result.maxScore) || 1;
  const percent = Math.round((score / max) * 100);
  const sections = result.sections || [];

  return (
    <div className="page">
      <div className="breadcrumb"><Link to={backTo}>← Back to chapter</Link></div>
      <h1>{test.title}</h1>
      <p className="sub">Result</p>

      <div className="card score-card">
        <div className="score-big">{score}<span> / {max}</span></div>
        <div className="text-soft">{percent}%{result.estimatedBand ? ` · ${result.estimatedBand}` : ""}</div>
        <div className="progress" style={{ marginTop: 12 }}><div style={{ width: `${percent}%` }} /></div>
      </div>

      {result.overallFeedback ? (
        <div className="card"><h3>Overall</h3><p>{result.overallFeedback}</p></div>
      ) : null}

      {sections.map((section, index) => (
        <div className="card" key={index}>
          <h3>{section.title || `Section ${index + 1}`}</h3>
          <div className="text-soft small">{section.score} / {section.max}</div>
          {section.feedback ? <p>{section.feedback}</p> : null}
        </div>
      ))}

      <div className="card">
        <h3>Question by question</h3>
        {(result.questions || []).map((item, index) => {
          const full = item.max ? item.score >= item.max : item.score > 0;
          return (
            <div className={`q-item result ${full ? "good" : "bad"}`} key={item.id || index}>
              <div className="q-prompt">{item.prompt || `Question ${index + 1}`}</div>
              <div className="q-meta">
                <span>{item.score} / {item.max ?? 1}</span>
                {item.type ? <span>{TYPE_LABEL[item.type] || item.type}</span> : null}
              </div>
              <div className="answer-line"><b>You:</b> {item.yourAnswer || "(blank)"}</div>
              {item.correctAnswer !== undefined && item.correctAnswer !== "" ? (
                <div className="answer-line"><b>Expected:</b> {item.correctAnswer}</div>
              ) : null}
              {item.feedback ? <div className="answer-line text-soft">{item.feedback}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <button type="button" className="btn btn-primary" onClick={onRetake}>Retake this test</button>
      </div>
    </div>
  );
}
