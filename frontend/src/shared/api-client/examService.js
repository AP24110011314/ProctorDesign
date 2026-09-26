import apiClient from './apiClient';

/**
 * Question Bank API service
 * Implements SRS.md FR-6 to FR-8
 */
export const questionService = {
  // Get all questions with filters
  getQuestions: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.course) params.append('course', filters.course);
    if (filters.type) params.append('type', filters.type);
    if (filters.difficulty) params.append('difficulty', filters.difficulty);
    if (filters.topic) params.append('topic', filters.topic);

    const response = await apiClient.get(`/questions/?${params.toString()}`);
    return response.data;
  },

  // Get single question by ID
  getQuestion: async (id) => {
    const response = await apiClient.get(`/questions/${id}/`);
    return response.data;
  },

  // Create new question
  createQuestion: async (questionData) => {
    const response = await apiClient.post('/questions/', questionData);
    return response.data;
  },

  // Update question
  updateQuestion: async (id, questionData) => {
    const response = await apiClient.put(`/questions/${id}/`, questionData);
    return response.data;
  },

  // Delete question
  deleteQuestion: async (id) => {
    const response = await apiClient.delete(`/questions/${id}/`);
    return response.data;
  },
};

/**
 * Exam Configuration API service
 * Implements SRS.md FR-9 to FR-12
 */
export const examService = {
  // Get all exams with filters
  getExams: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.course) params.append('course', filters.course);

    const response = await apiClient.get(`/exams/?${params.toString()}`);
    return response.data;
  },

  // Get single exam by ID
  getExam: async (id) => {
    const response = await apiClient.get(`/exams/${id}/`);
    return response.data;
  },

  // Create new exam
  createExam: async (examData) => {
    const response = await apiClient.post('/exams/', examData);
    return response.data;
  },

  // Update exam
  updateExam: async (id, examData) => {
    const response = await apiClient.put(`/exams/${id}/`, examData);
    return response.data;
  },

  // Delete exam
  deleteExam: async (id) => {
    const response = await apiClient.delete(`/exams/${id}/`);
    return response.data;
  },

  // Publish exam
  publishExam: async (id) => {
    const response = await apiClient.post(`/exams/${id}/publish/`);
    return response.data;
  },

  // Unpublish exam
  unpublishExam: async (id) => {
    const response = await apiClient.post(`/exams/${id}/unpublish/`);
    return response.data;
  },

  // Add questions to exam
  addQuestions: async (id, questionIds) => {
    const response = await apiClient.post(`/exams/${id}/add_questions/`, {
      question_ids: questionIds,
    });
    return response.data;
  },

  // Preview exam
  previewExam: async (id) => {
    const response = await apiClient.get(`/exams/${id}/preview/`);
    return response.data;
  },
};

/**
 * Course API service
 */
export const courseService = {
  // Get all courses
  getCourses: async () => {
    const response = await apiClient.get('/courses/');
    return response.data;
  },

  // Get single course
  getCourse: async (id) => {
    const response = await apiClient.get(`/courses/${id}/`);
    return response.data;
  },

  // Create course
  createCourse: async (courseData) => {
    const response = await apiClient.post('/courses/', courseData);
    return response.data;
  },

  // Update course
  updateCourse: async (id, courseData) => {
    const response = await apiClient.put(`/courses/${id}/`, courseData);
    return response.data;
  },

  // Delete course
  deleteCourse: async (id) => {
    const response = await apiClient.delete(`/courses/${id}/`);
    return response.data;
  },
};
