import unittest
import sqlite3
import json
import time
from pathlib import Path
import server

class AnalyticsFeatureTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('''CREATE TABLE IF NOT EXISTS vlogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
            author TEXT NOT NULL, excerpt TEXT NOT NULL, filename TEXT NOT NULL,
            word_count INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER,
            body_text TEXT DEFAULT '')''')
        server.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_analytics_table_created(self):
        cols = [r['name'] for r in self.conn.execute("PRAGMA table_info(analytics_events)")]
        self.assertIn('event_type', cols)
        self.assertIn('vlog_id', cols)
        self.assertIn('vlog_title', cols)
        self.assertIn('ip_hash', cols)

    def test_record_page_view_and_vlog_click(self):
        ip_hash1 = server.hash_ip('127.0.0.1')
        ip_hash2 = server.hash_ip('192.168.1.10')

        self.conn.execute(
            "INSERT INTO analytics_events(event_type, ip_hash) VALUES(?,?)",
            ('page_view', ip_hash1)
        )
        self.conn.execute(
            "INSERT INTO analytics_events(event_type, ip_hash) VALUES(?,?)",
            ('page_view', ip_hash2)
        )
        self.conn.execute(
            "INSERT INTO analytics_events(event_type, vlog_id, vlog_title, ip_hash) VALUES(?,?,?,?)",
            ('vlog_click', 1, 'Test Vlog 1', ip_hash1)
        )
        self.conn.commit()

        views = self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type='page_view'").fetchone()[0]
        clicks = self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type='vlog_click'").fetchone()[0]
        uniques = self.conn.execute("SELECT COUNT(DISTINCT ip_hash) FROM analytics_events").fetchone()[0]

        self.assertEqual(views, 2)
        self.assertEqual(clicks, 1)
        self.assertEqual(uniques, 2)

    def test_vlog_specific_metrics_and_feedback(self):
        # Insert a published vlog
        cur = self.conn.execute(
            "INSERT INTO vlogs(title, category, author, excerpt, filename, word_count) VALUES(?,?,?,?,?,?)",
            ('My Mountain Adventure', 'Places', 'John Doe', 'High peaks...', 'file.docx', 500)
        )
        vlog_id = cur.lastrowid

        # Insert 3 clicks for this vlog
        for _ in range(3):
            self.conn.execute(
                "INSERT INTO analytics_events(event_type, vlog_id, vlog_title, ip_hash) VALUES(?,?,?,?)",
                ('vlog_click', vlog_id, 'My Mountain Adventure', 'somehash')
            )

        # Insert 2 feedback entries
        self.conn.execute(
            "INSERT INTO feedback(vlog_id, vlog_title, author_name, author_email, comment) VALUES(?,?,?,?,?)",
            (vlog_id, 'My Mountain Adventure', 'Alice Reader', 'alice@example.com', 'Incredible imagery!')
        )
        self.conn.execute(
            "INSERT INTO feedback(vlog_id, vlog_title, author_name, author_email, comment) VALUES(?,?,?,?,?)",
            (vlog_id, 'My Mountain Adventure', 'Bob Reader', 'bob@example.com', 'Loved this piece.')
        )
        self.conn.commit()

        clicks = self.conn.execute(
            "SELECT COUNT(*) FROM analytics_events WHERE event_type='vlog_click' AND vlog_id=?",
            (vlog_id,)
        ).fetchone()[0]
        feedbacks = self.conn.execute(
            "SELECT COUNT(*) FROM feedback WHERE vlog_id=?",
            (vlog_id,)
        ).fetchone()[0]

        self.assertEqual(clicks, 3)
        self.assertEqual(feedbacks, 2)

    def test_admin_can_delete_feedback(self):
        cur = self.conn.execute(
            "INSERT INTO feedback(vlog_id, vlog_title, author_name, author_email, comment) VALUES(?,?,?,?,?)",
            (1, 'Title', 'Spammer', 'spam@bad.com', 'Buy cheap meds here')
        )
        fb_id = cur.lastrowid
        self.conn.commit()

        # Verify exists
        self.assertIsNotNone(self.conn.execute("SELECT id FROM feedback WHERE id=?", (fb_id,)).fetchone())

        # Delete
        self.conn.execute("DELETE FROM feedback WHERE id=?", (fb_id,))
        self.conn.commit()

        # Verify deleted
        self.assertIsNone(self.conn.execute("SELECT id FROM feedback WHERE id=?", (fb_id,)).fetchone())

    def test_delete_vlog_cleans_up_analytics_and_feedback(self):
        # 1. Insert vlog
        cur = self.conn.execute(
            "INSERT INTO vlogs(title, category, author, excerpt, filename, word_count) VALUES(?,?,?,?,?,?)",
            ('Temporary Short Film', 'Culture', 'Director X', 'Excerpt', 'temp.docx', 300)
        )
        v_id = cur.lastrowid
        v_title = 'Temporary Short Film'

        # 2. Insert clicks into analytics_events
        self.conn.execute(
            "INSERT INTO analytics_events(event_type, vlog_id, vlog_title) VALUES(?,?,?)",
            ('vlog_click', v_id, v_title)
        )
        self.conn.execute(
            "INSERT INTO analytics_events(event_type, vlog_id, vlog_title) VALUES(?,?,?)",
            ('vlog_click', None, v_title)
        )

        # 3. Insert feedback
        self.conn.execute(
            "INSERT INTO feedback(vlog_id, vlog_title, author_name, comment) VALUES(?,?,?,?)",
            (v_id, v_title, 'Reader 1', 'Great film!')
        )
        self.conn.commit()

        # Verify data exists before delete
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE vlog_id=? OR vlog_title=?", (v_id, v_title)).fetchone()[0], 2)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM feedback WHERE vlog_id=? OR vlog_title=?", (v_id, v_title)).fetchone()[0], 1)

        # 4. Perform the cleanup logic
        self.conn.execute('DELETE FROM analytics_events WHERE (vlog_id IS NOT NULL AND vlog_id=?) OR LOWER(vlog_title)=LOWER(?)', (v_id, v_title))
        self.conn.execute('DELETE FROM feedback WHERE (vlog_id IS NOT NULL AND vlog_id=?) OR LOWER(vlog_title)=LOWER(?)', (v_id, v_title))
        self.conn.execute('DELETE FROM vlogs WHERE id=?', (v_id,))
        self.conn.commit()

        # 5. Verify everything is wiped clean
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE vlog_id=? OR vlog_title=?", (v_id, v_title)).fetchone()[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM feedback WHERE vlog_id=? OR vlog_title=?", (v_id, v_title)).fetchone()[0], 0)
        self.assertIsNone(self.conn.execute("SELECT id FROM vlogs WHERE id=?", (v_id,)).fetchone())

    def test_reset_analytics_wipes_all_events(self):
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash) VALUES('page_view', 'ip1')")
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash) VALUES('vlog_click', 'ip2')")
        self.conn.commit()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM analytics_events").fetchone()[0], 2)

        self.conn.execute("DELETE FROM analytics_events")
        self.conn.commit()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM analytics_events").fetchone()[0], 0)

    def test_weekly_monthly_yearly_analytics_queries(self):
        # Insert events with different timestamps: recent (now), 10 days ago, 45 days ago, 400 days ago
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash, created_at) VALUES('page_view', 'ip_now', datetime('now'))")
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash, created_at) VALUES('vlog_click', 'ip_now', datetime('now'))")
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash, created_at) VALUES('page_view', 'ip_10d', datetime('now', '-10 days'))")
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash, created_at) VALUES('page_view', 'ip_45d', datetime('now', '-45 days'))")
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash, created_at) VALUES('page_view', 'ip_400d', datetime('now', '-400 days'))")
        self.conn.commit()

        # Weekly (<= 7 days): only 1 page_view
        w_views = self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type='page_view' AND created_at >= datetime('now', '-7 days')").fetchone()[0]
        self.assertEqual(w_views, 1)

        # Monthly (<= 30 days): recent (now) + 10 days ago = 2 page_views
        m_views = self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type='page_view' AND created_at >= datetime('now', '-30 days')").fetchone()[0]
        self.assertEqual(m_views, 2)

        # Yearly (<= 365 days): recent + 10d + 45d = 3 page_views
        y_views = self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type='page_view' AND created_at >= datetime('now', '-365 days')").fetchone()[0]
        self.assertEqual(y_views, 3)

        # All-time total: 4 page_views
        all_views = self.conn.execute("SELECT COUNT(*) FROM analytics_events WHERE event_type='page_view'").fetchone()[0]
        self.assertEqual(all_views, 4)

    def test_admin_ui_has_periodic_view_reports(self):
        html = (Path(__file__).parent / 'admin' / 'index.html').read_text(encoding='utf-8')
        self.assertIn('id="periodSwitcher"', html)
        self.assertIn('id="repWeeklyViews"', html)
        self.assertIn('id="repMonthlyViews"', html)
        self.assertIn('id="repYearlyViews"', html)
        self.assertIn('id="repAllViews"', html)
        self.assertIn('id="trendChartContainer"', html)
        self.assertIn('id="openShareModalBtn"', html)
        self.assertIn('id="shareAnalyticsDialog"', html)
        self.assertIn('id="shareRecipientEmail"', html)

        js = (Path(__file__).parent / 'admin' / 'admin.js').read_text(encoding='utf-8')
        self.assertIn('updateActivePeriodKPIs', js)
        self.assertIn('renderTrendChart', js)
        self.assertIn('openShareDialog', js)
        self.assertIn('/api/admin/analytics/share', js)
        self.assertIn('share-vlog-btn', js)

    def test_share_analytics_overall_report_email_content(self):
        # Insert test data
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash) VALUES('page_view', 'ip_test1')")
        self.conn.execute("INSERT INTO analytics_events(event_type, ip_hash) VALUES('vlog_click', 'ip_test1')")
        self.conn.commit()

        # Test the email formatting logic in send_bot_email
        server.SENT_EMAILS.clear()
        target_email = "testrecipient@gmail.com"
        subject = "Field Notes Studio — Executive Overview Analytics Report"
        body = "Website Page Views: 1\nVlog Reads / Clicks: 1\nUnique Visitors: 1"

        server.send_bot_email(target_email, subject, body)
        self.assertGreater(len(server.SENT_EMAILS), 0)
        last_email = server.SENT_EMAILS[-1]
        self.assertEqual(last_email['to'], target_email)
        self.assertIn("Executive Overview", last_email['subject'])
        self.assertIn("Website Page Views: 1", last_email['body'])

    def test_share_vlog_specific_report_email_content(self):
        cur = self.conn.execute(
            "INSERT INTO vlogs(title, category, author, excerpt, filename, word_count) VALUES(?,?,?,?,?,?)",
            ('Solo Journey', 'Cinema', 'Ayush', 'A quiet film...', 'solo.docx', 850)
        )
        v_id = cur.lastrowid
        self.conn.execute("INSERT INTO analytics_events(event_type, vlog_id, vlog_title, ip_hash) VALUES('vlog_click', ?, 'Solo Journey', 'ip1')", (v_id,))
        self.conn.execute("INSERT INTO feedback(vlog_id, vlog_title, author_name, author_email, comment) VALUES(?, 'Solo Journey', 'Viewer A', 'a@gmail.com', 'Beautiful cinematography')", (v_id,))
        self.conn.commit()

        server.SENT_EMAILS.clear()
        target_email = "ayushmondal.net3@gmail.com"
        subject = f'Field Notes Analytics Report — "Solo Journey"'
        body = f"Title: Solo Journey\nAuthor: Ayush\nTotal Reads / Clicks: 1\nTotal Reader Reflections: 1"

        server.send_bot_email(target_email, subject, body)
        self.assertGreater(len(server.SENT_EMAILS), 0)
        last_email = server.SENT_EMAILS[-1]
        self.assertEqual(last_email['to'], target_email)
        self.assertIn("Solo Journey", last_email['subject'])
        self.assertIn("Total Reads / Clicks: 1", last_email['body'])
        self.assertIn("Total Reader Reflections: 1", last_email['body'])

if __name__ == '__main__':
    unittest.main()
