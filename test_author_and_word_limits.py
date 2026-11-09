import io
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

import server
from server import (
    is_allowed_document,
    is_allowed_author_image,
    text_word_count,
    MAX_DOCUMENT_BYTES,
    MAX_AUTHOR_IMAGE_BYTES,
    MAX_AUTHOR_BIO_WORDS,
    MAX_PREVIEW_WORDS
)


def create_sample_docx(words: list[str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        xml_content = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + ' '.join(words) + '</w:t></w:r></w:p></w:body></w:document>'
        z.writestr('word/document.xml', xml_content)
    return buf.getvalue()


class AuthorAndWordLimitTests(unittest.TestCase):
    def test_constants_configured(self):
        self.assertEqual(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024)
        self.assertEqual(MAX_AUTHOR_IMAGE_BYTES, 200 * 1024)
        self.assertEqual(MAX_AUTHOR_BIO_WORDS, 200)
        self.assertEqual(MAX_PREVIEW_WORDS, 6000)

    def test_author_image_validation(self):
        valid_jpeg = b'\xff\xd8\xff' + (b'\x00' * 50)
        valid_png = b'\x89PNG\r\n\x1a\n' + (b'\x00' * 50)
        invalid_magic = b'GIF89a' + (b'\x00' * 50)

        self.assertTrue(is_allowed_author_image('author.jpg', valid_jpeg))
        self.assertTrue(is_allowed_author_image('author.jpeg', valid_jpeg))
        self.assertTrue(is_allowed_author_image('author.png', valid_png))
        self.assertFalse(is_allowed_author_image('author.gif', invalid_magic))
        self.assertFalse(is_allowed_author_image('author.png', valid_jpeg))
        self.assertFalse(is_allowed_author_image('author.jpg', valid_png))

    def test_text_word_count(self):
        self.assertEqual(text_word_count('Hello world this is a test'), 6)
        self.assertEqual(text_word_count(''), 0)
        words_200 = ' '.join(['story'] * 200)
        self.assertEqual(text_word_count(words_200), 200)

    def test_database_migration_includes_author_fields(self):
        conn = server.db()
        cols = [row['name'] for row in conn.execute("PRAGMA table_info(vlogs)")]
        self.assertIn('author_image_filename', cols)
        self.assertIn('author_bio', cols)
        conn.close()

    def test_author_bio_word_limit_enforcement(self):
        # Within limit
        bio_valid = ' '.join(['biography'] * 150)
        self.assertLessEqual(text_word_count(bio_valid), MAX_AUTHOR_BIO_WORDS)

        # Exceeds limit
        bio_invalid = ' '.join(['biography'] * 201)
        self.assertGreater(text_word_count(bio_invalid), MAX_AUTHOR_BIO_WORDS)

    def test_preview_text_word_limit_enforcement(self):
        # 2,000 words (previously rejected under 1,500 limit, now accepted under 6,000 limit)
        text_2000 = ' '.join(['insight'] * 2000)
        self.assertLessEqual(text_word_count(text_2000), MAX_PREVIEW_WORDS)

        # Exceeding 6,000 words
        text_6001 = ' '.join(['word'] * 6001)
        self.assertGreater(text_word_count(text_6001), MAX_PREVIEW_WORDS)


if __name__ == '__main__':
    unittest.main()
