# FoodLab Supabase accounts — setup

This repository remains a static GitHub Pages site. The browser uses the official Supabase JS v2 client; no server-side secret is included.

## 1. Create the Supabase project
1. Create a project in the Supabase dashboard.
2. Choose the data region yourself (EU region is recommended for an EU audience).
3. Wait until the database is ready.
4. Copy the Project URL and the public **publishable key** (or legacy anon key) from Project Settings → API.

Never put a secret key or `service_role` key in this repository.

## 2. Configure the client
Edit `supabase-config.js`:
- `url`: your Project URL
- `publishableKey`: your public publishable/anon key

These values are visible to visitors by design. Database access is protected by RLS, not by hiding the public key.

## 3. Configure Auth
In Authentication → URL Configuration:
- Site URL: `https://liecfall.github.io/foodscience/`
- Add Redirect URL: `https://liecfall.github.io/foodscience/`
- Keep the same path when testing the production GitHub Pages site.

Enable Email provider and email confirmations. The app redirects confirmation and recovery links to the existing repository page; it does not require a separate route that GitHub Pages might return as 404.

For a public launch, configure custom SMTP and verify sender/domain settings. The built-in email service is intended for limited testing.

## 4. Create tables and RLS
Review `supabase/schema.sql`, then paste it into Supabase SQL Editor and run it. It creates four user-owned tables and separate SELECT, INSERT, UPDATE and DELETE policies. Do not disable RLS.

## 5. Publish
Commit `supabase-config.js` with only the public URL and publishable key. GitHub Pages will serve the files from the repository root. No build step is required.

## Data model and sync behavior
- Diary entries are stored individually by `user_id + entry_id`; the original diary object is retained in JSONB.
- Favorites preserve FoodLab catalog product IDs only.
- Notes and diary goal are stored as one row per user.
- Guest data remains under the original LocalStorage keys. Account data uses a user-specific local cache namespace.
- Import is explicit, uses insert-if-absent semantics, and leaves guest originals in place.
- Cloud sync is online-only in this first version. A failed request is reported as a sync error; it is not described as cloud-saved.
- Synchronization is additive and non-destructive: it never deletes cloud rows or overwrites existing rows with stale device copies. Cloud copies win ID conflicts. Deletion propagation and conflict-aware edits need a future versioned/tombstone model; until then, deleting an entry or favorite on one device may not remove it from other devices.

## Manual verification checklist
1. Register a new email and confirm it using the email link.
2. Sign in with valid and invalid credentials.
3. Request a password reset and set a new password from the email link.
4. Reload the page and confirm the session is restored.
5. Sign out and verify the guest diary/notes/favorites are shown again.
6. Sign in as a second user on the same browser and verify the first user's cache is not shown.
7. In Supabase SQL Editor, test that user A cannot select/update/delete user B rows; test INSERT/UPDATE with a mismatched `user_id` is rejected.
8. Import guest data and repeat the import; verify no duplicates and no guest originals are removed.
9. Test offline mode and confirm the interface does not report successful cloud sync.
10. Sign in on two devices and verify ordinary online edits appear after reload.

## Remaining manual configuration
- Supabase project creation, region choice, Auth settings, redirect URLs, SMTP, SQL execution, and public client config.
- End-to-end verification of real email delivery, RLS isolation, and two-device synchronization requires the configured Supabase project and test accounts.
- Account deletion is not implemented in the browser: deleting an Auth user requires a protected server-side operation (for example, an Edge Function using a server-only secret). Never add that secret to the client.
- Before public launch, publish a privacy notice explaining email/account data, diary, favorites, notes, data region, export, and deletion request process.


## Safe synchronization policy

The client inserts only missing diary entries and catalog favorites. Existing cloud rows win ID conflicts. Stale devices cannot delete cloud rows or overwrite them. Edits to existing records and deletions are not yet synchronized across devices; export important data regularly until versioned conflict handling is implemented.
