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

    def test_strictly_one_admin_until_wiped(self):
        # 1. First admin can be registered
        validate_registration(self.conn, 'primaryadmin', 'admin@example.com', 'AdminPass123!', 'AdminPass123!', 'admin')
        create_user(self.conn, 'primaryadmin', 'AdminPass123!', 'admin', 'admin@example.com')

        # 2. Second admin must be rejected
        with self.assertRaises(ValueError) as ctx:
            validate_registration(self.conn, 'secondadmin', 'admin2@example.com', 'AdminPass123!', 'AdminPass123!', 'admin')
        self.assertIn('already exists', str(ctx.exception))

        with self.assertRaises(ValueError) as ctx2:
            create_user(self.conn, 'secondadmin', 'AdminPass123!', 'admin', 'admin2@example.com')
        self.assertIn('already exists', str(ctx2.exception))

        # 3. But co-admins can still register
        validate_registration(self.conn, 'firstcoadmin', 'co@example.com', 'AdminPass123!', 'AdminPass123!', 'coadmin')
        create_user(self.conn, 'firstcoadmin', 'AdminPass123!', 'coadmin', 'co@example.com')

        # 4. Once data is wiped out, an admin can be registered again
        self.conn.execute("DELETE FROM users")
        self.conn.commit()
        validate_registration(self.conn, 'newadmin', 'newadmin@example.com', 'AdminPass123!', 'AdminPass123!', 'admin')
        create_user(self.conn, 'newadmin', 'AdminPass123!', 'admin', 'newadmin@example.com')

if __name__ == '__main__':
    unittest.main()
