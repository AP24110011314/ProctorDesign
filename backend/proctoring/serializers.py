from rest_framework import serializers
from .models import ProctoringEvent


class ProctoringEventSerializer(serializers.ModelSerializer):
    """Read serializer for flags; evidence access is scoped per-request (NFR-7)."""
    attempt_student = serializers.CharField(
        source='attempt.student.username', read_only=True)
    reviewed_by_username = serializers.CharField(
        source='reviewed_by.username', read_only=True, default=None)

    class Meta:
        model = ProctoringEvent
        fields = [
            'id', 'attempt', 'attempt_student', 'type', 'severity',
            'timestamp', 'evidence', 'metadata',
            'reviewed', 'reviewed_by_username', 'reviewed_at',
        ]
        read_only_fields = fields
