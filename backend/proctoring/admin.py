from django.contrib import admin
from .models import ProctoringEvent


@admin.register(ProctoringEvent)
class ProctoringEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'attempt', 'type', 'severity', 'timestamp', 'reviewed')
    list_filter = ('type', 'severity', 'reviewed')
    search_fields = ('attempt__student__username',)
    readonly_fields = ('timestamp',)
