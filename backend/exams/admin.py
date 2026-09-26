from django.contrib import admin
from .models import Course, Question, QuestionOption, Exam, ExamQuestion


class QuestionOptionInline(admin.TabularInline):
    model = QuestionOption
    extra = 4
    fields = ['text', 'is_correct', 'order']


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'faculty', 'created_at']
    list_filter = ['faculty', 'created_at']
    search_fields = ['code', 'name']
    ordering = ['code']


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ['text_preview', 'course', 'type', 'difficulty', 'topic', 'marks', 'created_by', 'created_at']
    list_filter = ['course', 'type', 'difficulty', 'created_at']
    search_fields = ['text', 'topic']
    inlines = [QuestionOptionInline]

    def text_preview(self, obj):
        return obj.text[:60] + '...' if len(obj.text) > 60 else obj.text
    text_preview.short_description = 'Question'


@admin.register(QuestionOption)
class QuestionOptionAdmin(admin.ModelAdmin):
    list_display = ['question', 'text_preview', 'is_correct', 'order']
    list_filter = ['is_correct']

    def text_preview(self, obj):
        return obj.text[:50] + '...' if len(obj.text) > 50 else obj.text
    text_preview.short_description = 'Option Text'


class ExamQuestionInline(admin.TabularInline):
    model = ExamQuestion
    extra = 1
    fields = ['question', 'order']
    autocomplete_fields = ['question']


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ['title', 'course', 'start_time', 'duration_minutes', 'is_published', 'results_published', 'proctoring_mode']
    list_filter = ['course', 'is_published', 'results_published', 'proctoring_mode', 'start_time']
    search_fields = ['title', 'course__code', 'course__name']
    inlines = [ExamQuestionInline]
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = (
        ('Basic Info', {
            'fields': ('course', 'title', 'created_by')
        }),
        ('Time Configuration', {
            'fields': ('start_time', 'end_time', 'duration_minutes')
        }),
        ('Question Configuration', {
            'fields': ('question_count', 'marks_per_question', 'shuffle_questions', 'shuffle_options')
        }),
        ('Scoring', {
            'fields': ('negative_marking', 'negative_marks_value')
        }),
        ('Proctoring', {
            'fields': ('proctoring_mode',)
        }),
        ('Publishing', {
            'fields': ('is_published', 'results_published')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(ExamQuestion)
class ExamQuestionAdmin(admin.ModelAdmin):
    list_display = ['exam', 'question', 'order']
    list_filter = ['exam']
    autocomplete_fields = ['exam', 'question']
