import axios from 'axios';
import { config } from '../config/config.js';
import { v4 as uuidv4 } from 'uuid';
import ragExtraction from './ragExtraction.js';

export class QuizFactorApiService {
  constructor() {
    this.apiBaseUrl = config.api.quizFactor.baseUrl;
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.apiBaseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api.quizFactor.apiKey}`,
        'X-API-Version': '1.0'
      },
      timeout: 30000 // 30 second timeout
    });

    // Add response interceptor for better error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          // Extract error details from response
          const errorData = error.response.data;
          const enhancedError = new Error(errorData.message || error.message);
          enhancedError.status = error.response.status;
          enhancedError.details = errorData.details || errorData;
          throw enhancedError;
        }
        throw error;
      }
    );
  }

  formatErrorMessage(error, context) {
    const baseError = error.response?.data || error;
    const status = error.response?.status;
    
    const errorMessages = {
      400: {
        'Tag name already exists': 'This category already exists in QuizFactor. Attempting to use existing category...',
        'default': 'The request was invalid. Please check your input data.'
      },
      401: 'Authentication failed. Please check your API credentials.',
      403: 'You do not have permission to perform this action.',
      404: 'The requested resource was not found.',
      409: 'A conflict occurred with existing data.',
      429: 'Too many requests. Please try again later.',
      500: 'An internal server error occurred. Please try again later.',
      default: 'An unexpected error occurred.'
    };

    const statusMessage = status ? 
      (errorMessages[status]?.[baseError.message] || errorMessages[status]?.default || errorMessages[status]) : 
      errorMessages.default;

    return {
      context,
      error: baseError.message || error.message,
      status: status || 'ERROR',
      message: statusMessage,
      details: baseError.details || null,
      timestamp: new Date().toISOString()
    };
  }

  logError(error, context) {
    const formattedError = this.formatErrorMessage(error, context);
    console.error('\n=== QuizFactor API Error ===');
    console.error(`Context: ${formattedError.context}`);
    console.error(`Status: ${formattedError.status}`);
    console.error(`Message: ${formattedError.message}`);
    console.error(`Error: ${formattedError.error}`);
    if (formattedError.details) {
      console.error('Details:', formattedError.details);
    }
    console.error(`Timestamp: ${formattedError.timestamp}`);
    console.error('===============================\n');
    return formattedError;
  }

  async determineCategoryFromContent(questions) {
    try {
      const categoryInfo = await ragExtraction.determineCategory(questions);
      return categoryInfo;
    } catch (error) {
      const formattedError = this.logError(error, 'Category Determination');
      return {
        name: "General Knowledge",
        description: "General academic questions and concepts",
        type: "academic",
        tagName: "general",
        confidence: "low",
        reason: `Defaulted due to error: ${formattedError.message}`
      };
    }
  }

  async createCourseCategory(categoryMetadata) {
    try {
      const categoryData = {
        name: categoryMetadata.name,
        description: categoryMetadata.description,
        type: categoryMetadata.type || 'academic',
        tagName: categoryMetadata.tagName,
        order: categoryMetadata.order || 1,
        translations: [
          {
            languageCode: 'en',
            name: categoryMetadata.name,
            description: categoryMetadata.description
          }
        ]
      };

      console.log('\n=== Creating Course Category ===');
      console.log('Category payload:', JSON.stringify(categoryData, null, 2));
      
      try {
        const response = await this.client.post('/api/ai/create-course-category', categoryData);
        console.log('✅ Category created successfully:', JSON.stringify(response.data, null, 2));
        
        // Extract category from nested response
        const category = response.data?.data?.category;
        if (!category || !category.uuid) {
          throw new Error('Invalid category response format');
        }
        return category;
      } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.message?.includes('Tag name already exists')) {
          console.log('🔄 Category already exists, fetching existing category...');
          const response = await this.client.get(`/api/ai/course-categories?tagName=${categoryMetadata.tagName}`);
          if (response.data && response.data.length > 0) {
            console.log('✅ Successfully retrieved existing category');
            return response.data[0];
          }
          throw new Error('Failed to fetch existing category');
        }
        throw error;
      }
    } catch (error) {
      const formattedError = this.logError(error, 'Course Category Creation');
      throw new Error(formattedError.message);
    }
  }

  async createCourse(categoryUuid, courseMetadata = {}) {
    try {
      if (!categoryUuid) {
        throw new Error('Category UUID is required for course creation');
      }

      const courseData = {
        categoryUuid,
        level: courseMetadata.level || 'beginner',
        duration: courseMetadata.duration || 60,
        imageUrl: courseMetadata.imageUrl || 'https://example.com/course-image.jpg',
        translations: [
          {
            languageCode: 'en',
            title: courseMetadata.title || `Course - ${new Date().toLocaleDateString()}`,
            description: courseMetadata.description || 'Automatically generated course'
          }
        ]
      };

      console.log('\n=== Creating Course ===');
      console.log('Course payload:', JSON.stringify(courseData, null, 2));
      
      try {
        const response = await this.client.post('/api/ai/create-course', courseData);
        console.log('✅ Course created successfully:', JSON.stringify(response.data, null, 2));
        
        // Extract course from response
        const course = response.data?.data?.course || response.data;
        if (!course || !course.uuid) {
          throw new Error('Invalid course response format');
        }
        return course;
      } catch (error) {
        if (error.response?.status === 500 && error.response?.data?.message?.includes('uuid')) {
          throw new Error(`Invalid category UUID: ${categoryUuid}`);
        }
        throw error;
      }
    } catch (error) {
      const formattedError = this.logError(error, 'Course Creation');
      throw new Error(formattedError.message);
    }
  }

  async verifyQuiz(quizUuid) {
    try {
    
      const response = await this.client.get(`/api/ai/quiz/${quizUuid}`);
  
      if (response.data?.status !== '00') {
        throw new Error(`Failed to verify quiz: ${response.data?.message || 'Unknown error'}`);
      }
      return response.data;
    } catch (error) {
      console.error('Error verifying quiz:', error);
      throw error;
    }
  }

  async createQuiz(courseUuid, topicUuid, metadata = {}) {
    try {
      if (!courseUuid) {
        throw new Error('Course UUID is required for quiz creation');
      }

      // Verify course exists first
      try {
        await this.client.get(`/api/ai/course/${courseUuid}`);
      } catch (error) {
        if (error.response?.status === 404) {
          throw new Error(`Course not found with UUID: ${courseUuid}`);
        }
        throw error;
      }

      const quizData = {
        courseUuid: courseUuid,
        topicUuid: topicUuid || null,
        difficulty: metadata.difficulty || 'medium',
        timeLimit: metadata.timeLimit || 30,
        passingScore: metadata.passingScore || 70,
        translations: [
          {
            languageCode: 'en',
            title: metadata.title || `Quiz - ${new Date().toLocaleDateString()}`,
            description: metadata.description || 'Automatically generated quiz'
          }
        ]
      };

      // Remove topicUuid if it's null to avoid API issues
      if (!quizData.topicUuid) {
        delete quizData.topicUuid;
      }

      console.log('\n=== Creating Quiz ===');
      console.log('Quiz payload:', JSON.stringify(quizData, null, 2));
      
      try {
        const response = await this.client.post('/api/ai/create-quiz', quizData);
        console.log('✅ Quiz created successfully:', JSON.stringify(response.data, null, 2));
        
        // Extract quiz from nested response
        const quiz = response.data?.data?.quiz || response.data;
        if (!quiz || !quiz.uuid) {
          throw new Error('Invalid quiz response format');
        }
        return quiz;
      } catch (error) {
        // Enhanced error handling
        if (error.response?.status === 401) {
          throw new Error('Authentication failed. Please check your API credentials.');
        } else if (error.response?.status === 403) {
          throw new Error('Permission denied. Please check your API access rights.');
        } else if (error.response?.status === 404) {
          throw new Error(`Course not found with UUID: ${courseUuid}`);
        } else if (error.response?.status === 400) {
          throw new Error(`Invalid quiz data: ${error.response.data.message}`);
        } else if (error.response?.status === 500) {
          throw new Error(`Server error while creating quiz: ${error.response.data.message}`);
        }
        throw error;
      }
    } catch (error) {
      const formattedError = this.logError(error, 'Quiz Creation');
      throw new Error(formattedError.message);
    }
  }

  async addQuestionsToQuiz(payload) {
    try {
      console.log(`Adding ${payload.questions.length} questions to quiz ${payload.quizUuid}`);
      
      const response = await this.client.post(
        '/api/ai/add-quiz-questions',
        payload
      );
      
      if (!response.data) {
        throw new Error('Failed to add questions to quiz: No response data');
      }

      // Extract questions from nested response
      const result = response.data?.data?.questions || response.data;
      if (!result) {
        throw new Error('Invalid questions response format');
      }
      
      console.log(`Successfully added ${payload.questions.length} questions to quiz ${payload.quizUuid}`);
      return result;
    } catch (error) {
      console.error('Error adding questions to quiz:', error.response?.data || error.message);
      if (error.response?.status === 404) {
        throw new Error(`Quiz not found with UUID: ${payload.quizUuid}`);
      }
      throw new Error(`Failed to add questions to quiz: ${error.message}`);
    }
  }

  async createQuizWithQuestions(questions, metadata = {}) {
    try {
      console.log('\n🚀 Starting Quiz Creation Flow');
      
      // Step 1: Determine category
      console.log('\n📊 Step 1: Determining Category');
      const categoryInfo = await this.determineCategoryFromContent(questions);
      console.log('Category determined:', categoryInfo);
      
      // Step 2: Create or get category
      console.log('\n📁 Step 2: Creating/Fetching Category');
      const categoryResponse = await this.createCourseCategory(categoryInfo);
      
      if (!categoryResponse.uuid) {
        throw new Error('Failed to get valid category UUID');
      }
      console.log('Category UUID:', categoryResponse.uuid);

      // Step 3: Create course
      console.log('\n📚 Step 3: Creating Course');
      const courseMetadata = {
        title: metadata.courseTitle || `Course for ${metadata.title || 'Generated Quiz'}`,
        description: metadata.courseDescription || 'Course containing automatically generated quiz',
        level: metadata.level || 'beginner',
        duration: metadata.duration || 60
      };
      
      const courseResponse = await this.createCourse(categoryResponse.uuid, courseMetadata);
      if (!courseResponse.uuid) {
        throw new Error('Failed to get valid course UUID');
      }
      
      console.log('Course UUID:', courseResponse.uuid);
      const topicUuid = courseResponse.topicUuid;
      if (topicUuid) console.log('Topic UUID:', topicUuid);

      // Step 4: Create quiz
      console.log('\n📝 Step 4: Creating Quiz');
      const quizMetadata = {
        ...metadata,
        courseUuid: courseResponse.uuid // Ensure courseUuid is included in metadata
      };
      const quizResponse = await this.createQuiz(courseResponse.uuid, topicUuid, quizMetadata);
      if (!quizResponse.uuid) {
        throw new Error('Failed to get valid quiz UUID');
      }
      console.log('Quiz UUID:', quizResponse.uuid);

      // Step 5: Add questions
      console.log('\n❓ Step 5: Adding Questions');
      const questionsResponse = await this.addQuestionsToQuiz(quizResponse.uuid, questions, metadata);

      console.log('\n✅ Quiz Creation Flow Completed Successfully!');
      return {
        category: categoryResponse,
        course: courseResponse,
        quiz: quizResponse,
        questions: questionsResponse
      };
    } catch (error) {
      const formattedError = this.logError(error, 'Quiz Creation Flow');
      throw new Error(`Quiz creation flow failed: ${formattedError.message}`);
    }
  }

  async updateQuizQuestions(quizUuid, questions) {
    try {
      const response = await this.client.post('/api/ai/add-quiz-questions', {
        quizUuid,
        questions
      });

      if (response.data?.status !== '00') {
        throw new Error(`Failed to update questions: ${response.data?.message || 'Unknown error'}`);
      }

      return response.data;
    } catch (error) {
      console.error('Error updating quiz questions:', error);
      throw error;
    }
  }
}

// Create and export a default instance
const defaultInstance = new QuizFactorApiService();
export default defaultInstance; 