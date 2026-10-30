from django.db.models import Q
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import User
from authentication.permissions import require_role
from system.models import AuditLog, log_action
from .models import Course


def resolve_faculty_user(name):
    """Link a typed in-charge name to a faculty login account.

    Returns the active faculty user when the name uniquely matches one
    (email first, then username, then full name, all case-insensitive);
    otherwise None — the name is then kept as a plain label.
    """
    text = (name or '').strip()
    if not text:
        return None
    base = User.objects.filter(role=User.Role.FACULTY, is_active=True)
    user = base.filter(email__iexact=text).first()
    if user is not None:
        return user
    user = base.filter(username__iexact=text).first()
    if user is not None:
        return user
    lowered = text.lower()
    matches = [
        u for u in base
        if f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip().lower() == lowered
    ]
    if len(matches) == 1:
        return matches[0]
    return None


class AdminCourseSerializer(serializers.ModelSerializer):
    """Admin manage-courses serializer (create/edit/deactivate, never delete).

    Assigned faculty is free text: any name is accepted and stored in
    ``faculty_name``. When the typed name matches an active faculty login,
    the ``faculty`` link is set automatically so that faculty member gets
    the course in their dropdowns; otherwise the name stays a label.
    """
    faculty = serializers.PrimaryKeyRelatedField(read_only=True)
    linked_faculty = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            'id', 'code', 'name', 'description', 'faculty_name', 'faculty',
            'linked_faculty', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'faculty', 'created_at', 'updated_at']

    def get_linked_faculty(self, obj):
        if obj.faculty_id is None:
            return None
        user = obj.faculty
        return {
            'id': user.id,
            'display_name': user.get_full_name() or user.username,
            'email': user.email,
        }

    def validate_code(self, value):
        code = (value or '').strip()
        if not code:
            raise serializers.ValidationError('Course code is required.')
        qs = Course.objects.filter(code__iexact=code)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('A course with this code already exists.')
        return code

    def validate_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('Course name is required.')
        return name

    def validate_faculty_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('Faculty in-charge name is required.')
        return name

    def create(self, validated_data):
        course = Course(**validated_data)
        course.faculty = resolve_faculty_user(course.faculty_name)
        course.save()
        return course

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        instance.faculty = resolve_faculty_user(instance.faculty_name)
        instance.save(update_fields=['faculty', 'updated_at'])
        return instance


class AdminCourseViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """
    Admin-only course management (no destroy: courses stay referenced by
    exams, questions, and attempts; use is_active instead).

    GET    /api/admin/courses/       list (?q=, ?is_active=, paginated)
    POST   /api/admin/courses/       create
    GET    /api/admin/courses/{id}/  detail
    PATCH  /api/admin/courses/{id}/  edit (PUT also accepted)
    """
    queryset = Course.objects.select_related('faculty').all()
    serializer_class = AdminCourseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset().order_by('code')
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q))
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            v = is_active.strip().lower()
            if v in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif v in ('false', '0'):
                qs = qs.filter(is_active=False)
        return qs

    @require_role(User.Role.ADMIN)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    def perform_create(self, serializer):
        course = serializer.save()
        log_action(
            self.request.user, AuditLog.Action.COURSE_CREATE, course,
            {'code': course.code, 'name': course.name},
        )

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        course = serializer.save()
        if was_active and not course.is_active:
            action, details = AuditLog.Action.COURSE_DEACTIVATE, {'code': course.code}
        elif not was_active and course.is_active:
            action, details = AuditLog.Action.COURSE_REACTIVATE, {'code': course.code}
        else:
            action, details = AuditLog.Action.COURSE_UPDATE, {'code': course.code}
        log_action(self.request.user, action, course, details)


class AdminFacultyOptionsView(APIView):
    """
    Admin-only faculty directory and provisioning:
    GET  /api/admin/faculty/       list faculty (with active courses & contact info)
    POST /api/admin/faculty/       provision a new faculty account
    """
    permission_classes = [IsAuthenticated]

    @require_role(User.Role.ADMIN)
    def get(self, request):
        include_inactive = request.query_params.get('all', '').lower() in ('true', '1')
        qs = User.objects.filter(role=User.Role.FACULTY)
        if not include_inactive:
            qs = qs.filter(is_active=True)
        faculty = qs.order_by('first_name', 'last_name', 'username')
        return Response([
            {
                'id': u.id,
                'username': u.username,
                'email': u.email,
                'first_name': u.first_name,
                'last_name': u.last_name,
                'display_name': u.get_full_name() or u.username,
                'role': u.role,
                'is_active': u.is_active,
                'created_at': u.date_joined,
                'phone': getattr(u, 'phone', ''),
                'course_count': u.course_set.count() if hasattr(u, 'course_set') else 0,
                'courses': list(u.course_set.values_list('code', flat=True)) if hasattr(u, 'course_set') else [],
            }
            for u in faculty
        ])

    @require_role(User.Role.ADMIN)
    def post(self, request):
        data = request.data or {}
        username = str(data.get('username') or '').strip()
        email = str(data.get('email') or '').strip().lower()
        password = str(data.get('password') or '').strip()
        first_name = str(data.get('first_name') or '').strip()
        last_name = str(data.get('last_name') or '').strip()
        phone = str(data.get('phone') or '').strip()

        errors = {}
        if not username:
            errors['username'] = ['Username is required.']
        elif len(username) < 3:
            errors['username'] = ['Username must be at least 3 characters.']
        elif User.objects.filter(username__iexact=username).exists():
            errors['username'] = ['A user with this username already exists.']

        if not email:
            errors['email'] = ['Email is required.']
        elif '@' not in email or '.' not in email.split('@')[-1]:
            errors['email'] = ['Enter a valid email address.']
        elif User.objects.filter(email__iexact=email).exists():
            errors['email'] = ['A user with this email already exists.']

        if not password:
            errors['password'] = ['Password is required.']
        elif len(password) < 8:
            errors['password'] = ['Password must be at least 8 characters.']

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            role=User.Role.FACULTY,
            is_active=True,
        )
        if phone:
            user.phone = phone
            user.save(update_fields=['phone'])

        log_action(
            request.user,
            AuditLog.Action.FACULTY_CREATE,
            user,
            {
                'username': user.username,
                'email': user.email,
                'display_name': user.get_full_name() or user.username,
            },
        )

        return Response({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'display_name': user.get_full_name() or user.username,
            'role': user.role,
            'is_active': user.is_active,
            'created_at': user.date_joined,
            'phone': getattr(user, 'phone', ''),
            'course_count': 0,
            'courses': [],
        }, status=status.HTTP_201_CREATED)
