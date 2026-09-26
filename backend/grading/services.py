"""
Grading business logic (SRS.md FR-26, FR-27; NFR-17: unit-tested here).

Scoring rule (documented choice — SRS is silent on partial credit):
- MCQ (single or multi): exact set-match of selected option IDs against the
  correct IDs earns full marks (exam.marks_per_question). Anything else earns
  0, minus exam.negative_marks_value when negative marking is on — except a
  blank answer, which is always 0 and never penalised.
- Short answer: never auto-graded here; left for the faculty queue (FR-27).

Per-question marks come from exam.marks_per_question (FR-9 exam config), not
Question.marks, so attempt totals stay consistent with exam.total_marks.
"""
import re
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings

# Tiny stopword list keeps the assist transparent and dependency-free.
_STOPWORDS = frozenset(
    'a an the and or but of to in on for with is are was were be been by as at '
    'it its this that these those i you he she we they them his her our your'.split()
)


def _max_marks(exam):
    return Decimal(str(exam.marks_per_question))


def grade_mcq_answer(question, selected_option_ids, exam):
    """
    Returns (is_correct: bool, marks: Decimal) for one MCQ answer.
    Never touches the database.
    """
    correct_ids = set(
        question.options.filter(is_correct=True).values_list('id', flat=True)
    )
    selected_ids = set(selected_option_ids or [])
    max_marks = _max_marks(exam)

    if not selected_ids:
        return False, Decimal('0')

    if selected_ids == correct_ids:
        return True, max_marks

    if exam.negative_marking:
        return False, -abs(Decimal(str(exam.negative_marks_value)))
    return False, Decimal('0')


def grade_attempt(attempt):
    """
    Auto-grade all objective answers in an attempt (FR-26) and refresh the
    attempt score. Short answers are left untouched (marks_awarded=None) for
    manual grading. Returns the number of answers auto-graded.
    """
    from exams.models import AttemptAnswer  # local import: exams imports this module

    exam = attempt.exam
    graded = 0
    for answer in AttemptAnswer.objects.filter(attempt=attempt).select_related('question'):
        q = answer.question
        if q.type not in ('mcq_single', 'mcq_multi'):
            continue
        is_correct, marks = grade_mcq_answer(q, answer.selected_option_ids, exam)
        answer.is_correct = is_correct
        answer.marks_awarded = marks
        answer.graded_by = None  # auto-graded, no human grader
        answer.save(update_fields=['is_correct', 'marks_awarded', 'graded_by'])
        graded += 1

    recompute_attempt_score(attempt)
    return graded


def recompute_attempt_score(attempt):
    """
    Attempt score = sum of all awarded marks (auto + manual). None while
    nothing has been graded yet (e.g. a pure short-answer exam awaiting the
    faculty queue) so callers can distinguish "ungraded" from "zero".
    """
    from exams.models import AttemptAnswer

    awarded = list(
        AttemptAnswer.objects.filter(
            attempt=attempt, marks_awarded__isnull=False
        ).values_list('marks_awarded', flat=True)
    )
    attempt.score = sum(awarded, Decimal('0')) if awarded else None
    attempt.save(update_fields=['score'])
    return attempt.score


def _keywords(text):
    tokens = re.findall(r'[a-z0-9]+', (text or '').lower())
    return {t for t in tokens if t not in _STOPWORDS and len(t) > 1}


def suggest_marks(answer):
    """
    AI-assist stretch goal (PRD.md §10): keyword-overlap suggestion for one
    short answer. Returns a dict with suggested_marks + rationale. Pure
    function — never writes to the database; the faculty always enters final
    marks via the grade endpoint (FR-27).

    Raises ValueError if the assist is disabled or cannot run.
    """
    if not getattr(settings, 'AI_ASSIST_GRADING_ENABLED', False):
        raise ValueError('AI-assist grading is disabled (AI_ASSIST_GRADING_ENABLED=False)')

    question = answer.question
    if question.type != 'short_answer':
        raise ValueError('Suggestions are only available for short-answer questions')
    if not (question.model_answer or '').strip():
        raise ValueError('No model answer set for this question')

    max_marks = _max_marks(answer.attempt.exam)
    expected = _keywords(question.model_answer)
    given = _keywords(answer.text_answer)
    matched = sorted(expected & given)

    if not expected:
        f1 = Decimal('0')
    else:
        precision = len(matched) / max(len(given), 1)
        recall = len(matched) / len(expected)
        f1 = Decimal(str(2 * precision * recall / (precision + recall))) if (precision + recall) else Decimal('0')

    suggested = (f1 * max_marks).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return {
        'method': 'keyword-overlap-f1',
        'suggested_marks': float(suggested),
        'max_marks': float(max_marks),
        'matched_keywords': matched,
        'expected_keyword_count': len(expected),
        'assist_only': True,
        'disclaimer': 'Suggestion only — verify against the model answer before grading.',
    }
