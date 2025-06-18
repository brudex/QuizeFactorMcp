import express from 'express';
import { 
  translateCategory, 
  translateCourse, 
  translateQuiz, 
  translateQuestions, 
  translateQuestion,
  extractQuestions,
  translateExtractedQuestions 
} from '../controllers/translationController.js';
import { uploadAny } from '../middleware/upload.js';

const router = express.Router();

// Translation routes
router.post('/category/:categoryUuid', translateCategory);
router.post('/course/:courseUuid', translateCourse);
router.post('/quiz/:quizUuid', translateQuiz);
router.post('/quiz/:quizUuid/questions', translateQuestions);
router.post('/question/:questionUuid', translateQuestion);

// Question extraction and translation routes
router.post('/quiz/:quizUuid/extract', uploadAny, extractQuestions);
router.post('/quiz/:quizUuid/translate-extracted', translateExtractedQuestions);

export default router; 