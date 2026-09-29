from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from .models import User


class UserSerializer(serializers.ModelSerializer):
    """
    Basic user serializer - never exposes password_hash (SRS.md NFR-5)
    is_superuser is exposed read-only so the SPA can route superusers
    whose role field is not 'admin' to the admin console (server-side
    RBAC already bypasses role checks for superusers).
    """
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_superuser', 'phone', 'reference_photo_url', 'created_at']
        read_only_fields = ['id', 'is_superuser', 'created_at']


class RegisterSerializer(serializers.ModelSerializer):
    """
    Registration serializer with password validation (SRS.md FR-2)
    """
    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={'input_type': 'password'}
    )
    password_confirm = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password_confirm', 'first_name', 'last_name', 'role', 'phone']
        extra_kwargs = {
            'email': {'required': True},
            'first_name': {'required': True},
            'last_name': {'required': True},
        }

    def validate_email(self, value):
        """Reject duplicate emails (email is the login identifier)."""
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        """Validate password confirmation matches"""
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password": "Password fields didn't match."})
        return attrs

    def validate_role(self, value):
        """
        Per UI_UX_SPEC.md §4.1: Faculty/Admin accounts should be created by Admin,
        not self-registered. Only allow student self-registration.
        """
        if value in [User.Role.FACULTY, User.Role.ADMIN]:
            raise serializers.ValidationError("Faculty and Admin accounts must be created by an administrator.")
        return value

    def create(self, validated_data):
        """Create user with hashed password (SRS.md FR-2)"""
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')

        user = User.objects.create(**validated_data)
        user.set_password(password)  # Hash the password
        user.save()

        return user


class LoginSerializer(serializers.Serializer):
    """
    Login serializer (SRS.md FR-3)
    """
    email = serializers.EmailField(required=True)
    password = serializers.CharField(
        required=True,
        write_only=True,
        style={'input_type': 'password'}
    )


class UserProfileSerializer(serializers.ModelSerializer):
    """
    Extended user profile with more detail for authenticated user
    """
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'phone', 'reference_photo_url', 'created_at', 'updated_at']
        read_only_fields = ['id', 'username', 'role', 'created_at', 'updated_at']
