/**
 * Standalone Demo Mode Service for ProctoX.
 *
 * Ensures that the application works seamlessly on hosted preview environments
 * (such as Vercel) even when a live Django/PostgreSQL backend has not been connected.
 *
 * Provides realistic data and state persistence via localStorage for:
 * - Authentication (Admin, Faculty, Student demo credentials)
 * - System Overview & Audit Log
 * - Course Management (list, create, edit, activate/deactivate)
 * - Question Bank (MCQ Single, MCQ Multi, Short Answer, add/edit/delete)
 * - Exam Management & Exam Builder (create, publish, unpublish, preview)
 * - Live Proctor Monitoring Room (active attempts, real-time flags, timeline)
 * - Subjective Grading Queue (AI suggestion simulation, grade & feedback)
 * - Results & Integrity Reports (scores, CSV/PDF mock export, voiding)
 */

const STORAGE_KEY = 'proctox_demo_store_v1';

const INITIAL_STORE = {
  users: [
    {
      id: 1,
      username: 'admin',
      email: 'admin@proctox.edu',
      first_name: 'System',
      last_name: 'Administrator',
      role: 'admin',
      is_superuser: true,
      phone: '+1-555-0100',
    },
    {
      id: 2,
      username: 'faculty',
      email: 'faculty@proctox.edu',
      first_name: 'Dr. Alan',
      last_name: 'Turing',
      role: 'faculty',
      is_superuser: false,
      phone: '+1-555-0101',
    },
    {
      id: 3,
      username: 'student',
      email: 'student@proctox.edu',
      first_name: 'Alex',
      last_name: 'Taylor',
      role: 'student',
      is_superuser: false,
      phone: '+1-555-0102',
    },
  ],
  passwords: {
    'admin@proctox.edu': 'AdminPass123!',
    'admin': 'AdminPass123!',
    'faculty@proctox.edu': 'FacultyPass123!',
    'faculty': 'FacultyPass123!',
    'student@proctox.edu': 'StudentPass123!',
    'student': 'StudentPass123!',
  },
  courses: [
    {
      id: 1,
      code: 'CS101',
      name: 'Data Structures & Algorithms',
      description: 'Foundational computer science topics: arrays, trees, graphs, sorting, and complexity.',
      faculty: 2,
      faculty_name: 'Dr. Alan Turing',
      faculty_email: 'faculty@proctox.edu',
      faculty_user: 2,
      is_active: true,
      created_at: new Date(Date.now() - 86400000 * 14).toISOString(),
      updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 2,
      code: 'CS202',
      name: 'Cloud & Distributed Systems',
      description: 'Microservices, RESTful design, horizontal scaling, and web security.',
      faculty: 2,
      faculty_name: 'Dr. Alan Turing',
      faculty_email: 'faculty@proctox.edu',
      faculty_user: 2,
      is_active: true,
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
      updated_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
    {
      id: 3,
      code: 'CS303',
      name: 'Computer Networks & Security',
      description: 'TCP/IP protocol stack, network encryption, firewalls, and proctoring telemetry.',
      faculty: 2,
      faculty_name: 'Dr. Alan Turing',
      faculty_email: 'faculty@proctox.edu',
      faculty_user: 2,
      is_active: true,
      created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      updated_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
  ],
  questions: [
    {
      id: 1,
      course: 1,
      course_name: 'CS101 - Data Structures & Algorithms',
      type: 'mcq_single',
      difficulty: 'medium',
      topic: 'Sorting & Algorithms',
      marks: 2.0,
      text: 'What is the worst-case time complexity of quicksort when using standard Hoare/Lomuto partitioning without randomization?',
      model_answer: '',
      created_by: 2,
      options: [
        { id: 11, text: 'O(n log n)', is_correct: false, order: 1 },
        { id: 12, text: 'O(n^2)', is_correct: true, order: 2 },
        { id: 13, text: 'O(n)', is_correct: false, order: 3 },
        { id: 14, text: 'O(log n)', is_correct: false, order: 4 },
      ],
    },
    {
      id: 2,
      course: 1,
      course_name: 'CS101 - Data Structures & Algorithms',
      type: 'mcq_multi',
      difficulty: 'hard',
      topic: 'Self-Balancing Trees',
      marks: 3.0,
      text: 'Which of the following data structures maintain keys in sorted order with guaranteed O(log n) lookup?',
      model_answer: '',
      created_by: 2,
      options: [
        { id: 21, text: 'Red-Black Tree', is_correct: true, order: 1 },
        { id: 22, text: 'AVL Tree', is_correct: true, order: 2 },
        { id: 23, text: 'Unsorted Doubly Linked List', is_correct: false, order: 3 },
        { id: 24, text: 'Standard Hash Table (Chaining)', is_correct: false, order: 4 },
      ],
    },
    {
      id: 3,
      course: 1,
      course_name: 'CS101 - Data Structures & Algorithms',
      type: 'short_answer',
      difficulty: 'easy',
      topic: 'Operating Systems & Concurrency',
      marks: 5.0,
      text: 'Explain the primary architectural difference between a process and a thread in modern operating systems.',
      model_answer: 'Processes have independent virtual memory address spaces and isolated resources. Threads share memory space and open files with other threads in the same process, making context switching cheaper.',
      created_by: 2,
      options: [],
    },
    {
      id: 4,
      course: 2,
      course_name: 'CS202 - Cloud & Distributed Systems',
      type: 'mcq_single',
      difficulty: 'medium',
      topic: 'Distributed Consensus',
      marks: 2.5,
      text: 'In distributed systems following the CAP theorem, which property must be relaxed during a network partition if high availability is prioritized?',
      model_answer: '',
      created_by: 2,
      options: [
        { id: 41, text: 'Consistency (C)', is_correct: true, order: 1 },
        { id: 42, text: 'Availability (A)', is_correct: false, order: 2 },
        { id: 43, text: 'Partition Tolerance (P)', is_correct: false, order: 3 },
        { id: 44, text: 'Latency (L)', is_correct: false, order: 4 },
      ],
    },
  ],
  exams: [
    {
      id: 1,
      title: 'CS101 Midterm Examination',
      course: 1,
      course_name: 'CS101 - Data Structures & Algorithms',
      duration_minutes: 60,
      question_count: 3,
      marks_per_question: 3.33,
      total_marks: 10.0,
      is_published: true,
      results_published: false,
      proctoring_mode: 'basic',
      start_time: new Date(Date.now() - 3600000 * 2).toISOString(),
      end_time: new Date(Date.now() + 86400000 * 7).toISOString(),
      created_by: 2,
    },
    {
      id: 2,
      title: 'CS202 Cloud Architecture Assessment',
      course: 2,
      course_name: 'CS202 - Cloud & Distributed Systems',
      duration_minutes: 45,
      question_count: 2,
      marks_per_question: 5.0,
      total_marks: 10.0,
      is_published: true,
      results_published: true,
      proctoring_mode: 'strict',
      start_time: new Date(Date.now() - 86400000 * 3).toISOString(),
      end_time: new Date(Date.now() - 86400000 * 1).toISOString(),
      created_by: 2,
    },
  ],
  attempts: [
    {
      id: 101,
      exam: 1,
      exam_id: 1,
      exam_title: 'CS101 Midterm Examination',
      student: 3,
      student_name: 'Alex Taylor',
      student_username: 'student',
      status: 'submitted',
      score: 7.5,
      integrity_score: 84.5,
      started_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      submitted_at: new Date(Date.now() - 3600000 * 1).toISOString(),
      flag_count: 2,
      unreviewed_count: 1,
    },
    {
      id: 102,
      exam: 1,
      exam_id: 1,
      exam_title: 'CS101 Midterm Examination',
      student: 4,
      student_name: 'Jordan Lee',
      student_username: 'jordan_l',
      status: 'in_progress',
      score: null,
      integrity_score: 96.0,
      started_at: new Date(Date.now() - 1800000).toISOString(),
      submitted_at: null,
      flag_count: 0,
      unreviewed_count: 0,
    },
    {
      id: 103,
      exam: 2,
      exam_id: 2,
      exam_title: 'CS202 Cloud Architecture Assessment',
      student: 3,
      student_name: 'Alex Taylor',
      student_username: 'student',
      status: 'submitted',
      score: 9.0,
      integrity_score: 98.0,
      started_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      submitted_at: new Date(Date.now() - 86400000 * 2 + 1800000).toISOString(),
      flag_count: 0,
      unreviewed_count: 0,
    },
  ],
  gradingQueue: [
    {
      id: 201,
      exam_id: 1,
      exam_title: 'CS101 Midterm Examination',
      student_name: 'Alex Taylor',
      student_username: 'student',
      question_id: 3,
      question_text: 'Explain the primary architectural difference between a process and a thread in modern operating systems.',
      model_answer: 'Processes have independent virtual memory address spaces and isolated resources. Threads share memory space and open files with other threads in the same process, making context switching cheaper.',
      student_answer: 'Processes have separate address spaces and independent resources like file descriptors. Threads share the same address space and memory within a parent process, resulting in lighter context switching and lower overhead.',
      text_answer: 'Processes have separate address spaces and independent resources like file descriptors. Threads share the same address space and memory within a parent process, resulting in lighter context switching and lower overhead.',
      max_marks: 5.0,
      marks_awarded: null,
      feedback: '',
    },
  ],
  proctoringEvents: [
    {
      id: 501,
      attempt: 101,
      attempt_student: 'student',
      type: 'multiple_faces',
      severity: 'high',
      timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(),
      reviewed: false,
      reviewed_by_username: null,
      evidence: null,
    },
    {
      id: 502,
      attempt: 101,
      attempt_student: 'student',
      type: 'tab_switch',
      severity: 'medium',
      timestamp: new Date(Date.now() - 3600000 * 1.8).toISOString(),
      reviewed: true,
      reviewed_by_username: 'faculty',
      evidence: null,
    },
  ],
  auditLog: [
    {
      id: 1,
      timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
      actor: 1,
      actor_username: 'admin',
      action: 'system.bootstrap',
      target_type: 'system',
      target_id: 1,
      details: { reason: 'System initial bootstrap and demo dataset verified' },
    },
    {
      id: 2,
      timestamp: new Date(Date.now() - 86400000 * 1.5).toISOString(),
      actor: 2,
      actor_username: 'faculty',
      action: 'exam.publish',
      target_type: 'exam',
      target_id: 1,
      details: { reason: 'Published CS101 Midterm Examination for registered students' },
    },
    {
      id: 3,
      timestamp: new Date(Date.now() - 3600000 * 1).toISOString(),
      actor: 3,
      actor_username: 'student',
      action: 'attempt.submit',
      target_type: 'attempt',
      target_id: 101,
      details: { reason: 'Submitted CS101 Midterm Examination within allotted duration' },
    },
  ],
};

const getStore = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_STORE));
      return JSON.parse(JSON.stringify(INITIAL_STORE));
    }
    return JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(INITIAL_STORE));
  }
};

const saveStore = (store) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('Unable to persist demo store:', err);
  }
};

/**
 * Checks whether an incoming request can be served by Demo Mock Mode.
 */
export const isDemoModeActive = () => {
  if (typeof window === 'undefined') return false;
  // If explicitly flagged
  if (localStorage.getItem('proctox_demo_mode') === 'true') return true;
  // If running on a remote host (e.g. *.vercel.app) where backend URL is missing or set to localhost
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const isHosted = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  if (isHosted && (!apiBase || apiBase.includes('localhost') || apiBase.includes('127.0.0.1'))) {
    return true;
  }
  return false;
};

export const activateDemoMode = () => {
  try {
    localStorage.setItem('proctox_demo_mode', 'true');
  } catch {}
};

/**
 * Mock Request Handler: resolves endpoints against local demo state.
 */
export const handleMockRequest = async (config) => {
  const store = getStore();
  const method = (config.method || 'get').toLowerCase();
  const url = (config.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');

  const parseBody = () => {
    if (!config.data) return {};
    if (typeof config.data === 'string') {
      try {
        return JSON.parse(config.data);
      } catch {
        return {};
      }
    }
    return config.data;
  };

  const body = parseBody();

  // Helper response generator
  const ok = (data, status = 200) => ({
    data,
    status,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    config,
  });

  const err = (message, status = 400, code = 'error') => {
    const error = new Error(message);
    error.response = {
      data: { error: { code, message } },
      status,
      statusText: 'Bad Request',
      headers: {},
      config,
    };
    return Promise.reject(error);
  };

  // 1. Auth: Login
  if (url === '/auth/login/' && method === 'post') {
    const identifier = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');

    // Check against store users
    const user = store.users.find(
      (u) => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier
    );

    const expectedPass = store.passwords[identifier] || 'AdminPass123!';

    if (!user || (password !== expectedPass && password !== 'AdminPass123!' && password !== 'FacultyPass123!' && password !== 'StudentPass123!')) {
      return err('Invalid credentials. Check email and password.', 401, 'invalid_credentials');
    }

    activateDemoMode();

    return ok({
      message: 'Login successful (Demo Mode)',
      user,
      tokens: {
        access: `demo_jwt_access_token_${user.role}_${Date.now()}`,
        refresh: `demo_jwt_refresh_token_${user.role}_${Date.now()}`,
      },
    });
  }

  // 2. Auth: Register
  if (url === '/auth/register/' && method === 'post') {
    const newUser = {
      id: Date.now(),
      username: body.username || `user_${Date.now()}`,
      email: body.email,
      first_name: body.first_name || 'New',
      last_name: body.last_name || 'User',
      role: 'student',
      is_superuser: false,
      phone: body.phone || '',
    };
    store.users.push(newUser);
    store.passwords[newUser.email.toLowerCase()] = body.password;
    saveStore(store);

    activateDemoMode();

    return ok({
      message: 'Registration successful (Demo Mode)',
      user: newUser,
      tokens: {
        access: `demo_jwt_access_token_student_${Date.now()}`,
        refresh: `demo_jwt_refresh_token_student_${Date.now()}`,
      },
    }, 201);
  }

  // 3. System Overview
  if (url === '/system/overview/' && method === 'get') {
    const flagged = store.attempts.filter((a) => a.flag_count > 0 && a.status !== 'voided');
    const voided = store.attempts.filter((a) => a.status === 'voided');
    const active = store.attempts.filter((a) => a.status === 'in_progress');

    return ok({
      total_exams: store.exams.length,
      active_attempts: active.length,
      flagged_needing_review: flagged.length,
      pending_grading: store.gradingQueue.length,
      voided_attempts: voided.length,
      users_by_role: {
        student: store.users.filter((u) => u.role === 'student').length + 9, // + realistic baseline
        faculty: store.users.filter((u) => u.role === 'faculty').length,
        admin: store.users.filter((u) => u.role === 'admin').length,
      },
      flagged_attempts: flagged.map((a) => ({
        attempt_id: a.id,
        student_username: a.student_username,
        exam_title: a.exam_title,
        status: a.status,
        unreviewed_count: a.unreviewed_count,
        integrity_score: a.integrity_score,
      })),
    });
  }

  // 4. Audit Log
  if (url.startsWith('/system/audit-log/') && method === 'get') {
    return ok({ results: store.auditLog });
  }

  // 5. Void Attempt
  const voidMatch = url.match(/^\/attempts\/(\d+)\/void\/$/);
  if (voidMatch && method === 'post') {
    const attemptId = parseInt(voidMatch[1], 10);
    const attempt = store.attempts.find((a) => a.id === attemptId);
    if (attempt) {
      attempt.status = 'voided';
    }
    store.auditLog.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      actor: 1,
      actor_username: 'admin',
      action: 'attempt.void',
      target_type: 'attempt',
      target_id: attemptId,
      details: { reason: body.reason || 'Admin voided attempt' },
    });
    saveStore(store);
    return ok({ message: `Attempt ${attemptId} voided successfully.` });
  }

  // 6. Courses (Admin & Faculty)
  const courseSingleMatch = url.match(/^(\/admin)?\/courses\/(\d+)\/?$/);
  if (courseSingleMatch && method === 'get') {
    const courseId = parseInt(courseSingleMatch[2], 10);
    const course = store.courses.find((c) => c.id === courseId);
    return course ? ok(course) : err('Course not found', 404);
  }

  if (courseSingleMatch && (method === 'patch' || method === 'put')) {
    const courseId = parseInt(courseSingleMatch[2], 10);
    const course = store.courses.find((c) => c.id === courseId);
    if (course) {
      Object.assign(course, body, { updated_at: new Date().toISOString() });
      saveStore(store);
      return ok(course);
    }
    return err('Course not found', 404);
  }

  if (courseSingleMatch && method === 'delete') {
    const courseId = parseInt(courseSingleMatch[2], 10);
    store.courses = store.courses.filter((c) => c.id !== courseId);
    saveStore(store);
    return ok({ message: 'Course deleted successfully' });
  }

  if ((url.startsWith('/admin/courses') || url.startsWith('/courses')) && method === 'post') {
    const newCourse = {
      id: Date.now(),
      code: body.code,
      name: body.name,
      description: body.description || '',
      faculty_name: body.faculty_name || 'Dr. Alan Turing',
      faculty_email: 'faculty@proctox.edu',
      faculty_user: 2,
      is_active: body.is_active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.courses.unshift(newCourse);
    saveStore(store);
    return ok(newCourse, 201);
  }

  if ((url.startsWith('/admin/courses') || url.startsWith('/courses')) && method === 'get' && !url.includes('/admin/faculty/')) {
    return ok({ results: store.courses });
  }

  // 7. Admin Faculty Options
  if (url.startsWith('/admin/faculty') && method === 'get') {
    const facultyList = store.users
      .filter((u) => u.role === 'faculty')
      .map((u) => ({
        id: u.id,
        display_name: `${u.first_name} ${u.last_name}`,
        email: u.email,
      }));
    return ok(facultyList);
  }

  // 8. Questions
  const qSingleMatch = url.match(/^\/questions\/(\d+)\/?$/);
  if (qSingleMatch && method === 'get') {
    const qId = parseInt(qSingleMatch[1], 10);
    const question = store.questions.find((q) => q.id === qId);
    return question ? ok(question) : err('Question not found', 404);
  }

  if (qSingleMatch && method === 'delete') {
    const qId = parseInt(qSingleMatch[1], 10);
    store.questions = store.questions.filter((q) => q.id !== qId);
    saveStore(store);
    return ok({ message: 'Question deleted' });
  }

  if (qSingleMatch && (method === 'put' || method === 'patch')) {
    const qId = parseInt(qSingleMatch[1], 10);
    const question = store.questions.find((q) => q.id === qId);
    if (question) {
      Object.assign(question, body);
      saveStore(store);
      return ok(question);
    }
    return err('Question not found', 404);
  }

  if (url.startsWith('/questions') && method === 'post') {
    const newQ = {
      id: Date.now(),
      course: body.course,
      course_name: store.courses.find((c) => c.id === body.course)?.name || 'Course',
      type: body.type,
      difficulty: body.difficulty,
      topic: body.topic || '',
      marks: parseFloat(body.marks) || 1.0,
      text: body.text,
      model_answer: body.model_answer || '',
      created_by: 2,
      options: (body.options || []).map((o, idx) => ({
        id: Date.now() + idx,
        text: o.text,
        is_correct: Boolean(o.is_correct),
        order: idx + 1,
      })),
    };
    store.questions.unshift(newQ);
    saveStore(store);
    return ok(newQ, 201);
  }

  if (url.startsWith('/questions') && method === 'get') {
    return ok({ results: store.questions });
  }

  // 9. Exams
  const examPreviewMatch = url.match(/^\/exams\/(\d+)\/preview\/?$/);
  if (examPreviewMatch && method === 'get') {
    const examId = parseInt(examPreviewMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId) || store.exams[0];
    return ok({
      exam,
      questions: store.questions,
    });
  }

  const examAddQuestionsMatch = url.match(/^\/exams\/(\d+)\/add_questions\/?$/);
  if (examAddQuestionsMatch && method === 'post') {
    const examId = parseInt(examAddQuestionsMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    if (exam && Array.isArray(body.question_ids)) {
      exam.question_count = body.question_ids.length;
      saveStore(store);
    }
    return ok({ message: 'Questions added to exam' });
  }

  const examSingleMatch = url.match(/^\/exams\/(\d+)\/?$/);
  if (examSingleMatch && method === 'get') {
    const examId = parseInt(examSingleMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    return exam ? ok(exam) : err('Exam not found', 404);
  }

  if (examSingleMatch && (method === 'put' || method === 'patch')) {
    const examId = parseInt(examSingleMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    if (exam) {
      Object.assign(exam, body);
      saveStore(store);
      return ok(exam);
    }
    return err('Exam not found', 404);
  }

  if (examSingleMatch && method === 'delete') {
    const examId = parseInt(examSingleMatch[1], 10);
    store.exams = store.exams.filter((e) => e.id !== examId);
    saveStore(store);
    return ok({ message: 'Exam deleted' });
  }

  const monitorMatch = url.match(/^\/exams\/(\d+)\/monitor\/?$/);
  if (monitorMatch && method === 'get') {
    const examId = parseInt(monitorMatch[1], 10);
    return ok({
      active_attempts: store.attempts.filter((a) => a.exam_id === examId || a.exam === examId),
      recent_events: store.proctoringEvents,
    });
  }

  const examPublishMatch = url.match(/^\/exams\/(\d+)\/publish\/?$/);
  if (examPublishMatch && method === 'post') {
    const examId = parseInt(examPublishMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    if (exam) {
      exam.is_published = true;
      saveStore(store);
      return ok({ message: 'Exam published' });
    }
  }

  const examUnpublishMatch = url.match(/^\/exams\/(\d+)\/unpublish\/?$/);
  if (examUnpublishMatch && method === 'post') {
    const examId = parseInt(examUnpublishMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    if (exam) {
      exam.is_published = false;
      saveStore(store);
      return ok({ message: 'Exam unpublished' });
    }
  }

  if (url.startsWith('/exams') && method === 'post') {
    const newExam = {
      id: Date.now(),
      title: body.title,
      course: body.course,
      course_name: store.courses.find((c) => c.id === body.course)?.name || 'Course',
      duration_minutes: parseInt(body.duration_minutes, 10) || 60,
      question_count: (body.question_ids || []).length || 3,
      marks_per_question: 3.33,
      total_marks: 10.0,
      is_published: false,
      results_published: false,
      proctoring_mode: body.proctoring_mode || 'basic',
      start_time: body.start_time || new Date().toISOString(),
      end_time: body.end_time || new Date(Date.now() + 86400000 * 7).toISOString(),
      created_by: 2,
    };
    store.exams.unshift(newExam);
    saveStore(store);
    return ok(newExam, 201);
  }

  if (url.startsWith('/exams') && method === 'get') {
    return ok({ results: store.exams });
  }

  // 10. Grading
  const exportMatch = url.match(/^\/grading\/exams\/(\d+)\/export\/?/);
  if (exportMatch && method === 'get') {
    const csvContent =
      'Student,Username,Exam,Status,Score,IntegrityScore\n' +
      'Alex Taylor,student,CS101 Midterm Examination,submitted,7.5,84.5\n' +
      'Jordan Lee,jordan_l,CS101 Midterm Examination,in_progress,,96.0\n' +
      'Alex Taylor,student,CS202 Cloud Architecture Assessment,submitted,9.0,98.0\n';
    return ok(csvContent);
  }

  if (url.startsWith('/grading/answers') && method === 'get') {
    return ok(store.gradingQueue);
  }

  const gradeAnswerMatch = url.match(/^\/grading\/answers\/(\d+)\/grade\/?$/);
  if (gradeAnswerMatch && method === 'post') {
    const answerId = parseInt(gradeAnswerMatch[1], 10);
    store.gradingQueue = store.gradingQueue.filter((q) => q.id !== answerId);
    saveStore(store);
    return ok({ message: 'Grade saved' });
  }

  if (url.includes('/grading/answers/') && url.endsWith('/suggest/') && method === 'post') {
    return ok({ suggested_marks: 4.5, feedback: 'Accurately explains virtual memory isolation vs shared heap/threads.' });
  }

  const gradingPublishMatch = url.match(/^\/grading\/exams\/(\d+)\/publish\/?$/);
  if (gradingPublishMatch && method === 'post') {
    const examId = parseInt(gradingPublishMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    if (exam) exam.results_published = true;
    saveStore(store);
    return ok({ message: 'Results published' });
  }

  const gradingUnpublishMatch = url.match(/^\/grading\/exams\/(\d+)\/unpublish\/?$/);
  if (gradingUnpublishMatch && method === 'post') {
    const examId = parseInt(gradingUnpublishMatch[1], 10);
    const exam = store.exams.find((e) => e.id === examId);
    if (exam) exam.results_published = false;
    saveStore(store);
    return ok({ message: 'Results unpublished' });
  }

  // 11. Attempts & Exam-Taking Workflow
  if (url.startsWith('/attempts/start_exam') && method === 'post') {
    const examId = parseInt(body.exam_id, 10) || 1;
    const exam = store.exams.find((e) => e.id === examId) || store.exams[0];
    let attempt = store.attempts.find((a) => (a.exam === examId || a.exam_id === examId) && a.student_username === 'student');
    if (!attempt) {
      attempt = {
        id: Date.now(),
        exam: exam.id,
        exam_id: exam.id,
        exam_title: exam.title,
        student: 3,
        student_name: 'Alex Taylor',
        student_username: 'student',
        status: 'in_progress',
        score: null,
        integrity_score: 98.0,
        started_at: new Date().toISOString(),
        submitted_at: null,
        flag_count: 0,
        unreviewed_count: 0,
        answers: {},
      };
      store.attempts.unshift(attempt);
      saveStore(store);
    }
    return ok({
      id: attempt.id,
      attempt_id: attempt.id,
      exam: exam.id,
      exam_title: exam.title,
      student: 3,
      student_name: 'Alex Taylor',
      student_username: 'student',
      status: attempt.status,
      started_at: attempt.started_at,
      remaining_time_seconds: (exam.duration_minutes || 60) * 60,
      questions: store.questions.map((q, idx) => ({
        question_id: q.id,
        question_text: q.text,
        question_type: q.type,
        marks: q.marks,
        order: idx + 1,
        options: (q.options || []).map((opt) =>
          typeof opt === 'string' ? { id: opt, text: opt } : { id: opt.id, text: opt.text }
        ),
      })),
      answers: attempt.answers || {},
    });
  }

  const refPhotoMatch = url.match(/^\/attempts\/(\d+)\/reference_photo\/?$/);
  if (refPhotoMatch && method === 'post') {
    return ok({ message: 'Reference photo recorded successfully' });
  }

  const checkTimeMatch = url.match(/^\/attempts\/(\d+)\/check_time\/?$/);
  if (checkTimeMatch && method === 'get') {
    return ok({
      remaining_seconds: 2700,
      expired: false,
      auto_submitted: false,
    });
  }

  const saveAnswerMatch = url.match(/^\/attempts\/(\d+)\/save_answer\/?$/);
  if (saveAnswerMatch && method === 'post') {
    const attemptId = parseInt(saveAnswerMatch[1], 10);
    const attempt = store.attempts.find((a) => a.id === attemptId);
    if (attempt) {
      if (!attempt.answers) attempt.answers = {};
      if (body.question_id) {
        attempt.answers[body.question_id] = body;
      }
      saveStore(store);
    }
    return ok({ message: 'Answer saved' });
  }

  const attemptEventMatch = url.match(/^\/attempts\/(\d+)\/events\/?$/);
  if (attemptEventMatch && method === 'post') {
    const attemptId = parseInt(attemptEventMatch[1], 10);
    const newEvent = {
      id: Date.now(),
      attempt: attemptId,
      attempt_student: 'student',
      type: body.event_type || body.type || 'multiple_faces',
      severity: body.severity || 'medium',
      timestamp: new Date().toISOString(),
      reviewed: false,
      reviewed_by_username: null,
      evidence: null,
    };
    store.proctoringEvents.unshift(newEvent);
    const attempt = store.attempts.find((a) => a.id === attemptId);
    if (attempt) {
      attempt.flag_count = (attempt.flag_count || 0) + 1;
      attempt.unreviewed_count = (attempt.unreviewed_count || 0) + 1;
      attempt.integrity_score = Math.max(0, (attempt.integrity_score || 100) - 5);
    }
    saveStore(store);
    return ok({ message: 'Event logged', event_id: newEvent.id }, 201);
  }

  const submitMatch = url.match(/^\/attempts\/(\d+)\/submit\/?$/);
  if (submitMatch && method === 'post') {
    const attemptId = parseInt(submitMatch[1], 10);
    const attempt = store.attempts.find((a) => a.id === attemptId);
    if (attempt) {
      attempt.status = 'submitted';
      attempt.submitted_at = new Date().toISOString();
      attempt.score = 8.5;
      saveStore(store);
    }
    return ok({ message: 'Exam submitted successfully', score: 8.5 });
  }

  const attemptResultMatch = url.match(/^\/attempts\/(\d+)\/result\/?$/);
  if (attemptResultMatch && method === 'get') {
    const attemptId = parseInt(attemptResultMatch[1], 10);
    const attempt = store.attempts.find((a) => a.id === attemptId) || store.attempts[0];
    const exam = store.exams.find((e) => e.id === attempt.exam) || store.exams[0];
    return ok({
      attempt_id: attempt.id,
      exam_id: exam.id,
      exam_title: exam.title,
      score: attempt.score ?? 9.0,
      max_score: exam.total_marks || 10.0,
      submitted_at: attempt.submitted_at || new Date().toISOString(),
      items: [
        {
          question_id: 1,
          question_text: 'What is the worst-case time complexity of quicksort when using standard Hoare/Lomuto partitioning without randomization?',
          question_type: 'mcq_single',
          selected_options: ['O(n^2)'],
          text_answer: '',
          is_correct: true,
          marks_awarded: 2.0,
          max_marks: 2.0,
          grading_feedback: 'Correct! Worst-case occurs on already sorted arrays without pivot randomization.',
        },
        {
          question_id: 2,
          question_text: 'Which of the following data structures maintain keys in sorted order with guaranteed O(log n) lookup?',
          question_type: 'mcq_multi',
          selected_options: ['Red-Black Tree', 'AVL Tree'],
          text_answer: '',
          is_correct: true,
          marks_awarded: 3.0,
          max_marks: 3.0,
          grading_feedback: 'All correct selections made.',
        },
        {
          question_id: 3,
          question_text: 'Explain the primary architectural difference between a process and a thread in modern operating systems.',
          question_type: 'short_answer',
          selected_options: [],
          text_answer: 'Processes have independent virtual memory address spaces and isolated resources. Threads share memory space and open files with other threads in the same process.',
          is_correct: true,
          marks_awarded: 4.0,
          max_marks: 5.0,
          grading_feedback: 'Clear explanation of memory space isolation vs lightweight threads.',
        },
      ],
    });
  }

  const attemptDetailMatch = url.match(/^\/attempts\/(\d+)\/?$/);
  if (attemptDetailMatch && method === 'get') {
    const attemptId = parseInt(attemptDetailMatch[1], 10);
    const attempt = store.attempts.find((a) => a.id === attemptId) || store.attempts[0];
    const exam = store.exams.find((e) => e.id === attempt.exam) || store.exams[0];
    return ok({
      id: attempt.id,
      attempt_id: attempt.id,
      exam: exam.id,
      exam_title: exam.title,
      student: attempt.student,
      student_name: attempt.student_name,
      student_username: attempt.student_username,
      status: attempt.status,
      score: attempt.score,
      integrity_score: attempt.integrity_score,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      remaining_time_seconds: 2700,
      questions: store.questions.map((q, idx) => ({
        question_id: q.id,
        question_text: q.text,
        question_type: q.type,
        marks: q.marks,
        order: idx + 1,
        options: (q.options || []).map((opt) =>
          typeof opt === 'string' ? { id: opt, text: opt } : { id: opt.id, text: opt.text }
        ),
      })),
      answers: attempt.answers || {},
    });
  }

  if (url.startsWith('/attempts') && method === 'get') {
    return ok({ results: store.attempts });
  }

  // 12. Proctoring events review & query
  const reviewMatch = url.match(/^\/proctoring\/events\/(\d+)\/review\/?$/);
  if (reviewMatch && method === 'post') {
    const eventId = parseInt(reviewMatch[1], 10);
    const event = store.proctoringEvents.find((e) => e.id === eventId);
    if (event) {
      event.reviewed = true;
      event.reviewed_by_username = 'admin';
      saveStore(store);
    }
    return ok({ message: 'Event marked reviewed' });
  }

  if (url.startsWith('/proctoring/events') && method === 'get') {
    return ok({ results: store.proctoringEvents });
  }

  return ok({ message: 'Mock response success', results: [] });
};
