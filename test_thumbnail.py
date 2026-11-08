import unittest
import sqlite3
import tempfile
from pathlib import Path
import server

class ThumbnailUploadTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('''CREATE TABLE IF NOT EXISTS vlogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
            author TEXT NOT NULL, excerpt TEXT NOT NULL, filename TEXT NOT NULL,
            word_count INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER,
            body_text TEXT DEFAULT '', thumbnail_filename TEXT DEFAULT '')''')
        server.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_allowed_thumbnail_validation(self):
        # Valid JPEG magic bytes \xff\xd8\xff
        valid_jpeg = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01'
        self.assertTrue(server.is_allowed_thumbnail('photo.jpg', valid_jpeg))
        self.assertTrue(server.is_allowed_thumbnail('cover.jpeg', valid_jpeg))
        self.assertTrue(server.is_allowed_thumbnail('PHOTO.JPG', valid_jpeg))

        # Invalid formats
        self.assertFalse(server.is_allowed_thumbnail('photo.png', b'\x89PNG\r\n\x1a\n'))
        self.assertFalse(server.is_allowed_thumbnail('photo.gif', b'GIF89a'))
        self.assertFalse(server.is_allowed_thumbnail('photo.webp', b'RIFF....WEBP'))
        self.assertFalse(server.is_allowed_thumbnail('photo.jpg', b'Not a real jpeg'))

    def test_max_thumbnail_size_constant(self):
        self.assertEqual(server.MAX_THUMBNAIL_BYTES, 250 * 1024)

    def test_thumbnail_column_persists_in_vlogs(self):
        cur = self.conn.execute(
            'INSERT INTO vlogs(title, category, author, excerpt, filename, word_count, thumbnail_filename) VALUES(?,?,?,?,?,?,?)',
            ('Scenic Journey', 'Places', 'Wanderer', 'Exploring nature...', 'doc.docx', 400, 'thumb_12345.jpg')
        )
        v_id = cur.lastrowid
        self.conn.commit()

        row = self.conn.execute('SELECT * FROM vlogs WHERE id=?', (v_id,)).fetchone()
        self.assertEqual(row['thumbnail_filename'], 'thumb_12345.jpg')

if __name__ == '__main__':
    unittest.main()
