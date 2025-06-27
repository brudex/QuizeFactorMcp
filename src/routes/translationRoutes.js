import express from 'express';
import { 
  translateCategory, 
  translateCourse, 
  translateQuiz, 
  translateQuestions, 
  // translateQuestion,
  extractQuestions,
  translateExtractedQuestions,
  getQuizInfo,
  getTranslationStatus,
  getQueueStatus,
  cancelTranslation
} from '../controllers/translationController.js';
import { uploadAny } from '../middleware/upload.js';

const router = express.Router();

// Quiz information route
router.get('/quiz/:quizUuid/info', getQuizInfo);

// Direct translation routes (translate existing content)
router.post('/category/:categoryUuid', translateCategory);
router.post('/course/:courseUuid', translateCourse);
router.post('/quiz/:quizUuid', translateQuiz);
router.post('/quiz/:quizUuid/questions', translateQuestions);
// router.post('/question/:questionUuid', translateQuestion);

// Two-step process routes (extract then translate)
// Step 1: Extract questions from document (without translation)
router.post('/quiz/:quizUuid/extract', uploadAny, extractQuestions);

// Step 2: Translate the extracted questions
router.post('/quiz/:quizUuid/translate-extracted', translateExtractedQuestions);

// Queue management routes
router.get('/status/:queueId', getTranslationStatus);
router.get('/queue-status', getQueueStatus);
router.delete('/cancel/:queueId', cancelTranslation);

export default router; 