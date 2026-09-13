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
- File import for `.txt`, `.md`, `.csv`, `.tsv` plus pasted text, with previews
- Flashcards: write your own cards, build a deck from a file, edit any deck, and
  study with random order, familiarity tracking and progress saved to Firestore

## Not ported yet

- `.xlsx`, `.docx` and `.pdf` import (needs SheetJS / mammoth / pdf.js in the browser)
- AI features (multiple choice, paper → online test, mock papers, Ask AI)

For AI in a static app the API key would live in the browser, which anyone can
read. The options are a small Cloud Function proxy, or accepting the risk on a
single-user deployment with a low-limit key.
