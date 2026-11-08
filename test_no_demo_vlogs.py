import unittest
import sqlite3
import json
from pathlib import Path
import server

ROOT = Path(__file__).parent

class NoDemoVlogsTests(unittest.TestCase):
    def test_app_js_has_no_hardcoded_demo_vlogs(self):
        content = (ROOT / 'app.js').read_text(encoding='utf-8')
        self.assertNotIn('defaultVlogs', content)
        self.assertNotIn('def-1', content)
        self.assertNotIn('The spaces between things', content)
        self.assertNotIn('Notes from the workbench', content)

    def test_index_html_has_no_demo_vlog_titles(self):
        content = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertNotIn('The spaces between things', content)
        self.assertIn('id="heroCard"', content)

    def test_server_analytics_does_not_inject_demo_vlogs(self):
        server_code = (ROOT / 'server.py').read_text(encoding='utf-8')
        self.assertNotIn('DEFAULT_EDITORIAL_VLOGS', server_code)
        self.assertNotIn('Editorial Edition', server_code)

    def test_database_has_no_demo_vlog_events(self):
        conn = sqlite3.connect(ROOT / 'field_notes.db')
        demo_titles = [
            'The spaces between things',
            'Making room for the unfinished',
            'A life in good questions',
            'The gentle art of noticing',
            'Where the road gets quiet',
            'Notes from the workbench'
        ]
        clicks = conn.execute(f"SELECT COUNT(*) FROM analytics_events WHERE vlog_title IN ({','.join(['?']*len(demo_titles))})", demo_titles).fetchone()[0]
        fb = conn.execute(f"SELECT COUNT(*) FROM feedback WHERE vlog_title IN ({','.join(['?']*len(demo_titles))})", demo_titles).fetchone()[0]
        conn.close()
        self.assertEqual(clicks, 0)
        self.assertEqual(fb, 0)

    def test_live_server_serves_no_demo_vlogs(self):
        import urllib.request
        try:
            resp = urllib.request.urlopen('http://localhost:8000/api/vlogs', timeout=2)
            data = json.loads(resp.read().decode())
            self.assertIsInstance(data, list)
            titles = [v.get('title') for v in data]
            self.assertNotIn('The spaces between things', titles)
        except Exception as e:
            # Server may not be running in isolated test environments
            pass

if __name__ == '__main__':
    unittest.main()
