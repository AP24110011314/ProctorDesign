from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

User = get_user_model()


class AuthenticationTests(TestCase):
    """
    Test suite for authentication functionality (SRS.md FR-1 to FR-5)
    Per SRS.md NFR-17: Core business logic should have automated tests
    """

    def setUp(self):
        self.client = APIClient()
        self.register_url = '/api/auth/register/'
        self.login_url = '/api/auth/login/'
        self.logout_url = '/api/auth/logout/'
        self.profile_url = '/api/auth/profile/'

        # Test user data
        self.student_data = {
            'username': 'teststudent',
            'email': 'student@example.edu',
            'password': 'SecurePass123!',
            'password_confirm': 'SecurePass123!',
            'first_name': 'Test',
            'last_name': 'Student',
            'role': 'student'
        }

    def test_student_registration(self):
        """Test FR-1: Student self-registration"""
        response = self.client.post(self.register_url, self.student_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('tokens', response.data)
        self.assertIn('user', response.data)
        self.assertEqual(response.data['user']['role'], 'student')

    def test_password_hashing(self):
        """Test FR-2: Passwords stored hashed, never plaintext"""
        self.client.post(self.register_url, self.student_data, format='json')
        user = User.objects.get(email=self.student_data['email'])
        # Password should be hashed (not equal to plaintext)
        self.assertNotEqual(user.password, self.student_data['password'])
        # But check_password should work
        self.assertTrue(user.check_password(self.student_data['password']))

    def test_faculty_self_registration_blocked(self):
        """Test UI_UX_SPEC.md §4.1: Faculty/Admin cannot self-register"""
        faculty_data = self.student_data.copy()
        faculty_data['role'] = 'faculty'
        response = self.client.post(self.register_url, faculty_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_mismatch(self):
        """Test registration with mismatched passwords"""
        data = self.student_data.copy()
        data['password_confirm'] = 'DifferentPass123!'
        response = self.client.post(self.register_url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_login_success(self):
        """Test FR-3: Successful login returns JWT tokens"""
        # Register first
        self.client.post(self.register_url, self.student_data, format='json')

        # Login
        login_data = {
            'email': self.student_data['email'],
            'password': self.student_data['password']
        }
        response = self.client.post(self.login_url, login_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('tokens', response.data)
        self.assertIn('access', response.data['tokens'])
        self.assertIn('refresh', response.data['tokens'])

    def test_login_invalid_credentials(self):
        """Test FR-3: Login fails with invalid credentials"""
        self.client.post(self.register_url, self.student_data, format='json')

        login_data = {
            'email': self.student_data['email'],
            'password': 'WrongPassword123!'
        }
        response = self.client.post(self.login_url, login_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_profile_requires_authentication(self):
        """Test FR-4: Authenticated endpoints require valid JWT"""
        response = self.client.get(self.profile_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_profile_with_authentication(self):
        """Test authenticated user can access their profile"""
        # Register
        response = self.client.post(self.register_url, self.student_data, format='json')
        token = response.data['tokens']['access']

        # Access profile with token
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        response = self.client.get(self.profile_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['email'], self.student_data['email'])

    def test_logout(self):
        """Test FR-3: Logout blacklists refresh token"""
        # Register and get tokens
        response = self.client.post(self.register_url, self.student_data, format='json')
        access_token = response.data['tokens']['access']
        refresh_token = response.data['tokens']['refresh']

        # Logout
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        response = self.client.post(self.logout_url, {'refresh': refresh_token}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
