import unittest
import sqlite3
from server import create_user, validate_registration

class RegistrationValidationTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        from server import init_db
        init_db(self.conn)

    def test_registration_requires_matching_passwords_and_email(self):
        with self.assertRaises(ValueError):
            validate_registration(self.conn, 'writer', 'not-an-email', 'password123', 'password123', 'coadmin')
        with self.assertRaises(ValueError):
            validate_registration(self.conn, 'writer', 'writer@example.com', 'password123', 'different', 'coadmin')

    def test_registration_rejects_invalid_role(self):
        with self.assertRaises(ValueError):
            validate_registration(self.conn, 'owner2', 'owner@example.com', 'password123', 'password123', 'superadmin')

if __name__ == '__main__':
    unittest.main()
