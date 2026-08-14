# Suhail

Static GitHub Pages build of the Suhail website with Firebase Authentication.

## Firebase
Project: `suha-10cbb`

Authentication providers enabled in Firebase: Email/Password, Google, Apple.

## GitHub Pages
1. Upload `index.html` (and optionally `404.html`) to the repository root.
2. GitHub → Settings → Pages → Deploy from branch → `main` / root.
3. In Firebase Authentication → Settings → Authorized domains, add the exact GitHub Pages hostname, e.g. `YOUR-USERNAME.github.io`.
4. Open the site over HTTPS. Do not open `index.html` with `file://`.

`firestore.rules` is included for the Firestore database rules.
