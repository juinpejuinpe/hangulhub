import { HashRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { isAllowedEmail } from "./allowlist.js";
import { useAuth } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import { ErrorBox, Spinner } from "./components/ui.jsx";
import Chapter from "./pages/Chapter.jsx";
import Course from "./pages/Course.jsx";
import Courses from "./pages/Courses.jsx";
import DeckStudy from "./pages/DeckStudy.jsx";
import Files from "./pages/Files.jsx";
import Flashcards from "./pages/Flashcards.jsx";
import NotAuthorised from "./pages/NotAuthorised.jsx";
import SetupNotice from "./pages/SetupNotice.jsx";
import SignIn from "./pages/SignIn.jsx";

// HashRouter keeps deep links working on GitHub Pages, which serves static
// files and has no server-side rewrite rules.

function Gate() {
  const { configured, loading, user, error, signOutUser } = useAuth();
  if (!configured) return <SetupNotice />;
  if (loading) return <div className="center-screen"><Spinner label="Loading HangulHub…" /></div>;
  if (!user) return <SignIn error={error} />;
  if (!isAllowedEmail(user.email)) {
    return <NotAuthorised email={user.email} onSwitch={signOutUser} />;
  }
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="page">
      <h1>Not found</h1>
      <p className="sub">That page doesn&apos;t exist.</p>
      <a className="btn" href="#/courses">Back to courses</a>
    </div>
  );
}

function CourseBoundary({ children }) {
  const { courseId } = useParams();
  if (!courseId) return <ErrorBox error="Missing course id." />;
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Gate />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/courses" replace />} />
            <Route path="/courses" element={<Courses />} />
            <Route
              path="/c/:courseId"
              element={<CourseBoundary><Course /></CourseBoundary>}
            />
            <Route
              path="/c/:courseId/ch/:chapterId"
              element={<CourseBoundary><Chapter /></CourseBoundary>}
            />
            <Route
              path="/c/:courseId/ch/:chapterId/files"
              element={<CourseBoundary><Files /></CourseBoundary>}
            />
            <Route
              path="/c/:courseId/ch/:chapterId/flashcards"
              element={<CourseBoundary><Flashcards /></CourseBoundary>}
            />
            <Route path="/deck/:deckId" element={<DeckStudy />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}
