#!/usr/bin/env python
"""Small dependency-free backend for the Field Notes static site.

Run: python server.py
Admin credentials come from ADMIN_USERNAME and ADMIN_PASSWORD environment variables.
"""
from __future__ import annotations

import hashlib
import html
import base64
import io
import json
import os
import re
import secrets
import smtplib
import sqlite3
import threading
import time
import zipfile
from email.message import EmailMessage
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import urllib.request
ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / 'field_notes.db'
UPLOAD_DIR = ROOT / 'uploads'
MAX_WORDS = 1500
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024  # 5 MB max for Word documents
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_THUMBNAIL_BYTES = 250 * 1024  # 250 KB
MAX_AUTHOR_IMAGE_BYTES = 200 * 1024  # 200 KB
MAX_AUTHOR_BIO_WORDS = 200  # 200 words
MAX_PREVIEW_WORDS = 6000  # 6,000 words

SESSIONS: dict[str, dict] = {}
SESSION_MAX_AGE = 8 * 3600  # 8 hours

# Simple in-memory rate limiter: tracks {ip: [(timestamp, ...),]}
import time
RATE_LIMITS: dict[str, list[float]] = {}
RATE_WINDOW = 60       # seconds
RATE_MAX_ATTEMPTS = 10  # max requests per window per IP

def load_dotenv():
    env_file = ROOT / '.env'
    if env_file.is_file():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

load_dotenv()

DEFAULT_TURSO_URL = 'libsql://blogging-website-ayush2509.aws-ap-south-1.turso.io'
DEFAULT_TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTQyNTIyNzIsImlkIjoiMDFhMWMxYzMtNWIwMS03YjViLTk0NTAtZTMxYTk2OThmYjIwIiwia2lkIjoic2ZoX25TblNDOFZsX1ZLZldDMmtaOWRLc3dtNHZ0SjVCUmtFTk9LNkhlcyIsInJpZCI6IjQxY2QyM2I1LWUxOWYtNDE0My1iMjE1LTRmNWFhNWIwZjg3YiJ9.X96ZeYuMIWIe61PVWgG7iDSeQrLD4Ahk3Z0MN6OSFZES2YVEN-cefHL4sxGnjprWcfcHmc_g91JDnnWQtuzqCw'

TURSO_DATABASE_URL = (os.getenv('TURSO_DATABASE_URL') or DEFAULT_TURSO_URL).strip()
TURSO_AUTH_TOKEN = (os.getenv('TURSO_AUTH_TOKEN') or DEFAULT_TURSO_TOKEN).strip()

SMTP_USER = os.getenv('SMTP_USER', 'vlogingwebsite@gmail.com')
SMTP_PASS = os.getenv('SMTP_PASS', 'uxendqgrtentfkzh').replace(' ', '')
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', '465'))
SMTP_FROM = os.getenv('SMTP_FROM', '') or (SMTP_USER or 'vlogingwebsite@gmail.com')
SENT_EMAILS: list[dict] = []
EMAIL_LOG_PATH = ROOT / 'email_notifications.log'


def send_bot_email(to_email: str, subject: str, body: str):
    record = {
        'to': to_email,
        'subject': subject,
        'body': body,
        'timestamp': time.time(),
        'sent_via_smtp': False,
        'error': None
    }
    with LOCK:
        SENT_EMAILS.append(record)

    print(f"\n==================== [BOT EMAIL NOTIFICATION] ====================", flush=True)
    print(f"TO: {to_email}", flush=True)
    print(f"SUBJECT: {subject}", flush=True)
    print(f"BODY:\n{body.strip()}", flush=True)
    print(f"==================================================================\n", flush=True)

    if SMTP_HOST and SMTP_USER and SMTP_PASS:
        try:
            msg = EmailMessage()
            msg['Subject'] = subject
            msg['From'] = SMTP_FROM
            msg['To'] = to_email
            msg.set_content(body)

            ports_to_try = [SMTP_PORT]
            alt_port = 587 if SMTP_PORT == 465 else 465
            if alt_port not in ports_to_try:
                ports_to_try.append(alt_port)

            last_err = None
            for p in ports_to_try:
                try:
                    if p == 465:
                        with smtplib.SMTP_SSL(SMTP_HOST, 465, timeout=12) as s:
                            s.login(SMTP_USER, SMTP_PASS)
                            s.send_message(msg)
                    else:
                        with smtplib.SMTP(SMTP_HOST, 587, timeout=12) as s:
                            s.ehlo()
                            s.starttls()
                            s.ehlo()
                            s.login(SMTP_USER, SMTP_PASS)
                            s.send_message(msg)
                    record['sent_via_smtp'] = True
                    print(f"[BOT EMAIL] Successfully delivered via live SMTP (port {p}) to {to_email}", flush=True)
                    break
                except Exception as e:
                    last_err = e
                    print(f"[BOT EMAIL WARNING] Delivery attempt on port {p} failed: {e}", flush=True)

            if not record['sent_via_smtp']:
                # On hosts like Render Free Tier where direct outbound SMTP (ports 465/587) is blocked,
                # relay securely over HTTPS (port 443) via our Vercel email-relay endpoint!
                relay_url = os.getenv('EMAIL_RELAY_URL', 'https://cryptoayush1-vlogging-website.vercel.app/api/email-relay')
                try:
                    print(f"[BOT EMAIL] Attempting HTTPS relay via {relay_url}...", flush=True)
                    req_data = json.dumps({
                        'to': to_email,
                        'subject': subject,
                        'body': body,
                        'secret': 'field_notes_secure_relay_2026'
                    }).encode('utf-8')
                    req = urllib.request.Request(
                        relay_url,
                        data=req_data,
                        headers={
                            'Content-Type': 'application/json',
                            'X-Relay-Secret': 'field_notes_secure_relay_2026'
                        }
                    )
                    with urllib.request.urlopen(req, timeout=15) as rresp:
                        rbody = json.loads(rresp.read().decode('utf-8'))
                        if rbody.get('success'):
                            record['sent_via_smtp'] = True
                            record['sent_via_relay'] = True
                            record['error'] = None
                            print(f"[BOT EMAIL] Successfully delivered via HTTPS email relay to {to_email}", flush=True)
                        else:
                            record['error'] = rbody.get('error') or str(last_err)
                except Exception as relay_err:
                    print(f"[BOT EMAIL WARNING] HTTPS relay attempt failed: {relay_err}", flush=True)
                    record['error'] = f"SMTP error: {last_err}; Relay error: {relay_err}"
        except Exception as outer_err:
            record['error'] = str(outer_err)
    else:
        print(f"[BOT EMAIL] SMTP not configured. Logged notification to email_notifications.log", flush=True)

    try:
        with open(EMAIL_LOG_PATH, 'a', encoding='utf-8') as f:
            status = 'Delivered via live SMTP' if record['sent_via_smtp'] else (f"SMTP error: {record['error']}" if record['error'] else 'Simulation mode (SMTP credentials not configured)')
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] TO: {to_email}\nSUBJECT: {subject}\nSTATUS: {status}\nBODY:\n{body.strip()}\n" + ("=" * 70) + "\n\n")
    except Exception as err:
        print(f"[BOT EMAIL LOG ERROR] Could not append to log file: {err}", flush=True)

    with LOCK:
        SENT_EMAILS.append(record)


def send_bot_email_async(to_email: str, subject: str, body: str):
    threading.Thread(target=send_bot_email, args=(to_email, subject, body), daemon=True).start()


def get_admin_login_url(request_host: str = '') -> str:
    """Return the full public URL to the admin portal, adapting to Render or custom domains."""
    env_base = os.getenv('ADMIN_BASE_URL') or os.getenv('RENDER_EXTERNAL_URL')
    if env_base:
        return env_base.rstrip('/') + '/admin/'
    if request_host:
        host = request_host.strip()
        scheme = 'http' if host.startswith(('localhost', '127.0.0.1')) else 'https'
        return f"{scheme}://{host}/admin/"
    port = os.getenv('PORT', '8000')
    return f"http://localhost:{port}/admin/"


def send_registration_email(username: str, email: str, password: str, role: str, request_host: str = ''):
    is_admin = (role == 'admin')
    subject = "Field Notes Studio — Administrator Account Credentials" if is_admin else "Field Notes Studio — Registration & Account Credentials"
    role_title = "Primary Administrator (Full Access)" if is_admin else "Co-admin"
    admin_url = get_admin_login_url(request_host)
    body = f"""Hello {username},

Welcome to Field Notes Studio! Your {role_title} account has been successfully created.

Here are your account credentials:
- Username: {username}
- Password: {password}
- Account Role: {role.upper()}
- Linked Email: {email}

Studio Login URL:
{admin_url}

Please store your credentials safely.

Best regards,
Field Notes Automated Mail Bot
"""
    send_bot_email_async(email, subject, body)


def send_suspension_email(username: str, email: str):
    subject = "Field Notes Studio — Notice of Account Suspension"
    body = f"""Hello {username},

This is an automated notification from Field Notes Studio.

Your co-admin account ({username}) linked to this email address ({email}) has been SUSPENDED by the administrator.

As a result:
- Your access to the Field Notes Studio dashboard has been deactivated.
- You can no longer log in or publish vlogs to the journal.

If you have questions or believe this was done by mistake, please contact the site administrator.

Best regards,
Field Notes Automated Mail Bot
"""
    send_bot_email_async(email, subject, body)


def send_restoration_email(username: str, email: str, request_host: str = ''):
    subject = "Field Notes Studio — Account Restored"
    admin_url = get_admin_login_url(request_host)
    body = f"""Hello {username},

Good news! Your co-admin account ({username}) at Field Notes Studio has been restored by the administrator.

You may now log in to the studio dashboard again:
{admin_url}

Best regards,
Field Notes Automated Mail Bot
"""
    send_bot_email_async(email, subject, body)


def send_contact_confirmation_email(name: str, email: str, topic: str, message: str):
    subject = "Field Notes — We received your note"
    body = f"""Hello {name},

Thank you for writing to Field Notes. We have received your note regarding "{topic}".

Our editorial team reviews every inquiry and will be in touch if your note calls for a response.

Copy of your message:
--------------------------------------------------
{message}
--------------------------------------------------

Warm regards,
The Editors at Field Notes
"""
    send_bot_email_async(email, subject, body)


def send_contact_admin_alert(name: str, email: str, topic: str, message: str):
    admin_recipient = os.getenv('ADMIN_EMAIL') or SMTP_FROM or 'vlogingwebsite@gmail.com'
    subject = f"[Field Notes Contact Inquiry] {topic} from {name}"
    body = f"""New Contact Form Submission on Field Notes:

Sender: {name} <{email}>
Topic: {topic}

Message Content:
--------------------------------------------------
{message}
--------------------------------------------------

Sent via the Field Notes public contact page.
"""
    send_bot_email_async(admin_recipient, subject, body)


def send_feedback_alert(vlog_title: str, name: str, email: str, comment: str):
    admin_recipient = os.getenv('ADMIN_EMAIL') or SMTP_FROM or 'vlogingwebsite@gmail.com'
    subject = f"[Field Notes Feedback] New reflection on \"{vlog_title}\""
    body = f"""New Reader Reflection Received:

Piece: {vlog_title}
From: {name} {f'<{email}>' if email else ''}

Reflection:
--------------------------------------------------
{comment}
--------------------------------------------------

Sent via Field Notes vlog reader.
"""
    send_bot_email_async(admin_recipient, subject, body)


LOCK = threading.Lock()


def init_db(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','coadmin')),
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        email TEXT NOT NULL, topic TEXT NOT NULL, message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vlog_id INTEGER,
        vlog_title TEXT NOT NULL, author_name TEXT NOT NULL,
        author_email TEXT DEFAULT '', comment TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        vlog_id INTEGER,
        vlog_title TEXT DEFAULT '',
        ip_hash TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()


def hash_ip(ip: str) -> str:
    return hashlib.sha256((ip or 'unknown').encode()).hexdigest()[:16]


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 210000)
    return base64.b64encode(salt + digest).decode()


def verify_password(password: str, encoded: str) -> bool:
    try:
        raw = base64.b64decode(encoded); salt, expected = raw[:16], raw[16:]
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 210000)
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError): return False



def validate_registration(conn, username, email, password, repeat_password, role):
    if role not in ('admin', 'coadmin'): raise ValueError('Invalid account role.')
    if role == 'admin':
        admin_count = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
        if admin_count >= 1:
            raise ValueError('An administrator account already exists. Only co-admin accounts can be registered.')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username or ''): raise ValueError('Username must be 3-40 letters, numbers, dots, dashes, or underscores.')
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email or ''): raise ValueError('Enter a valid Gmail or email address.')
    if not password or len(password) < 8: raise ValueError('Password must be at least 8 characters.')
    if password != repeat_password: raise ValueError('Passwords do not match.')
    if conn.execute('SELECT 1 FROM users WHERE username=? OR email=?', (username, email)).fetchone(): raise ValueError('Username or email already exists.')


def create_user(conn, username: str, password: str, role: str = 'coadmin', email: str = '') -> int:
    if role not in {'admin', 'coadmin'}: raise ValueError('Role must be admin or coadmin.')
    if role == 'admin':
        admin_count = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
        if admin_count >= 1:
            raise ValueError('An administrator account already exists. Only co-admin accounts can be registered.')
    if len(username.strip()) < 3 or len(password) < 8: raise ValueError('Username must have 3 characters and password 8 characters.')
    cursor = conn.execute('INSERT INTO users(username,email,password_hash,role) VALUES(?,?,?,?)', (username.strip(), email.strip().lower() or f'{username.strip()}@local.invalid', password_hash(password), role)); conn.commit(); return cursor.lastrowid


def authenticate_user(conn, username: str, password: str):
    row = conn.execute('SELECT * FROM users WHERE username=? AND active=1', (username.strip(),)).fetchone()
    return dict(row) if row and verify_password(password, row['password_hash']) else None


def set_user_active(conn, user_id: int, active: bool):
    conn.execute("UPDATE users SET active=? WHERE id=? AND role='coadmin'", (int(active), user_id)); conn.commit()


def list_users(conn):
    return [dict(row) for row in conn.execute('SELECT id,username,role,active,created_at FROM users ORDER BY created_at DESC')]


def ensure_admin(conn):
    if conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0] == 0:
        username = os.getenv('ADMIN_USERNAME')
        password = os.getenv('ADMIN_PASSWORD')
        email = os.getenv('ADMIN_EMAIL', f'{username}@local.invalid') if username else ''
        if username and password:
            create_user(conn, username, password, 'admin', email)
            if email and not email.endswith('@local.invalid'):
                send_registration_email(username, email, password, 'admin')


def make_session_token() -> str:
    return secrets.token_urlsafe(32)


def make_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def is_rate_limited(ip: str) -> bool:
    """Return True if the IP has exceeded the rate limit."""
    now = time.time()
    with LOCK:
        timestamps = RATE_LIMITS.get(ip, [])
        timestamps = [t for t in timestamps if now - t < RATE_WINDOW]
        if len(timestamps) >= RATE_MAX_ATTEMPTS:
            RATE_LIMITS[ip] = timestamps
            return True
        timestamps.append(now)
        RATE_LIMITS[ip] = timestamps
        return False


def cleanup_expired_sessions():
    """Remove sessions older than SESSION_MAX_AGE."""
    now = time.time()
    with LOCK:
        expired = [k for k, v in SESSIONS.items() if now - v.get('created_at', 0) > SESSION_MAX_AGE]
        for k in expired:
            del SESSIONS[k]


def is_allowed_document(filename: str) -> bool:
    return Path(filename).suffix.lower() in {'.doc', '.docx'}


def is_allowed_thumbnail(filename: str, data: bytes) -> bool:
    ext = Path(filename).suffix.lower()
    if ext not in {'.jpg', '.jpeg'}:
        return False
    if len(data) < 3 or data[:3] != b'\xff\xd8\xff':
        return False
    return True


def is_allowed_author_image(filename: str, data: bytes) -> bool:
    ext = Path(filename).suffix.lower()
    if ext in {'.jpg', '.jpeg'}:
        return len(data) >= 3 and data[:3] == b'\xff\xd8\xff'
    elif ext == '.png':
        return len(data) >= 8 and data[:8] == b'\x89PNG\r\n\x1a\n'
    return False


def text_word_count(text: str) -> int:
    return len(re.findall(r"[\w’'-]+", text or ''))


def docx_body_text(data: bytes) -> str:
    """Extract body text from a .docx preserving paragraph breaks."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read('word/document.xml').decode('utf-8', 'ignore')
    except (KeyError, zipfile.BadZipFile):
        return ''
    text = re.sub(r'</w:p>', '\n', xml)
    text = re.sub(r'<[^>]+>', '', text)
    return html.unescape(text).strip()


def doc_body_text(data: bytes) -> str:
    """Best-effort plain-text extraction from legacy .doc files."""
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', data.decode('latin-1', 'ignore'))
    cleaned = re.sub(r'[^\x20-\x7e\n\r]', '', cleaned)
    return cleaned.strip()


def extract_body_text(data: bytes, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == '.docx':
        return docx_body_text(data)
    if suffix == '.doc':
        return doc_body_text(data)
    return ''


def word_count(data: bytes, filename: str) -> int:
    suffix = Path(filename).suffix.lower()
    if suffix == '.docx':
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                xml = archive.read('word/document.xml').decode('utf-8', 'ignore')
            text = re.sub(r'<[^>]+>', ' ', xml)
            return len(re.findall(r"[\w’'-]+", html.unescape(text)))
        except (KeyError, zipfile.BadZipFile):
            raise ValueError('The DOCX file is invalid.')
    # Legacy .doc is binary; this conservative check avoids pretending to parse it.
    # A production deployment can add an approved .doc parser/conversion service.
    text = data.decode('latin-1', 'ignore')
    return len(re.findall(r"[A-Za-z0-9’'-]+", text))


def to_turso_arg(val):
    if val is None:
        return {'type': 'null'}
    elif isinstance(val, bool):
        return {'type': 'integer', 'value': '1' if val else '0'}
    elif isinstance(val, int):
        return {'type': 'integer', 'value': str(val)}
    elif isinstance(val, float):
        return {'type': 'float', 'value': val}
    elif isinstance(val, (bytes, bytearray)):
        return {'type': 'blob', 'base64': base64.b64encode(val).decode()}
    else:
        return {'type': 'text', 'value': str(val)}


def from_turso_value(cell):
    t = cell.get('type')
    val = cell.get('value')
    if t == 'null': return None
    elif t == 'integer': return int(val)
    elif t == 'float': return float(val)
    elif t == 'text': return str(val)
    elif t == 'blob':
        return base64.b64decode(cell.get('base64', ''))
    return val


class TursoRow(dict):
    def __init__(self, cols, values):
        super().__init__(zip(cols, values))
        self._values = list(values)
        self._cols = list(cols)

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._values[item]
        return super().__getitem__(item)

    def keys(self):
        return self._cols


class TursoCursor:
    def __init__(self, cols, rows, last_id=None, affected=0):
        self.cols = cols
        self._rows = [TursoRow(cols, r) for r in rows]
        self._idx = 0
        self.lastrowid = int(last_id) if last_id is not None else None
        self.rowcount = affected

    def fetchone(self):
        if self._idx < len(self._rows):
            r = self._rows[self._idx]
            self._idx += 1
            return r
        return None

    def fetchall(self):
        rem = self._rows[self._idx:]
        self._idx = len(self._rows)
        return rem

    def __iter__(self):
        return iter(self.fetchall())


class TursoConnection:
    def __init__(self, url, token):
        u = url.strip()
        if u.startswith('libsql://'):
            u = 'https://' + u[len('libsql://'):]
        if not u.endswith('/v2/pipeline'):
            u = u.rstrip('/') + '/v2/pipeline'
        self.url = u
        self.token = token.strip()

    def execute(self, sql, params=()):
        if params is None:
            params = ()
        elif not isinstance(params, (list, tuple)):
            params = (params,)
        args = [to_turso_arg(p) for p in params]
        payload = {
            'requests': [
                {'type': 'execute', 'stmt': {'sql': sql, 'args': args}},
                {'type': 'close'}
            ]
        }
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json'}
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            raise sqlite3.OperationalError(f'Turso query error: {e}')

        first = body.get('results', [{}])[0]
        if first.get('type') == 'error':
            msg = first.get('error', {}).get('message', 'Turso error')
            if 'UNIQUE constraint failed' in msg:
                raise sqlite3.IntegrityError(msg)
            raise sqlite3.OperationalError(msg)
        exec_res = first.get('response', {}).get('result', {})
        cols = [c['name'] for c in exec_res.get('cols', [])]
        rows = [[from_turso_value(cell) for cell in r] for r in exec_res.get('rows', [])]
        return TursoCursor(cols, rows, exec_res.get('last_insert_rowid'), exec_res.get('affected_row_count', 0))

    def commit(self):
        pass

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


def db():
    conn = None
    if TURSO_DATABASE_URL and TURSO_AUTH_TOKEN:
        try:
            candidate = TursoConnection(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
            candidate.execute('SELECT 1')
            conn = candidate
        except Exception as e:
            conn = None

    if conn is None:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

    conn.execute('''CREATE TABLE IF NOT EXISTS vlogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
    author TEXT NOT NULL, excerpt TEXT NOT NULL, filename TEXT NOT NULL,
    word_count INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER,
    body_text TEXT DEFAULT '', thumbnail_filename TEXT DEFAULT '',
    author_image_filename TEXT DEFAULT '', author_bio TEXT DEFAULT '',
    thumbnail_data TEXT DEFAULT '', author_image_data TEXT DEFAULT '')''')
    # Add columns if missing (migration)
    cols = [row['name'] for row in conn.execute("PRAGMA table_info(vlogs)")]
    if 'user_id' not in cols:
        conn.execute('ALTER TABLE vlogs ADD COLUMN user_id INTEGER REFERENCES users(id)')
    if 'body_text' not in cols:
        conn.execute("ALTER TABLE vlogs ADD COLUMN body_text TEXT DEFAULT ''")
    if 'thumbnail_filename' not in cols:
        conn.execute("ALTER TABLE vlogs ADD COLUMN thumbnail_filename TEXT DEFAULT ''")
    if 'author_image_filename' not in cols:
        conn.execute("ALTER TABLE vlogs ADD COLUMN author_image_filename TEXT DEFAULT ''")
    if 'author_bio' not in cols:
        conn.execute("ALTER TABLE vlogs ADD COLUMN author_bio TEXT DEFAULT ''")
    if 'thumbnail_data' not in cols:
        conn.execute("ALTER TABLE vlogs ADD COLUMN thumbnail_data TEXT DEFAULT ''")
    if 'author_image_data' not in cols:
        conn.execute("ALTER TABLE vlogs ADD COLUMN author_image_data TEXT DEFAULT ''")
    init_db(conn)
    ensure_admin(conn)
    conn.commit()
    return conn


def parse_multipart(body: bytes, content_type: str):
    boundary = content_type.split('boundary=', 1)[-1].strip().strip('"').encode()
    parts = {}
    for raw in body.split(b'--' + boundary):
        if raw == b'' or raw.startswith(b'--'):
            continue
        headers, content = raw.split(b'\r\n\r\n', 1)
        content = content.rstrip(b'\r\n')
        disposition = re.search(br'name="([^"]+)"(?:; filename="([^"]*)")?', headers)
        if not disposition:
            continue
        name = disposition.group(1).decode()
        filename = disposition.group(2).decode() if disposition.group(2) else None
        parts[name] = {'filename': filename, 'data': content}
    return parts


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print('%s - %s' % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Cookie')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, status, payload, extra_headers=None):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
        for key, value in (extra_headers or {}).items(): self.send_header(key, value)
        self.end_headers(); self.wfile.write(raw)

    def read_body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length > MAX_UPLOAD_BYTES + 1024 * 1024: raise ValueError('Request is too large.')
        return self.rfile.read(length)

    def authenticated(self):
        jar = cookies.SimpleCookie(self.headers.get('Cookie', ''))
        token = jar.get('field_notes_session')
        return SESSIONS.get(token.value) if token and token.value in SESSIONS else None

    def require_role(self, role):
        user = self.authenticated()
        return user if user and (user['role'] == role or role == 'coadmin' and user['role'] == 'admin') else None

    def do_GET(self):
        cleanup_expired_sessions()
        parsed = urlparse(self.path)
        if parsed.path in ('/', '') and (os.getenv('RENDER') or os.getenv('RENDER_EXTERNAL_URL') or os.getenv('ADMIN_PORTAL_ONLY')):
            self.send_response(302)
            self.send_header('Location', '/admin/')
            self.end_headers()
            return
        if parsed.path == '/api/admin/setup-status':
            with db() as conn:
                has_admin = bool(conn.execute("SELECT 1 FROM users WHERE role='admin' LIMIT 1").fetchone())
                db_type = 'turso' if isinstance(conn, TursoConnection) else 'local_sqlite'
            return self.send_json(200, {'has_admin': has_admin, 'database': db_type})
        if parsed.path == '/api/vlogs':
            with db() as conn: rows = [dict(row) for row in conn.execute('SELECT * FROM vlogs ORDER BY created_at DESC')]
            return self.send_json(200, rows)
        if parsed.path == '/api/feedback':
            qs = parse_qs(parsed.query)
            vlog_id = qs.get('vlog_id', [''])[0].strip()
            vlog_title = qs.get('vlog_title', [''])[0].strip()
            with db() as conn:
                if vlog_id and vlog_title:
                    rows = conn.execute('SELECT * FROM feedback WHERE (vlog_id IS NOT NULL AND CAST(vlog_id AS TEXT)=?) OR LOWER(vlog_title)=LOWER(?) ORDER BY created_at ASC', (vlog_id, vlog_title)).fetchall()
                elif vlog_id:
                    rows = conn.execute('SELECT * FROM feedback WHERE (vlog_id IS NOT NULL AND CAST(vlog_id AS TEXT)=?) ORDER BY created_at ASC', (vlog_id,)).fetchall()
                elif vlog_title:
                    rows = conn.execute('SELECT * FROM feedback WHERE LOWER(vlog_title)=LOWER(?) ORDER BY created_at ASC', (vlog_title,)).fetchall()
                else:
                    rows = conn.execute('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 50').fetchall()
                return self.send_json(200, [dict(r) for r in rows])
        if parsed.path == '/admin':
            if not self.authenticated(): return self.send_json(401, {'error': 'Admin authentication required.'})
            return self.send_json(200, {'authenticated': True, 'user': self.authenticated()})
        if parsed.path == '/api/admin/users':
            user = self.require_role('admin')
            if not user: return self.send_json(403, {'error': 'Only the admin can manage access.'})
            with db() as conn: return self.send_json(200, list_users(conn))
        if parsed.path == '/api/admin/emails':
            user = self.require_role('admin')
            if not user: return self.send_json(403, {'error': 'Only the admin can view notification logs.'})
            with LOCK: return self.send_json(200, list(SENT_EMAILS[-50:]))
        if parsed.path == '/api/admin/contacts':
            user = self.require_role('admin')
            if not user: return self.send_json(403, {'error': 'Only the admin can view contact messages.'})
            with db() as conn:
                return self.send_json(200, [dict(r) for r in conn.execute('SELECT * FROM contacts ORDER BY created_at DESC')])
        if parsed.path == '/api/admin/analytics':
            user = self.require_role('admin')
            if not user: return self.send_json(403, {'error': 'Only the admin can view analytics.'})
            with db() as conn:
                total_views = conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type = 'page_view'").fetchone()[0]
                total_clicks = conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type = 'vlog_click'").fetchone()[0]
                unique_visitors = conn.execute("SELECT COUNT(DISTINCT ip_hash) FROM analytics_events WHERE ip_hash != ''").fetchone()[0]
                total_feedback = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
                vlog_rows = conn.execute("SELECT id, title, category, author, word_count, created_at FROM vlogs ORDER BY created_at DESC").fetchall()
                vlogs_data = []
                for v in vlog_rows:
                    v_id = v['id']
                    v_title = v['title']
                    clicks = conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type = 'vlog_click' AND ((vlog_id IS NOT NULL AND vlog_id = ?) OR LOWER(vlog_title) = LOWER(?))", (v_id, v_title)).fetchone()[0]
                    fb_count = conn.execute("SELECT COUNT(*) FROM feedback WHERE ((vlog_id IS NOT NULL AND vlog_id = ?) OR LOWER(vlog_title) = LOWER(?))", (v_id, v_title)).fetchone()[0]
                    vlogs_data.append({
                        'id': v_id,
                        'title': v_title,
                        'category': v['category'],
                        'author': v['author'],
                        'word_count': v['word_count'],
                        'created_at': v['created_at'],
                        'clicks': clicks,
                        'feedback_count': fb_count,
                        'is_custom': True
                    })
                feedback_rows = conn.execute("SELECT id, vlog_id, vlog_title, author_name, author_email, comment, created_at FROM feedback ORDER BY created_at DESC").fetchall()
                feedback_data = [dict(r) for r in feedback_rows]
                return self.send_json(200, {
                    'total_views': total_views,
                    'total_clicks': total_clicks,
                    'unique_visitors': unique_visitors,
                    'total_feedback': total_feedback,
                    'vlogs': vlogs_data,
                    'feedback': feedback_data
                })
        if parsed.path.startswith('/studio/'):
            return self.serve_static('/admin' + parsed.path[len('/studio'):])
        if parsed.path.startswith('/uploads/'): 
            filename = Path(parsed.path.removeprefix('/uploads/')).name
            path = UPLOAD_DIR / filename
            if not path.is_file():
                try:
                    with db() as conn:
                        row = conn.execute(
                            'SELECT thumbnail_filename, thumbnail_data, author_image_filename, author_image_data FROM vlogs WHERE thumbnail_filename=? OR author_image_filename=? LIMIT 1',
                            (filename, filename)
                        ).fetchone()
                        if row:
                            data_b64 = ''
                            if row['thumbnail_filename'] == filename:
                                data_b64 = row['thumbnail_data']
                            elif row['author_image_filename'] == filename:
                                data_b64 = row['author_image_data']
                            if data_b64:
                                UPLOAD_DIR.mkdir(exist_ok=True)
                                path.write_bytes(base64.b64decode(data_b64))
                except Exception:
                    pass
            if not path.is_file(): return self.send_json(404, {'error': 'Not found.'})
            data = path.read_bytes()
            ext = path.suffix.lower()
            if ext in ('.jpg', '.jpeg'):
                content_type = 'image/jpeg'
            elif ext == '.png':
                content_type = 'image/png'
            elif ext == '.webp':
                content_type = 'image/webp'
            else:
                content_type = 'application/octet-stream'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return self.serve_static(parsed.path)

    def serve_static(self, path):
        relative = path.lstrip('/')
        if relative == '' or relative.endswith('/'):
            relative = relative + 'index.html'
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents and target != ROOT or not target.is_file(): return self.send_json(404, {'error': 'Not found.'})
        data = target.read_bytes(); types = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript'}
        self.send_response(200); self.send_header('Content-Type', types.get(target.suffix, 'application/octet-stream')); self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        if target.suffix == '.html':
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        parsed = urlparse(self.path)
        client_ip = self.client_address[0]
        # Periodically clean up expired sessions
        cleanup_expired_sessions()
        if parsed.path == '/api/contact':
            if is_rate_limited(client_ip): return self.send_json(429, {'error': 'Too many submissions. Please wait a moment.'})
            try:
                body = json.loads(self.read_body())
                name = str(body.get('name', '')).strip()
                email = str(body.get('email', '')).strip().lower()
                topic = str(body.get('topic', 'General inquiry')).strip()
                message = str(body.get('message', '')).strip()
                if not name or len(name) < 2:
                    raise ValueError('Please enter your name.')
                if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
                    raise ValueError('Please enter a valid email address.')
                if not message or len(message) < 5:
                    raise ValueError('Please enter a message of at least 5 characters.')
                with db() as conn:
                    conn.execute('INSERT INTO contacts(name,email,topic,message) VALUES(?,?,?,?)', (name, email, topic, message))
                    conn.commit()
                send_contact_confirmation_email(name, email, topic, message)
                send_contact_admin_alert(name, email, topic, message)
                return self.send_json(200, {'success': True, 'message': 'Thank you. Your message has been sent to our editorial team.'})
            except (json.JSONDecodeError, ValueError) as error:
                return self.send_json(400, {'error': str(error) or 'Invalid contact request.'})
        if parsed.path == '/api/feedback':
            if is_rate_limited(client_ip): return self.send_json(429, {'error': 'Too many feedback submissions. Please wait a moment.'})
            try:
                body = json.loads(self.read_body())
                vlog_id = body.get('vlog_id')
                vlog_title = str(body.get('vlog_title', '')).strip()
                name = str(body.get('author_name', '')).strip()
                email = str(body.get('author_email', '')).strip().lower()
                comment = str(body.get('comment', '')).strip()
                if not vlog_title:
                    raise ValueError('Vlog title is required.')
                if not name or len(name) < 2:
                    raise ValueError('Please enter your name.')
                if not comment or len(comment) < 3:
                    raise ValueError('Please enter a reflection or comment.')
                with db() as conn:
                    cursor = conn.execute(
                        'INSERT INTO feedback(vlog_id, vlog_title, author_name, author_email, comment) VALUES(?,?,?,?,?)',
                        (vlog_id, vlog_title, name, email, comment)
                    )
                    conn.commit()
                    fb_id = cursor.lastrowid
                send_feedback_alert(vlog_title, name, email, comment)
                return self.send_json(201, {
                    'id': fb_id,
                    'vlog_id': vlog_id,
                    'vlog_title': vlog_title,
                    'author_name': name,
                    'author_email': email,
                    'comment': comment,
                    'created_at': 'Just now'
                })
            except (json.JSONDecodeError, ValueError) as err:
                return self.send_json(400, {'error': str(err)})
        if parsed.path == '/api/analytics/event':
            try:
                body = json.loads(self.read_body())
                event_type = str(body.get('event_type', '')).strip()
                if event_type not in ('page_view', 'vlog_click'):
                    raise ValueError('Invalid event type.')
                vlog_id = body.get('vlog_id')
                if vlog_id is not None:
                    try: vlog_id = int(vlog_id)
                    except (ValueError, TypeError): vlog_id = None
                vlog_title = str(body.get('vlog_title', '')).strip()
                ip_h = hash_ip(client_ip)
                ua = self.headers.get('User-Agent', '')[:200]
                with db() as conn:
                    conn.execute("INSERT INTO analytics_events(event_type, vlog_id, vlog_title, ip_hash, user_agent) VALUES(?,?,?,?,?)",
                                 (event_type, vlog_id, vlog_title, ip_h, ua))
                    conn.commit()
                return self.send_json(201, {'recorded': True})
            except Exception as e:
                return self.send_json(400, {'error': str(e)})
        if parsed.path == '/api/admin/login':
            if is_rate_limited(client_ip): return self.send_json(429, {'error': 'Too many attempts. Please wait a moment.'})
            try: body = json.loads(self.read_body())
            except (json.JSONDecodeError, ValueError): return self.send_json(400, {'error': 'Invalid JSON.'})
            with db() as conn: user = authenticate_user(conn, str(body.get('username', '')), str(body.get('password', '')))
            if not user: return self.send_json(401, {'error': 'Invalid credentials or inactive account.'})
            token = make_session_token(); session = {'id': user['id'], 'username': user['username'], 'role': user['role'], 'created_at': time.time()}
            with LOCK: SESSIONS[token] = session
            return self.send_json(200, {'authenticated': True, 'user': session}, {'Set-Cookie': f'field_notes_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'})
        if parsed.path == '/api/admin/register':
            if is_rate_limited(client_ip): return self.send_json(429, {'error': 'Too many attempts. Please wait a moment.'})
            try:
                body = json.loads(self.read_body()); username, email = str(body.get('username','')).strip(), str(body.get('email','')).strip(); password, repeat = str(body.get('password','')), str(body.get('repeat_password','')); role = str(body.get('role','coadmin'))
                admin_request = bool(self.require_role('admin'))
                if admin_request and not repeat:
                    if not email: email = f'{username}@local.invalid'
                    if len(username) < 3 or len(password) < 8:
                        raise ValueError('Username must have 3 characters and password 8 characters.')
                    with db() as conn:
                        if conn.execute("SELECT 1 FROM users WHERE username=? OR (email=? AND email != '')", (username, email)).fetchone():
                            raise ValueError('Username or email already exists.')
                        user_id = create_user(conn, username, password, 'coadmin', email)
                    if email and not email.endswith('@local.invalid'):
                        send_registration_email(username, email, password, 'coadmin', request_host=self.headers.get('Host', ''))
                    return self.send_json(201, {'id': user_id, 'username': username, 'email': email, 'role': 'coadmin'})
                with db() as conn:
                    validate_registration(conn, username, email, password, repeat, role); user_id = create_user(conn, username, password, role, email)
                if email and not email.endswith('@local.invalid'):
                    send_registration_email(username, email, password, role, request_host=self.headers.get('Host', ''))
                return self.send_json(201, {'id': user_id, 'username': username, 'email': email, 'role': role})
            except (json.JSONDecodeError, ValueError) as error: return self.send_json(400, {'error': str(error) or 'Invalid registration.'})
            except sqlite3.IntegrityError: return self.send_json(409, {'error': 'Username or email already exists.'})

        if parsed.path == '/api/admin/users/status':
            if not self.require_role('admin'): return self.send_json(403, {'error': 'Only the admin can control access.'})
            try: body = json.loads(self.read_body()); user_id, active = int(body['id']), bool(body['active'])
            except (KeyError, TypeError, ValueError, json.JSONDecodeError): return self.send_json(400, {'error': 'Invalid user status request.'})
            with db() as conn:
                user = conn.execute("SELECT * FROM users WHERE id=? AND role='coadmin'", (user_id,)).fetchone()
                if not user: return self.send_json(404, {'error': 'Co-admin not found.'})
                set_user_active(conn, user_id, active)
                target_email = user['email']
                target_username = user['username']
            if not active and target_email and not target_email.endswith('@local.invalid'):
                send_suspension_email(target_username, target_email)
            elif active and target_email and not target_email.endswith('@local.invalid'):
                send_restoration_email(target_username, target_email, request_host=self.headers.get('Host', ''))
            return self.send_json(200, {'updated': True})
        if parsed.path.startswith('/api/admin/users/') and self.command == 'DELETE':
            if not self.require_role('admin'): return self.send_json(403, {'error': 'Only the admin can delete co-admins.'})
            try:
                target_id = int(parsed.path.split('/')[-1])
            except ValueError:
                return self.send_json(400, {'error': 'Invalid user ID.'})
            with db() as conn:
                target = conn.execute("SELECT * FROM users WHERE id=? AND role='coadmin'", (target_id,)).fetchone()
                if not target:
                    return self.send_json(404, {'error': 'Co-admin not found.'})
                admin = conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1").fetchone()
                if not admin:
                    return self.send_json(500, {'error': 'No admin user found.'})
                # Reassign vlogs from co-admin to admin
                conn.execute('UPDATE vlogs SET user_id=? WHERE user_id=?', (admin['id'], target_id))
                # Delete the co-admin user
                conn.execute('DELETE FROM users WHERE id=?', (target_id,))
                conn.commit()
            return self.send_json(200, {'deleted': True, 'id': target_id})
        if parsed.path == '/api/admin/logout':
            jar = cookies.SimpleCookie(self.headers.get('Cookie', '')); token = jar.get('field_notes_session')
            if token:
                with LOCK: SESSIONS.pop(token.value, None)
            return self.send_json(200, {'authenticated': False}, {'Set-Cookie': 'field_notes_session=; Max-Age=0; Path=/; HttpOnly'})
        if parsed.path == '/api/admin/vlogs/preview' and self.command == 'POST':
            if not self.authenticated(): return self.send_json(401, {'error': 'Admin authentication required.'})
            try:
                body = self.read_body(); parts = parse_multipart(body, self.headers.get('Content-Type', ''))
                file = parts.get('document', {}); filename = file.get('filename') or ''
                data = file.get('data', b'')
                if not is_allowed_document(filename): raise ValueError('Only .doc and .docx files are supported.')
                if not data: raise ValueError('File is empty.')
                if len(data) > MAX_DOCUMENT_BYTES: raise ValueError(f'Word document exceeds the 5 MB limit ({round(len(data) / (1024 * 1024), 2)} MB).')
                body_text = extract_body_text(data, filename)
                count = text_word_count(body_text) if body_text else word_count(data, filename)
                return self.send_json(200, {'body_text': body_text, 'word_count': count})
            except ValueError as error: return self.send_json(400, {'error': str(error)})
            except Exception as error: return self.send_json(500, {'error': 'Preview failed. Please try again.'})
        if parsed.path == '/api/admin/vlogs' and self.command == 'POST':
            if not self.authenticated(): return self.send_json(401, {'error': 'Admin authentication required.'})
            try:
                body = self.read_body(); parts = parse_multipart(body, self.headers.get('Content-Type', ''))
                file = parts.get('document', {}); filename = file.get('filename') or ''
                title = parts.get('title', {}).get('data', b'').decode('utf-8', 'ignore').strip()
                category = parts.get('category', {}).get('data', b'').decode('utf-8', 'ignore').strip()
                author = parts.get('author', {}).get('data', b'').decode('utf-8', 'ignore').strip()
                excerpt = parts.get('excerpt', {}).get('data', b'').decode('utf-8', 'ignore').strip()
                author_bio = parts.get('author_bio', {}).get('data', b'').decode('utf-8', 'ignore').strip()
                submitted_body = parts.get('body_text', {}).get('data', b'').decode('utf-8', 'ignore').strip()
                data = file.get('data', b'')

                if not all([title, category, author, excerpt]): raise ValueError('Title, category, author, and excerpt are required.')
                if not is_allowed_document(filename): raise ValueError('Only .doc and .docx files are supported.')
                if not data: raise ValueError('Word document file is empty.')
                if len(data) > MAX_DOCUMENT_BYTES: raise ValueError(f'Word document exceeds the 5 MB limit ({round(len(data) / (1024 * 1024), 2)} MB).')

                # Author bio word limit check: max 200 words
                if author_bio:
                    bio_words = text_word_count(author_bio)
                    if bio_words > MAX_AUTHOR_BIO_WORDS:
                        raise ValueError(f'Author bio exceeds the 200-word limit ({bio_words} words).')

                # Body text: prefer submitted_body (from editable preview), fallback to extracted
                doc_text = extract_body_text(data, filename)
                final_body = submitted_body if submitted_body else doc_text
                final_word_count = text_word_count(final_body) if final_body else word_count(data, filename)

                # Preview / editable body word limit: max 6,000 words
                if final_word_count > MAX_PREVIEW_WORDS:
                    raise ValueError(f'Document text exceeds the 6,000-word limit ({final_word_count} words).')

                safe_name = secrets.token_hex(8) + Path(filename).suffix.lower()
                UPLOAD_DIR.mkdir(exist_ok=True)
                (UPLOAD_DIR / safe_name).write_bytes(data)

                # Process thumbnail picture if provided (max 250 KB, JPEG)
                thumb_part = parts.get('thumbnail', {})
                thumb_filename = thumb_part.get('filename') or ''
                thumb_data = thumb_part.get('data', b'')
                safe_thumb_name = ''
                if thumb_filename and thumb_data:
                    if len(thumb_data) > MAX_THUMBNAIL_BYTES:
                        raise ValueError(f'Thumbnail image exceeds the 250 KB limit ({len(thumb_data) // 1024} KB).')
                    if not is_allowed_thumbnail(thumb_filename, thumb_data):
                        raise ValueError('Only JPEG images (.jpg or .jpeg) are supported for vlog thumbnails.')
                    safe_thumb_name = 'thumb_' + secrets.token_hex(8) + '.jpg'
                    (UPLOAD_DIR / safe_thumb_name).write_bytes(thumb_data)

                # Process author picture if provided (under 200 KB, JPEG/PNG)
                author_img_part = parts.get('author_image', {})
                author_img_filename = author_img_part.get('filename') or ''
                author_img_data = author_img_part.get('data', b'')
                safe_author_img_name = ''
                if author_img_filename and author_img_data:
                    if len(author_img_data) > MAX_AUTHOR_IMAGE_BYTES:
                        raise ValueError(f'Author picture exceeds the 200 KB limit ({round(len(author_img_data) / 1024, 1)} KB).')
                    if not is_allowed_author_image(author_img_filename, author_img_data):
                        raise ValueError('Only JPEG and PNG images (.jpg, .jpeg, .png) are supported for author pictures.')
                    ext = Path(author_img_filename).suffix.lower()
                    if ext == '.jpeg': ext = '.jpg'
                    safe_author_img_name = 'author_' + secrets.token_hex(8) + ext
                    (UPLOAD_DIR / safe_author_img_name).write_bytes(author_img_data)

                safe_thumb_b64 = base64.b64encode(thumb_data).decode() if thumb_data else ''
                safe_author_b64 = base64.b64encode(author_img_data).decode() if author_img_data else ''

                user = self.authenticated()
                with db() as conn:
                    cursor = conn.execute(
                        'INSERT INTO vlogs(title,category,author,excerpt,filename,word_count,user_id,body_text,thumbnail_filename,author_image_filename,author_bio,thumbnail_data,author_image_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (title, category, author, excerpt, safe_name, final_word_count, user['id'], final_body, safe_thumb_name, safe_author_img_name, author_bio, safe_thumb_b64, safe_author_b64)
                    )
                    vlog_id = cursor.lastrowid
                return self.send_json(201, {
                    'id': vlog_id,
                    'title': title,
                    'word_count': final_word_count,
                    'body_text': final_body,
                    'thumbnail_filename': safe_thumb_name,
                    'author_image_filename': safe_author_img_name,
                    'author_bio': author_bio
                })
            except ValueError as error: return self.send_json(400, {'error': str(error)})
            except Exception as error: return self.send_json(500, {'error': 'Upload failed. Please try again.'})
        if parsed.path.startswith('/api/admin/vlogs/') and self.command == 'DELETE':
            if not self.authenticated(): return self.send_json(401, {'error': 'Admin authentication required.'})
            try:
                vlog_id = int(parsed.path.split('/')[-1])
            except ValueError:
                return self.send_json(400, {'error': 'Invalid vlog ID.'})
            with db() as conn:
                row = conn.execute('SELECT title, filename, thumbnail_filename, author_image_filename FROM vlogs WHERE id=?', (vlog_id,)).fetchone()
                if not row:
                    return self.send_json(404, {'error': 'Vlog not found.'})
                title = row['title']
                filename = row['filename']
                thumb_filename = row['thumbnail_filename'] if 'thumbnail_filename' in row.keys() else ''
                author_img_filename = row['author_image_filename'] if 'author_image_filename' in row.keys() else ''
                # Clean up all associated analytical event data and reader feedback
                conn.execute('DELETE FROM analytics_events WHERE (vlog_id IS NOT NULL AND vlog_id=?) OR LOWER(vlog_title)=LOWER(?)', (vlog_id, title))
                conn.execute('DELETE FROM feedback WHERE (vlog_id IS NOT NULL AND vlog_id=?) OR LOWER(vlog_title)=LOWER(?)', (vlog_id, title))
                conn.execute('DELETE FROM vlogs WHERE id=?', (vlog_id,))
                conn.commit()
            # Delete uploaded files
            file_path = UPLOAD_DIR / filename
            if file_path.is_file():
                file_path.unlink()
            if thumb_filename:
                thumb_path = UPLOAD_DIR / thumb_filename
                if thumb_path.is_file():
                    thumb_path.unlink()
            if author_img_filename:
                author_img_path = UPLOAD_DIR / author_img_filename
                if author_img_path.is_file():
                    author_img_path.unlink()
            return self.send_json(200, {'deleted': True, 'id': vlog_id, 'analytics_deleted': True})
        if parsed.path.startswith('/api/admin/feedback/') and (self.command == 'DELETE' or parsed.path.endswith('/delete')):
            if not self.require_role('admin'):
                return self.send_json(403, {'error': 'Only the admin can delete feedback.'})
            try:
                parts = [p for p in parsed.path.split('/') if p and p != 'delete']
                fb_id = int(parts[-1])
            except (ValueError, IndexError):
                return self.send_json(400, {'error': 'Invalid feedback ID.'})
            with db() as conn:
                row = conn.execute('SELECT id FROM feedback WHERE id=?', (fb_id,)).fetchone()
                if not row:
                    return self.send_json(404, {'error': 'Feedback not found.'})
                conn.execute('DELETE FROM feedback WHERE id=?', (fb_id,))
                conn.commit()
            return self.send_json(200, {'deleted': True, 'id': fb_id})
        if parsed.path == '/api/admin/analytics/reset' and self.command == 'POST':
            if not self.require_role('admin'):
                return self.send_json(403, {'error': 'Only the admin can reset analytics.'})
            with db() as conn:
                conn.execute('DELETE FROM analytics_events')
                conn.commit()
            return self.send_json(200, {'reset': True})
        if parsed.path == '/api/admin/test-email' and self.command == 'POST':
            try:
                body = json.loads(self.read_body())
                target_email = str(body.get('email', '')).strip() or SMTP_USER
                subject = "Field Notes Studio — Live Email Test"
                msg_body = f"Hello,\n\nThis is a live test from your Field Notes Studio server!\nSent at: {time.strftime('%Y-%m-%d %H:%M:%S')}\nHost: {self.headers.get('Host', 'localhost')}\n\nYour automated email notifications are working perfectly!"
                send_bot_email(target_email, subject, msg_body)
                last = SENT_EMAILS[-1] if SENT_EMAILS else {}
                if last.get('sent_via_smtp'):
                    return self.send_json(200, {'success': True, 'message': f'Test email sent successfully to {target_email}'})
                else:
                    return self.send_json(500, {'success': False, 'error': last.get('error') or 'Could not deliver email.'})
            except Exception as e:
                return self.send_json(400, {'success': False, 'error': str(e)})
        if parsed.path == '/api/admin/credentials/reset' and self.command == 'POST':
            with db() as conn:
                conn.execute('DELETE FROM users')
                conn.commit()
            with LOCK:
                SESSIONS.clear()
            return self.send_json(200, {'deleted': True, 'message': 'All user credentials wiped from database.'})
        return self.send_json(404, {'error': 'Not found.'})

    def do_DELETE(self):
        # Reuse the same logic as do_POST for DELETE endpoints
        self.do_POST()


def main():
    port = int(os.getenv('PORT', '8000')); db().close(); print(f'Field Notes backend listening on port {port}')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()

if __name__ == '__main__': main()
