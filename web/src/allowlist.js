// Who may use this deployment.
//
// The real enforcement is in firestore.rules — this list only decides what the
// app shows, so an unauthorised account gets a clear message instead of an app
// full of permission errors. If you change one, change the other.

export const ALLOWED_EMAILS = [
  "sunsong1011@gmail.com",
  "rlkl1421253088@gmail.com",
];

export function isAllowedEmail(email) {
  const normalised = String(email || "").trim().toLowerCase();
  return normalised !== "" && ALLOWED_EMAILS.includes(normalised);
}
