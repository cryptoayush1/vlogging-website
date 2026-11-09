import io
import json
import sqlite3
import unittest
from pathlib import Path

import server

ROOT = Path(__file__).parent


class VlogEditingTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('''CREATE TABLE IF NOT EXISTS vlogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
            author TEXT NOT NULL, excerpt TEXT NOT NULL, filename TEXT NOT NULL,
            word_count INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER,
            body_text TEXT DEFAULT '', thumbnail_filename TEXT DEFAULT '', thumbnail_data TEXT DEFAULT '',
            author_image_filename TEXT DEFAULT '', author_image_data TEXT DEFAULT '', author_bio TEXT DEFAULT '')''')
        server.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_admin_js_has_click_to_edit_and_exit_edit(self):
        js = (ROOT / 'admin' / 'admin.js').read_text(encoding='utf-8')
        self.assertIn('startEditingVlog', js)
        self.assertIn('exitEditMode', js)
        self.assertIn('cancelEditBtn', js)
        self.assertIn('/update', js)
        self.assertIn('currentEditingVlogId', js)
        self.assertIn('loadArchive', js)

    def test_admin_index_has_edit_inputs(self):
        html = (ROOT / 'admin' / 'index.html').read_text(encoding='utf-8')
        self.assertIn('id="editVlogId"', html)
        self.assertIn('id="cancelEditBtn"', html)
        self.assertIn('id="formKicker"', html)
        self.assertIn('id="formTitle"', html)

    def test_public_app_js_live_updates_open_modal(self):
        app_js = (ROOT / 'app.js').read_text(encoding='utf-8')
        self.assertIn("dialog.open && currentOpenVlog", app_js)
        self.assertIn("fetch('/api/vlogs')", app_js)

    def test_server_has_update_endpoint_and_put(self):
        server_code = (ROOT / 'server.py').read_text(encoding='utf-8')
        self.assertIn("parsed.path.startswith('/api/admin/vlogs/') and parsed.path.endswith('/update')", server_code)
        self.assertIn("def do_PUT(self):", server_code)

    def test_update_vlog_database_record(self):
        # 1. Insert initial vlog
        cur = self.conn.execute(
            '''INSERT INTO vlogs(title, category, author, excerpt, filename, word_count, body_text, author_bio, thumbnail_filename, author_image_filename)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            ('Original Title', 'Culture', 'Original Author', 'Original Excerpt', 'film1.docx', 25, 'Original body text paragraph here.', 'Original author bio.', 'thumb1.jpg', 'author1.png')
        )
        vlog_id = cur.lastrowid
        self.conn.commit()

        # 2. Simulate update query from server
        updated_title = 'Brand New Title'
        updated_category = 'Process'
        updated_author = 'Jane Doe'
        updated_excerpt = 'Updated excerpt after editorial review.'
        updated_body = 'This is the newly revised article body containing six words.'
        updated_word_count = server.text_word_count(updated_body)
        updated_bio = 'Jane Doe is a documentary photographer and writer.'

        self.conn.execute(
            '''UPDATE vlogs SET
                title=?,
                category=?,
                author=?,
                excerpt=?,
                filename=?,
                word_count=?,
                body_text=?,
                thumbnail_filename=?,
                thumbnail_data=?,
                author_image_filename=?,
                author_image_data=?,
                author_bio=?
            WHERE id=?''',
            (updated_title, updated_category, updated_author, updated_excerpt, 'film1.docx', updated_word_count, updated_body,
             'thumb1.jpg', '', 'author1.png', '', updated_bio, vlog_id)
        )
        self.conn.commit()

        # 3. Verify record was updated in database
        row = self.conn.execute('SELECT * FROM vlogs WHERE id=?', (vlog_id,)).fetchone()
        self.assertEqual(row['title'], 'Brand New Title')
        self.assertEqual(row['category'], 'Process')
        self.assertEqual(row['author'], 'Jane Doe')
        self.assertEqual(row['excerpt'], 'Updated excerpt after editorial review.')
        self.assertEqual(row['body_text'], updated_body)
        self.assertEqual(row['word_count'], 10)
        self.assertEqual(row['author_bio'], updated_bio)
        # Preserved existing pictures
        self.assertEqual(row['thumbnail_filename'], 'thumb1.jpg')
        self.assertEqual(row['author_image_filename'], 'author1.png')

    def test_preview_and_bio_word_limits_on_edit(self):
        valid_bio = ' '.join(['word'] * 180)
        invalid_bio = ' '.join(['word'] * 205)
        self.assertLessEqual(server.text_word_count(valid_bio), server.MAX_AUTHOR_BIO_WORDS)
        self.assertGreater(server.text_word_count(invalid_bio), server.MAX_AUTHOR_BIO_WORDS)

        valid_body = ' '.join(['story'] * 5500)
        invalid_body = ' '.join(['story'] * 6005)
        self.assertLessEqual(server.text_word_count(valid_body), server.MAX_PREVIEW_WORDS)
        self.assertGreater(server.text_word_count(invalid_body), server.MAX_PREVIEW_WORDS)


if __name__ == '__main__':
    unittest.main()
