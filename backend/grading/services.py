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
import json
from decimal import Decimal, ROUND_HALF_UP

import requests
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
        from exams.models import is_mcq_type
        if not is_mcq_type(getattr(q, 'type', '')):
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


def _evaluate_with_gemini(question_text, model_answer, student_answer, max_marks):
    """
    Call Google Gemini API (gemini-flash-lite-latest) to evaluate student's subjective answer.
    Returns structured dict with suggested_marks, ideal_answer, missing_concepts, feedback, rationale.
    """
    api_key = getattr(settings, 'GEMINI_API_KEY', '').strip()
    if not api_key:
        return None

    prompt = f"""You are an expert academic evaluator. Assess a student's answer to a subjective exam question.

Question: {question_text}
Maximum Marks: {max_marks}
Faculty Reference / Model Answer: {model_answer or 'None provided (evaluate based on standard subject knowledge)'}
Student's Submitted Answer: {student_answer or '(No answer provided)'}

Evaluate the student answer thoroughly and return ONLY a valid JSON object matching this schema:
{{
  "suggested_marks": <number between 0 and {max_marks}>,
  "ideal_answer": "<Concise, complete explanation of what the correct answer should be>",
  "missing_concepts": "<Clear, direct summary of what key concepts, reasoning, or keywords are missing or incorrect in the student answer; or 'None - complete answer' if full marks>",
  "feedback": "<Constructive, polite feedback addressing the student directly>",
  "rationale": "<Short justification for the faculty explaining why these marks are suggested>"
}}
"""

    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key={api_key}'
    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {
            'responseMimeType': 'application/json'
        }
    }

    try:
        r = requests.post(url, json=payload, timeout=12)
        if r.status_code == 200:
            raw_text = r.json()['candidates'][0]['content']['parts'][0]['text']
            data = json.loads(raw_text)
            suggested = float(data.get('suggested_marks', 0.0))
            clamped = max(0.0, min(float(max_marks), suggested))
            return {
                'method': 'gemini-flash-lite',
                'suggested_marks': round(clamped, 2),
                'max_marks': float(max_marks),
                'ideal_answer': data.get('ideal_answer', model_answer or ''),
                'missing_concepts': data.get('missing_concepts', ''),
                'feedback': data.get('feedback', ''),
                'rationale': data.get('rationale', ''),
                'assist_only': True,
                'disclaimer': 'AI suggestion only — verify against the question and answer before grading.',
            }
    except Exception:
        pass
    return None


def suggest_marks(answer):
    """
    AI-assist (PRD.md §10): evaluates short answer subjective responses using
    Google Gemini (with graceful keyword-overlap fallback). Returns a dict with
    suggested_marks, ideal_answer, missing_concepts, feedback, and rationale.
    Pure function — never writes to the database; the faculty always enters final
    marks via the grade endpoint (FR-27).

    Raises ValueError if the assist is disabled or cannot run.
    """
    if not getattr(settings, 'AI_ASSIST_GRADING_ENABLED', False):
        raise ValueError('AI-assist grading is disabled (AI_ASSIST_GRADING_ENABLED=False)')

    question = answer.question
    if question.type != 'short_answer':
        raise ValueError('Suggestions are only available for short-answer questions')

    max_marks = _max_marks(answer.attempt.exam)
    model_ans = (question.model_answer or '').strip()
    student_ans = (answer.text_answer or '').strip()

    # 1. Try Gemini evaluation first if API key is configured
    gemini_result = _evaluate_with_gemini(question.text, model_ans, student_ans, max_marks)
    if gemini_result:
        matched = sorted(_keywords(model_ans) & _keywords(student_ans))
        gemini_result['matched_keywords'] = matched
        return gemini_result

    # 2. Fallback: Keyword-overlap F1 heuristic (ensures tests & offline mode work transparently)
    if not model_ans:
        raise ValueError('No model answer set for this question')

    expected = _keywords(model_ans)
    given = _keywords(student_ans)
    matched = sorted(expected & given)
    missing = sorted(expected - given)

    if not expected:
        f1 = Decimal('0')
    else:
        precision = len(matched) / max(len(given), 1)
        recall = len(matched) / len(expected)
        f1 = Decimal(str(2 * precision * recall / (precision + recall))) if (precision + recall) else Decimal('0')

    suggested = (f1 * max_marks).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    missing_desc = (
        f"Missing key terms from reference answer: {', '.join(missing)}"
        if missing else
        "Student answer aligns with reference keywords."
    )
    if not student_ans:
        missing_desc = "No answer was submitted by the student."

    return {
        'method': 'keyword-overlap-f1',
        'suggested_marks': float(suggested),
        'max_marks': float(max_marks),
        'ideal_answer': model_ans,
        'missing_concepts': missing_desc,
        'feedback': f"Concept overlap: {len(matched)}/{len(expected)} matched terms.",
        'rationale': "Calculated via keyword match ratio against faculty reference answer.",
        'matched_keywords': matched,
        'expected_keyword_count': len(expected),
        'assist_only': True,
        'disclaimer': 'Suggestion only — verify against the model answer before grading.',
    }
