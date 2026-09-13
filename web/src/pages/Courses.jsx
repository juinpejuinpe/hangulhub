import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { formatDate, ErrorBox, Spinner, useToast } from "../components/ui.jsx";
import { createCourse, deleteCourse, listCourses } from "../data.js";
import { useAsync } from "../hooks.js";

export default function Courses() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const { data: courses, loading, error, reload } = useAsync(
    () => listCourses(user.uid),
    [user.uid]
  );

  const showForm = params.get("new") === "1" || (courses || []).length === 0;

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const id = await createCourse(user.uid, { name, target });
      setName("");
      setTarget("");
      toast(`Created “${name.trim()}”.`);
      await reload();
      navigate(`/c/${id}`);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove(course) {
    if (!window.confirm(`Delete “${course.name}” with all its chapters, files and decks?`)) return;
    try {
      await deleteCourse(user.uid, course.id);
      toast("Course deleted.");
      reload();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="page">
      <h1>Courses</h1>
      <p className="sub">A course holds chapters; chapters hold your files and flashcard decks.</p>
      <ErrorBox error={error} />

      {showForm ? (
        <form className="card" onSubmit={submit}>
          <h3>New course</h3>
          <div className="grid2">
            <div className="field">
              <label htmlFor="course-name">Course name</label>
              <input
                id="course-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. TOPIK I preparation"
              />
            </div>
            <div className="field">
              <label htmlFor="course-target">Target (optional)</label>
              <input
                id="course-target"
                className="input"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="e.g. TOPIK level 2, 140+"
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Create course
          </button>
        </form>
      ) : (
        <div className="card">
          <Link className="btn btn-primary" to="/courses?new=1">＋ New course</Link>
        </div>
      )}

      {loading ? (
        <Spinner label="Loading courses…" />
      ) : (
        <div className="stack">
          {(courses || []).map((course) => (
            <div className="row-card" key={course.id}>
              <div className="grow">
                <Link className="title linkish" to={`/c/${course.id}`}>{course.name}</Link>
                <div className="meta">
                  {course.target ? `${course.target} · ` : ""}created {formatDate(course.createdAt)}
                </div>
              </div>
              <Link className="btn btn-small" to={`/c/${course.id}`}>Open</Link>
              <button type="button" className="btn btn-small btn-danger" onClick={() => remove(course)}>
                Delete
              </button>
            </div>
          ))}
          {!loading && (courses || []).length === 0 ? (
            <p className="text-soft">No courses yet — create your first one above.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
