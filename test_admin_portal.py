import unittest
from pathlib import Path

ROOT = Path(__file__).parent

class AdminPortalTests(unittest.TestCase):
    def test_admin_portal_files_exist(self):
        self.assertTrue((ROOT / 'admin' / 'index.html').is_file())
        self.assertTrue((ROOT / 'admin' / 'admin.css').is_file())
        self.assertTrue((ROOT / 'admin' / 'admin.js').is_file())

    def test_public_site_fetches_backend_vlogs(self):
        app = (ROOT / 'app.js').read_text(encoding='utf-8')
        self.assertIn("fetch('/api/vlogs')", app)

    def test_backend_has_authenticated_vlog_listing(self):
        server = (ROOT / 'server.py').read_text(encoding='utf-8')
        self.assertIn("parsed.path == '/api/admin/vlogs'", server)
        self.assertIn("if not self.authenticated()", server)

    def test_contact_page_exists_and_linked(self):
        self.assertTrue((ROOT / 'contact.html').is_file())
        self.assertIn('contact.html', (ROOT / 'index.html').read_text(encoding='utf-8'))

if __name__ == '__main__':
    unittest.main()
