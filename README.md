# Field Notes — vlogging website

A responsive editorial-style static website inspired by the calm, typography-led feel of Aeon, without copying its branding or content.

## Included
- Editorial home page with latest vlog cards, topics, and about section
- Search dialog
- Vlog reader modal
- Responsive layout for mobile and desktop
- No subscriptions, newsletter forms, or paywall
- Admin login is intentionally not shown in the public navigation

## Important implementation note
This is a front-end preview. A real private admin login and Word document upload pipeline need a server/database before production. The intended upload validation is a `.doc`/`.docx` file with a maximum of 1,500 words; enforce that limit on the server as well as in the browser. Do not treat a hidden keyboard shortcut as security.

The backend now stores accounts in SQLite (`users` table) and supports one environment-configured administrator plus any number of co-admins.

- Passwords are stored as salted PBKDF2-SHA256 hashes, never plaintext.
- The first admin is created from `ADMIN_USERNAME` and `ADMIN_PASSWORD` when the database is initialized.
- Only the admin can register co-admin IDs and passwords.
- Only the admin can list accounts or suspend/restore co-admin access.
- Both admin and active co-admin accounts can log in and publish vlogs.
- Suspended co-admins are rejected by the login route.

Additional routes:
- `POST /api/admin/register` — admin-only co-admin registration
- `GET /api/admin/users` — admin-only account list without password hashes
- `POST /api/admin/users/status` — admin-only `{ "id": 2, "active": false }`

1. Set temporary admin credentials in the shell before startup. Do not commit them to source control:

```bash
set ADMIN_USERNAME=temporary-admin
set ADMIN_PASSWORD=use-a-temporary-password
set ADMIN_EMAIL=temporary-admin@example.com
```

2. If the database already contains an administrator, changing these variables does not change the existing account. To create a fresh temporary login for a new empty development database, remove `field_notes.db` first.


```bash
# Windows PowerShell / Command Prompt
set ADMIN_USERNAME=admin
set ADMIN_PASSWORD=replace-with-a-strong-password
python server.py
```

Then visit `http://localhost:8000`. The backend provides:
- `POST /api/admin/login` — private admin session login
- `POST /api/admin/logout` — session logout
- `POST /api/admin/vlogs` — authenticated `.doc`/`.docx` upload
- `GET /api/vlogs` — published vlog metadata
- `GET /uploads/<stored-file>` — uploaded document retrieval

Upload rules are enforced server-side: Word documents only, max 10 MB, max 1,500 words. DOCX word counts are parsed from the document XML. Legacy `.doc` files are accepted and conservatively counted; for production, add a trusted conversion/parser service for exact legacy-DOC extraction.

The SQLite database is created as `field_notes.db`; uploaded files are stored in `uploads/`. These are runtime files and should not be committed to source control.

## Run frontend-only
Open `index.html` directly, or serve this folder with any static server:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.
