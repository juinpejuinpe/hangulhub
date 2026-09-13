# HangulHub web app (React + Firebase)

The same study app as the local Flask version, rebuilt as a static React app so it
can run on GitHub Pages with **no server of your own**. Firebase provides the two
server-side things the browser can't do alone:

| Need | Service |
| --- | --- |
| Sign-in | Firebase Authentication (Google) |
| Storage for courses, files, decks, progress | Cloud Firestore |
| Hosting | GitHub Pages (Firebase Hosting is optional) |

Firestore security rules mean each account can only read and write its own data.

## Who can use it

Only these accounts, listed in `web/src/allowlist.js`:

- `sunsong1011@gmail.com`
- `rlkl1421253088@gmail.com`

The real enforcement is the email check at the top of `web/firestore.rules`; the
client-side list only decides which message is shown, so anyone else signing in
gets an explanation instead of a screen of permission errors. To add or remove an
account, edit **both** files and then:

```sh
pnpm dlx firebase-tools deploy --only firestore:rules   # the enforcement
git push                                                # the message
```

`npm test` fails if the two lists ever drift apart.

Related protections already in place:

- Only the **Google** provider is enabled under Authentication, so nobody can
  self-register with an email/password account.
- Email enumeration protection is on, so the sign-in flow won't reveal which
  addresses exist.
- The deployed bundle contains the Firebase web config, which is public by
  design — it holds no third-party API keys (the DeepSeek key lives only in the
  local Flask app's `data/settings.json`, which is gitignored). Anyone who copies
  the config out of the bundle still can't read or write data, because the rules
  above reject them.

## 1. Create the Firebase project

1. <https://console.firebase.google.com> → **Add project**.
2. In the project, **Build → Authentication → Get started → Google → Enable**.
3. **Build → Firestore Database → Create database** (production mode, pick a region).
4. **Project settings → Your apps → Web (`</>`)** → register an app → copy the config.
5. Paste the values into `web/.env` (copy `.env.example` first).

## 2. Publish the security rules

`firestore.rules` restricts every document to its owner. Deploy it with the
Firebase CLI so the default "test mode" rules are replaced:

```sh
npm install -g firebase-tools
firebase login
cd web
firebase use --add          # pick your project
firebase deploy --only firestore:rules
```

## 3. Run it locally

```sh
brew install node           # once
cd web
npm install
npm run dev                 # http://localhost:5173
```

## 4. Deploy to GitHub Pages

> **Note:** GitHub Pages can't host this project if the account's user site has a
> custom domain — GitHub redirects every project site under that account to it,
> with no per-repository opt-out. In that case use a host that gives each project
> its own domain (Vercel, Netlify, Cloudflare Pages) or Firebase Hosting.

1. Add these repository secrets (**Settings → Secrets and variables → Actions**),
   using the same values as your `.env`:

   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_FIREBASE_APP_ID`

2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` builds `web/` and publishes it.
4. In Firebase, **Authentication → Settings → Authorized domains → Add domain**, and
   add `<your-user>.github.io` — Google sign-in fails on any domain that isn't listed.

The app uses a hash router (`/#/courses`), so deep links work on Pages without any
rewrite configuration.

## What's implemented

- Google sign-in, with data isolated per account by security rules
- Courses → chapters → files
- File import for `.txt`, `.md`, `.csv`, `.tsv`, `.xlsx`, `.docx` and `.pdf`,
  plus pasted text, with previews
- Flashcards: write your own cards, build a deck from a file, edit any deck, and
  study with random order, familiarity tracking and progress saved to Firestore

## Not ported yet

- AI features (multiple choice, paper → online test, mock papers, Ask AI)

### Notes on the importers

- Parsing happens entirely in the browser: SheetJS for `.xlsx`, mammoth for
  `.docx`, and pdf.js for `.pdf`. Each library is code-split, so a phone only
  downloads the one it needs, when a file of that type is chosen.
- Scanned image PDFs have no text layer, so there is nothing to extract — they
  need OCR first. The local Flask app has the same limitation.
- Content is stored in the Firestore document, which caps at 1 MB. A very long
  PDF's text is rejected with a clear message rather than failing halfway;
  split it into two files.

### AI features

DeepSeek's API sends permissive CORS headers (verified: its preflight echoes the
requesting origin and allows the `authorization` header), so the browser can call
it directly and no backend is required. That means the API key is entered in the
app and kept in the browser, never in the bundle or the repository — the same
arrangement as the local app's `data/settings.json`, just per-device.
