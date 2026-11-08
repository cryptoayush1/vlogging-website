import json
import sqlite3
import unittest
from server import (
    create_user, authenticate_user, set_user_active, list_users, init_db, DB_PATH,
    send_registration_email, send_suspension_email, SENT_EMAILS
)

class UserAccessTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        init_db(self.conn)

    def test_registration_hashes_password_and_authenticates(self):
        user_id = create_user(self.conn, 'writer1', 'secret-pass', 'coadmin')
        self.assertIsInstance(user_id, int)
        self.assertEqual(authenticate_user(self.conn, 'writer1', 'secret-pass')['role'], 'coadmin')
        self.assertIsNone(authenticate_user(self.conn, 'writer1', 'wrong'))

    def test_admin_can_disable_coadmin_access(self):
        user_id = create_user(self.conn, 'writer2', 'secret-pass', 'coadmin')
        set_user_active(self.conn, user_id, False)
        self.assertIsNone(authenticate_user(self.conn, 'writer2', 'secret-pass'))

    def test_only_admin_role_can_be_created_by_policy(self):
        with self.assertRaises(ValueError):
            create_user(self.conn, 'bad', 'secret-pass', 'owner')

    def test_admin_can_list_users_without_passwords(self):
        create_user(self.conn, 'writer3', 'secret-pass', 'coadmin')
        users = list_users(self.conn)
        self.assertEqual(users[0]['username'], 'writer3')
        self.assertNotIn('password_hash', users[0])

    def test_bot_sends_registration_email_with_credentials(self):
        import time
        SENT_EMAILS.clear()
        send_registration_email('testwriter', 'testwriter@gmail.com', 'Pass1234!', 'coadmin')
        time.sleep(0.1)
        self.assertTrue(len(SENT_EMAILS) >= 1)
        mail = SENT_EMAILS[-1]
        self.assertEqual(mail['to'], 'testwriter@gmail.com')
        self.assertIn('testwriter', mail['body'])
        self.assertIn('Pass1234!', mail['body'])
        self.assertIn('COADMIN', mail['body'])

    def test_bot_sends_admin_registration_email(self):
        import time
        SENT_EMAILS.clear()
        send_registration_email('bossadmin', 'admin@example.com', 'SuperSecret99!', 'admin')
        time.sleep(0.1)
        self.assertTrue(len(SENT_EMAILS) >= 1)
        mail = SENT_EMAILS[-1]
        self.assertEqual(mail['to'], 'admin@example.com')
        self.assertIn('bossadmin', mail['body'])
        self.assertIn('SuperSecret99!', mail['body'])
        self.assertIn('ADMIN', mail['body'])
        self.assertIn('Administrator', mail['subject'])

    def test_bot_sends_suspension_email(self):
        import time
        SENT_EMAILS.clear()
        send_suspension_email('badactor', 'badactor@gmail.com')
        time.sleep(0.1)
        self.assertTrue(len(SENT_EMAILS) >= 1)
        mail = SENT_EMAILS[-1]
        self.assertEqual(mail['to'], 'badactor@gmail.com')
        self.assertIn('SUSPENDED', mail['body'])
        self.assertIn('badactor', mail['body'])
        self.assertIn('badactor@gmail.com', mail['body'])

    def test_registration_email_uses_dynamic_live_admin_url(self):
        import time, os
        SENT_EMAILS.clear()
        send_registration_email('livewriter', 'live@gmail.com', 'Pass1234!', 'coadmin', request_host='my-vlog-studio.onrender.com')
        time.sleep(0.1)
        self.assertTrue(len(SENT_EMAILS) >= 1)
        mail = SENT_EMAILS[-1]
        self.assertIn('https://my-vlog-studio.onrender.com/admin/', mail['body'])

        # Test with RENDER_EXTERNAL_URL env var
        os.environ['RENDER_EXTERNAL_URL'] = 'https://cloud-admin.onrender.com'
        SENT_EMAILS.clear()
        send_registration_email('cloudwriter', 'cloud@gmail.com', 'Pass1234!', 'coadmin')
        time.sleep(0.1)
        mail2 = SENT_EMAILS[-1]
        self.assertIn('https://cloud-admin.onrender.com/admin/', mail2['body'])
        del os.environ['RENDER_EXTERNAL_URL']

if __name__ == '__main__':
    unittest.main()
