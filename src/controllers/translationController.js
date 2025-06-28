import { v4 as uuidv4 } from 'uuid';
import translationService from '../services/translationService.js';
import translationQueue from '../services/translationQueue.js';
import documentProcessor from '../services/documentProcessor.js';
import quizFactorApiService from '../services/quizFactorApiService.js';
import { formatControllerError } from '../utils/errorHandler.js';
import fs from 'fs/promises';
import path from 'path';

const VALID_LANGUAGE_CODES = new Set([
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ru",
  "zh",
  "ja",
  "ko",
]);

const validateLanguages = (targetLanguages) => {
  if (
    !targetLanguages ||
    !Array.isArray(targetLanguages) ||
    targetLanguages.length === 0
  ) {
    return {
      isValid: false,
      error: "Invalid request",
      message: "Please provide an array of target languages",
    };
  }

  const invalidLanguages = targetLanguages.filter(
    (lang) => !VALID_LANGUAGE_CODES.has(lang)
  );
  if (invalidLanguages.length > 0) {
    return {
      isValid: false,
      error: "Invalid language codes",
      message: `Invalid language codes: ${invalidLanguages.join(", ")}`,
      validCodes: Array.from(VALID_LANGUAGE_CODES),
    };
  }

  return { isValid: true };
};

export const translateCategory = async (req, res) => {
  try {
    const { categoryUuid } = req.params;
    const { priority = 'normal' } = req.body; // Allow priority to be set

    // Validate category UUID
    if (!categoryUuid) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Category UUID is required",
      });
    }

    // Fetch available languages from quizFactor api
    const languages = await translationService.getLanguages();

    if (!languages || languages.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Configuration Error",
        message: "No target languages available for translation",
      });
    }

    // Extract language codes from the languages response
    const targetLanguages = languages.map((lang) => lang.code);

    // Add to translation queue
    const queueId = translationQueue.addToQueue('category', {
      categoryUuid,
      targetLanguages
    }, priority);

    // Get queue status for response
    const queueStatus = translationQueue.getStatus(queueId);

    // Send response with queue information
    res.status(202).json({
      success: true,
      message: "Translation request has been queued for processing",
      data: {
        queueId,
        status: "queued",
        queuePosition: queueStatus.queuePosition,
        totalInQueue: queueStatus.totalInQueue,
        estimatedStartTime: queueStatus.estimatedStartTime,
        categoryUuid,
        targetLanguages,
        checkStatusUrl: `/api/translation/status/${queueId}`
      },
    });

  } catch (error) {
    console.error("Translation Error:", error);
    const formattedError = formatControllerError(error, "Category Translation");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error || "Translation Error",
      message: formattedError.message || "An error occurred during translation",
    });
  }
};

export const translateCourse = async (req, res) => {
  try {
    const { courseUuid } = req.params;
    const { priority = 'normal' } = req.body;

    // Validate course UUID
    if (!courseUuid) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Course UUID is required",
      });
    }

    // Fetch available languages from quizFactor api
    const languages = await translationService.getLanguages();

    if (!languages || languages.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Configuration Error",
        message: "No target languages available for translation"
      });
    }

    // Extract language codes from the languages response
    const targetLanguages = languages.map(lang => lang.code);

    // Add to translation queue
    const queueId = translationQueue.addToQueue('course', {
      courseUuid,
      targetLanguages
    }, priority);

    // Get queue status for response
    const queueStatus = translationQueue.getStatus(queueId);

    // Send response with queue information
    res.status(202).json({
      success: true,
      message: "Course translation request has been queued",
      data: {
        queueId,
        status: "queued",
        queuePosition: queueStatus.queuePosition,
        totalInQueue: queueStatus.totalInQueue,
        estimatedStartTime: queueStatus.estimatedStartTime,
        courseUuid,
        targetLanguages,
        checkStatusUrl: `/api/translation/status/${queueId}`
      },
    });

  } catch (error) {
    const formattedError = formatControllerError(error, "Course Translation");
    res.status(formattedError.status).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

export const translateQuiz = async (req, res) => {
  try {
    const { quizUuid } = req.params;
    const { priority = 'normal' } = req.body;

    // Validate quiz UUID
    if (!quizUuid) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Quiz UUID is required",
      });
    }

    // Fetch available languages from quizFactor api
    const languages = await translationService.getLanguages();

    if (!languages || languages.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Configuration Error",
        message: "No target languages available for translation"
      });
    }

    // Extract language codes from the languages response
    const targetLanguages = languages.map(lang => lang.code);

    // Add to translation queue
    const queueId = translationQueue.addToQueue('quiz', {
      quizUuid,
      targetLanguages
    }, priority);

    // Get queue status for response
    const queueStatus = translationQueue.getStatus(queueId);

    // Send response with queue information
    res.status(202).json({
      success: true,
      message: "Quiz translation request has been queued",
      data: {
        queueId,
        status: "queued",
        queuePosition: queueStatus.queuePosition,
        totalInQueue: queueStatus.totalInQueue,
        estimatedStartTime: queueStatus.estimatedStartTime,
        quizUuid,
        targetLanguages,
        checkStatusUrl: `/api/translation/status/${queueId}`
      },
    });

  } catch (error) {
    const formattedError = formatControllerError(error, "Quiz Translation");
    res.status(formattedError.status).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

export const translateQuestions = async (req, res) => {
  try {
    const { quizUuid } = req.params;
    const { targetLanguages, questions, priority = 'normal' } = req.body;

    // Validate quiz UUID
    if (!quizUuid) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Quiz UUID is required",
      });
    }

    const validation = validateLanguages(targetLanguages);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        ...validation,
      });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        message: "Please provide an array of questions to translate",
      });
    }

    // Add to translation queue
    const queueId = translationQueue.addToQueue('questions', {
      quizUuid,
      targetLanguages,
      questions
    }, priority);

    // Get queue status for response
    const queueStatus = translationQueue.getStatus(queueId);

    // Send response with queue information
    res.status(202).json({
      success: true,
      message: "Questions translation request has been queued",
      data: {
        queueId,
        status: "queued",
        queuePosition: queueStatus.queuePosition,
        totalInQueue: queueStatus.totalInQueue,
        estimatedStartTime: queueStatus.estimatedStartTime,
        quizUuid,
        targetLanguages,
        questionsCount: questions.length,
        checkStatusUrl: `/api/translation/status/${queueId}`
      },
    });

  } catch (error) {
    const formattedError = formatControllerError(
      error,
      "Questions Translation"
    );
    res.status(formattedError.status).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message,
    });
  }
};

export const extractQuestions = async (req, res) => {
  try {
    const { quizUuid } = req.params;
    const file = req.file;
    const sourceLanguage = req.body.sourceLanguage; // Optional: allow user to specify source language

    if (!file) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "No file uploaded"
      });
    }

    // Send immediate response
    res.status(202).json({
      success: true,
      message: "File received. Processing questions extraction in the background.",
      data: {
        quizUuid,
        sourceLanguage,
        status: "processing"
      }
    });

    // Process in background
    (async () => {
      try {
        // Get file extension
        const fileExt = path.extname(file.originalname).toLowerCase();

        // Process file based on type
        let fileContent;
        try {
          switch (fileExt) {
            case '.pdf':
              fileContent = await documentProcessor.processPDF(file.path);
              break;
            case '.docx':
            case '.doc':
              fileContent = await documentProcessor.processDOC(file.path);
              break;
            case '.epub':
              fileContent = await documentProcessor.processEPUB(file.path);
              break;
            case '.txt':
              // For text files, read content directly
              fileContent = await fs.readFile(file.path, 'utf8');
              break;
            default:
              console.error("Invalid file type received:", fileExt);
              return;
          }
        } finally {
          // Clean up uploaded file
          try {
            await fs.unlink(file.path);
          } catch (unlinkError) {
            console.error('Error deleting uploaded file:', unlinkError);
          }
        }

        if (!fileContent) {
          console.error("No content could be extracted from the document");
          return;
        }

        // Use the translation service to extract questions only (no translation)
        const extractedQuestions = await translationService.extractAndAddQuestions(fileContent, quizUuid);
        
        console.log("Questions extracted successfully:", {
          quizUuid,
          questionCount: extractedQuestions.questions.length, 
          status: extractedQuestions.status
        });

      } catch (error) {
        console.error("Background processing error:", error);
      }
    })();

  } catch (error) {
    console.error("Error in extractQuestions:", error);
    const formattedError = formatControllerError(error, "Question Extraction");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

export const translateExtractedQuestions = async (req, res) => {
  try {
    const { quizUuid } = req.params;
    const { questionUuids, targetLanguages, priority = 'normal' } = req.body;

    // Validate quiz UUID
    if (!quizUuid) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Quiz UUID is required"
      });
    }

    // Get target languages from request or fetch available languages
    let languagesToTranslate = targetLanguages;
    if (!languagesToTranslate || !Array.isArray(languagesToTranslate) || languagesToTranslate.length === 0) {
      // Fetch available languages
      const languages = await translationService.getLanguages();
      if (!languages || languages.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Configuration Error",
          message: "No target languages available for translation"
        });
      }
      languagesToTranslate = languages.map(lang => lang.code);
    }

    // Validate target languages if provided
    if (targetLanguages && Array.isArray(targetLanguages)) {
      const validation = validateLanguages(targetLanguages);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error,
          message: validation.message,
          validCodes: validation.validCodes
        });
      }
    }

    // Pre-fetch questions to validate and get count for queue
    const quizResponse = await quizFactorApiService.verifyQuiz(quizUuid);
    if (!quizResponse.data?.questions) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "No questions found in the quiz"
      });
    }

    let questionsToTranslate = quizResponse.data.questions;
    
    // Filter specific questions if questionUuids provided
    if (questionUuids && Array.isArray(questionUuids) && questionUuids.length > 0) {
      questionsToTranslate = questionsToTranslate.filter(q => questionUuids.includes(q.uuid));
    }

    if (questionsToTranslate.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "No questions found to translate with the specified criteria"
      });
    }

    // Add to translation queue
    const queueId = translationQueue.addToQueue('questions', {
      quizUuid,
      targetLanguages: languagesToTranslate,
      questions: questionsToTranslate
    }, priority);

    // Get queue status for response
    const queueStatus = translationQueue.getStatus(queueId);

    // Send response with queue information
    res.status(202).json({
      success: true,
      message: "Extracted questions translation request has been queued",
      data: {
        queueId,
        status: "queued",
        queuePosition: queueStatus.queuePosition,
        totalInQueue: queueStatus.totalInQueue,
        estimatedStartTime: queueStatus.estimatedStartTime,
        quizUuid,
        targetLanguages: languagesToTranslate,
        questionUuids: questionUuids || "all",
        questionsCount: questionsToTranslate.length,
        checkStatusUrl: `/api/translation/status/${queueId}`
      }
    });

  } catch (error) {
    console.error("Error in translateExtractedQuestions:", error);
    const formattedError = formatControllerError(error, "Question Translation");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

export const getQuizInfo = async (req, res) => {
  try {
    const { quizUuid } = req.params;

    // Validate quiz UUID
    if (!quizUuid) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Quiz UUID is required"
      });
    }

    const quizInfo = await translationService.getQuizInfo(quizUuid);

    res.status(200).json({
      success: true,
      message: "Quiz information retrieved successfully",
      data: quizInfo
    });

  } catch (error) {
    console.error("Error in getQuizInfo:", error);
    const formattedError = formatControllerError(error, "Get Quiz Info");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

// Check status of a specific translation request
export const getTranslationStatus = async (req, res) => {
  try {
    const { queueId } = req.params;

    if (!queueId) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Queue ID is required"
      });
    }

    const status = translationQueue.getStatus(queueId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Translation request not found. It may have been completed and removed from records."
      });
    }

    res.status(200).json({
      success: true,
      message: "Translation status retrieved successfully",
      data: status
    });

  } catch (error) {
    console.error("Error getting translation status:", error);
    const formattedError = formatControllerError(error, "Get Translation Status");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

// Get overall queue status
export const getQueueStatus = async (req, res) => {
  try {
    const queueStatus = translationQueue.getQueueStatus();

    res.status(200).json({
      success: true,
      message: "Queue status retrieved successfully",
      data: queueStatus
    });

  } catch (error) {
    console.error("Error getting queue status:", error);
    const formattedError = formatControllerError(error, "Get Queue Status");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};

// Cancel a queued translation request
export const cancelTranslation = async (req, res) => {
  try {
    const { queueId } = req.params;

    if (!queueId) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "Queue ID is required"
      });
    }

    // Check if item exists and is cancellable
    const status = translationQueue.getStatus(queueId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "Translation request not found"
      });
    }

    if (status.status === 'processing') {
      return res.status(400).json({
        success: false,
        error: "Cannot Cancel",
        message: "Translation is currently processing and cannot be cancelled"
      });
    }

    if (status.status === 'completed' || status.status === 'failed') {
      return res.status(400).json({
        success: false,
        error: "Cannot Cancel",
        message: `Translation is already ${status.status}`
      });
    }

    // Remove from queue
    const cancelled = translationQueue.cancelRequest(queueId);

    if (cancelled) {
      res.status(200).json({
        success: true,
        message: "Translation request cancelled successfully",
        data: { queueId, status: 'cancelled' }
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Cannot Cancel",
        message: "Unable to cancel the translation request"
      });
    }

  } catch (error) {
    console.error("Error cancelling translation:", error);
    const formattedError = formatControllerError(error, "Cancel Translation");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message
    });
  }
};
