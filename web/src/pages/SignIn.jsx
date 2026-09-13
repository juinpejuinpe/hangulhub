import { useAuth } from "../auth.jsx";
import { ErrorBox } from "../components/ui.jsx";

export default function SignIn({ error }) {
  const { signIn } = useAuth();

  return (
    <div className="center-screen">
      <div className="card signin-card">
        <div className="brand brand-large">
          <div className="brand-mark">한</div>
          <div>
            <div className="brand-name">HangulHub</div>
            <div className="brand-sub">Korean exam studio</div>
          </div>
        </div>
        <h1>Sign in to study</h1>
        <p className="sub">
          Your courses, decks and progress are stored in your own Firebase account — nobody else
          can read them.
        </p>
        <ErrorBox error={error} />
        <button type="button" className="btn btn-primary btn-wide" onClick={signIn}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
