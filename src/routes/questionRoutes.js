import express from 'express';
import { uploadDocument } from '../controllers/questionController.js';
import { uploadAny } from '../middleware/upload.js';

const router = express.Router();

// Upload document to extract questions and create quiz
router.post('/upload', uploadAny, uploadDocument);

export default router; 