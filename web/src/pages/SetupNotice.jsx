export default function SetupNotice() {
  return (
    <div className="center-screen">
      <div className="card setup-card">
        <h1>Connect Firebase</h1>
        <p className="sub">
          The web app needs your Firebase project details before it can sign you in.
        </p>
        <ol className="steps">
          <li>Create a project at <b>console.firebase.google.com</b>.</li>
          <li>Add a <b>Web app</b> to it and copy the config values.</li>
          <li>Enable <b>Authentication → Google</b> and create a <b>Firestore</b> database.</li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> in the <code>web/</code> folder and
            fill in the values.
          </li>
          <li>Restart the dev server.</li>
        </ol>
        <p className="text-soft">
          For GitHub Pages, the same values go into repository secrets (see
          <code> web/README.md</code>).
        </p>
      </div>
    </div>
  );
}
