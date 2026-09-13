import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { listChapters, listCourses } from "../data.js";

export default function Layout() {
  const { user, signOutUser } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const [courses, setCourses] = useState([]);
  const [chapters, setChapters] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);

  // On phones the course tree is a drawer: any navigation closes it.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listCourses(user.uid);
      if (!alive) return;
      setCourses(list);
      const entries = await Promise.all(
        list.map(async (course) => [course.id, await listChapters(user.uid, course.id)])
      );
      if (alive) setChapters(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [user.uid, params.courseId, params.page]);

  const sidebar = (
    <aside id="course-nav" className={`sidebar${menuOpen ? " open" : ""}`}>
      <div className="sidebar-head">
        <h2>Courses</h2>
        <button type="button" className="btn btn-small" onClick={() => navigate("/courses?new=1")}>
          ＋ New
        </button>
      </div>
      <nav className="course-tree">
        {courses.length === 0 ? (
          <p className="sidebar-empty">No courses yet.</p>
        ) : (
          courses.map((course) => (
            <div className="tree-course" key={course.id}>
              <NavLink className="tree-course-head" to={`/c/${course.id}`}>
                <span className="tree-course-name">{course.name}</span>
                <span className="tree-count">{(chapters[course.id] || []).length}</span>
              </NavLink>
              <div className="tree-chapters">
                {(chapters[course.id] || []).map((chapter) => (
                  <div className="tree-chapter" key={chapter.id}>
                    <NavLink className="tree-chapter-head" to={`/c/${course.id}/ch/${chapter.id}`}>
                      <span className="tree-chapter-name">{chapter.name}</span>
                    </NavLink>
                    <div className="tree-modules">
                      <NavLink className="tree-module" to={`/c/${course.id}/ch/${chapter.id}/files`}>
                        📁 Files
                      </NavLink>
                      <NavLink className="tree-module" to={`/c/${course.id}/ch/${chapter.id}/flashcards`}>
                        🃏 Flashcards
                      </NavLink>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </nav>
    </aside>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="course-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
        <div className="brand">
          <div className="brand-mark">한</div>
          <div>
            <div className="brand-name">HangulHub</div>
            <div className="brand-sub">Korean exam studio</div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="text-soft user-name">{user.displayName || user.email}</span>
          <button type="button" className="btn btn-small" onClick={signOutUser}>Sign out</button>
        </div>
      </header>
      <div className="layout">
        {menuOpen ? (
          <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        ) : null}
        {sidebar}
        <main className="workspace">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
