import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from server import word_count, is_allowed_document, make_session_token

class BackendRulesTests(unittest.TestCase):
    def test_word_count_reads_docx_xml_text(self):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document><w:t>Hello</w:t><w:t>world</w:t></w:document>')
        self.assertEqual(word_count(payload.getvalue(), 'story.docx'), 2)

    def test_word_count_rejects_more_than_1500_words(self):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document><w:t>' + ('word ' * 1501) + '</w:t></w:document>')
        self.assertGreater(word_count(payload.getvalue(), 'story.docx'), 1500)

    def test_only_word_document_extensions_are_allowed(self):
        self.assertTrue(is_allowed_document('story.docx'))
        self.assertTrue(is_allowed_document('story.doc'))
        self.assertFalse(is_allowed_document('story.pdf'))
        self.assertFalse(is_allowed_document('story.exe'))

    def test_session_tokens_are_not_reused(self):
        self.assertNotEqual(make_session_token(), make_session_token())

if __name__ == '__main__':
    unittest.main()
