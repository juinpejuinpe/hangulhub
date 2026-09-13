import { ALLOWED_EMAILS } from "../allowlist.js";

export default function NotAuthorised({ email, onSwitch }) {
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
        <h1>This account isn&apos;t allowed</h1>
        <p className="sub">
          HangulHub is a private study app. You&apos;re signed in as{" "}
          <b>{email || "an unknown account"}</b>, which isn&apos;t on the list.
        </p>
        <p className="text-soft small">
          Sign in with one of: {ALLOWED_EMAILS.join(", ")}
        </p>
        <p className="text-soft small">
          Your data is protected by server-side rules, so nothing was read or changed.
        </p>
        <button type="button" className="btn btn-primary btn-wide" onClick={onSwitch}>
          Use a different account
        </button>
      </div>
    </div>
  );
}
