import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { chatReply, hasApiKey } from "../ai.js";
import { useAuth } from "../auth.jsx";
import FilePicker from "../components/FilePicker.jsx";
import { ErrorBox, Spinner, useToast } from "../components/ui.jsx";
import { getChat, getCourse, listChapters, listFiles, saveChat } from "../data.js";
import { useAsync } from "../hooks.js";

export default function Chat() {
  const { courseId, chapterId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  const { data, loading, error: loadError } = useAsync(
    async () => {
      const [course, chapters, files, chat] = await Promise.all([
        getCourse(user.uid, courseId),
        listChapters(user.uid, courseId),
        listFiles(user.uid, courseId, chapterId),
        getChat(user.uid, chapterId),
      ]);
      return { course, chapter: chapters.find((c) => c.id === chapterId), files, chat };
    },
    [user.uid, courseId, chapterId]
  );

  useEffect(() => {
    if (!data) return;
    setMessages(data.chat.messages || []);
    setSelected((current) => current ?? new Set(data.files.map((file) => file.id)));
  }, [data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    if (!hasApiKey()) {
      return toast("Add your DeepSeek API key in AI settings first (⚙ in the top bar).", "error");
    }
    const files = (data?.files || []).filter((file) => selected?.has(file.id));
    const history = messages;
    const next = [...history, { role: "user", content: text }];
    setMessages(next);
    setQuestion("");
    setBusy(true);
    setError("");
    try {
      const reply = await chatReply({ files, history, question: text });
      const withReply = [...next, { role: "assistant", content: reply }];
      setMessages(withReply);
      await saveChat(user.uid, chapterId, withReply);
    } catch (err) {
      setError(err.message);
      setMessages(next);
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    if (!window.confirm("Clear this conversation?")) return;
    setMessages([]);
    await saveChat(user.uid, chapterId, []);
    toast("Conversation cleared.");
  }

  if (loading) return <div className="page"><Spinner label="Loading chat…" /></div>;
  if (loadError) return <div className="page"><ErrorBox error={loadError} /></div>;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to={`/c/${courseId}`}>{data.course?.name}</Link> /{" "}
        <Link to={`/c/${courseId}/ch/${chapterId}`}>{data.chapter?.name}</Link> / Ask AI
      </div>
      <div className="deck-top">
        <div className="grow">
          <h1>Ask AI</h1>
          <p className="sub">Questions about this chapter's material — grammar, translation, anything.</p>
        </div>
        <button type="button" className="btn btn-small" onClick={clearChat} disabled={!messages.length}>
          Clear
        </button>
      </div>

      <div className="card">
        <FilePicker
          files={data.files}
          selected={selected || new Set()}
          onChange={setSelected}
          label="Sources to consult"
          emptyHint="No files here — the tutor will answer from general knowledge."
        />
      </div>

      <div className="card chat-log">
        {messages.length === 0 ? (
          <p className="text-soft center">
            Ask something like “explain the difference between -아서 and -니까, with examples from my notes”.
          </p>
        ) : (
          messages.map((message, index) => (
            <div className={`chat-msg ${message.role}`} key={index}>
              <div className="chat-role">{message.role === "user" ? "You" : "Tutor"}</div>
              <div className="chat-body">{message.content}</div>
            </div>
          ))
        )}
        {busy ? <div className="chat-msg assistant"><div className="chat-role">Tutor</div><div className="chat-body text-soft">Thinking…</div></div> : null}
        <div ref={endRef} />
      </div>

      <ErrorBox error={error} />
      <form className="chat-input-row" onSubmit={send}>
        <textarea
          className="input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) send(event);
          }}
          placeholder="Ask a question…"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>Send</button>
      </form>
    </div>
  );
}
