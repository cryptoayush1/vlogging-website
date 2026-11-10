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

    def test_vlog_full_reading_page_exists_with_live_date_and_branding(self):
        self.assertTrue((ROOT / 'vlog.html').is_file())
        html = (ROOT / 'vlog.html').read_text(encoding='utf-8')
        self.assertIn('FIELD NOTES', html)
        self.assertIn('id="liveDayText"', html)
        self.assertIn('id="liveDateText"', html)
        self.assertIn('id="heroVlogTitle"', html)
        self.assertIn('id="articleBodyContainer"', html)
        self.assertIn('id="articleFeedbackForm"', html)

        app_js = (ROOT / 'app.js').read_text(encoding='utf-8')
        self.assertIn('/vlog.html?id=', app_js)

if __name__ == '__main__':
    unittest.main()
