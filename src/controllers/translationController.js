import { v4 as uuidv4 } from 'uuid';
import translationService from '../services/translationService.js';
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

    // Send immediate response
    res.status(202).json({
      success: true,
      message: "Translation processing started in the background",
      data: {
        status: "processing",
        categoryUuid,
        targetLanguages,
      },
    });

    // Process translations in background
    (async () => {
      try {
        const result = await translationService.translateCategory(
          categoryUuid,
          targetLanguages
        );

        console.log("Category translated successfully:", {
          categoryUuid,
          targetLanguages,
          translationsCreated: result ? Object.keys(result).length : 0
        });
      } catch (error) {
        console.error("Background category translation error:", error);
      }
    })();

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

    // Send immediate response
    res.status(202).json({
      success: true,
      message: "Translation processing started in the background",
      data: {
        status: "processing",
        courseUuid,
        targetLanguages,
      },
    });

    // Process translations in background
    (async () => {
      try {
        const result = await translationService.translateCourse(courseUuid, targetLanguages);

        console.log("Course translated successfully:", {
          courseUuid,
          targetLanguages,
          translationsCreated: result ? Object.keys(result).length : 0
        });

      } catch (error) {
        console.error("Background course translation error:", error);
      }
    })();

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

    // Send immediate response
    res.status(202).json({
      success: true,
      message: "Translation processing started in the background",
      data: {
        quizUuid,
        targetLanguages,
        status: "processing"
      },
    });

    // Process translations in background
    (async () => {
      try {
        const result = await translationService.translateQuiz(quizUuid, targetLanguages);

        console.log("Quiz translated successfully:", {
          quizUuid,
          targetLanguages,
          translationsCreated: result ? Object.keys(result).length : 0
        });

      } catch (error) {
        console.error("Background quiz translation error:", error);
      }
    })();

  } catch (error) {
    console.error("Quiz translation error:", error);
    const formattedError = formatControllerError(error, "Quiz Translation");
    res.status(formattedError.status || 500).json({
      success: false,
      error: formattedError.error,
      message: formattedError.message,
    });
  }
};

export const translateQuestions = async (req, res) => {
  try {
    const { quizUuid } = req.params;
    const { targetLanguages, questions } = req.body;

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

    // Send immediate response
    res.status(202).json({
      success: true,
      message: "Translation processing started in the background",
      data: {
        quizUuid,
        targetLanguages,
        questionsCount: questions.length,
        status: "processing"
      },
    });

    // Process translations in background
    (async () => {
      try {
        const result = await translationService.translateQuestions(
          quizUuid,
          targetLanguages,
          questions
        );

        console.log("Questions translated successfully:", {
          quizUuid,
          targetLanguages,
          questionsTranslated: questions.length,
          translationsCreated: result.length
        });

      } catch (error) {
        console.error("Background translation error:", error);
      }
    })();

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
              // For text files, read content and use LLM extraction
              const textContent = await fs.readFile(file.path, 'utf8');
              fileContent = await translationService.extractQuestionsWithLLM(textContent);
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

        // Use the translation service to extract questions using LLM
        const extractedQuestions = await translationService.extractAndAddQuestions(fileContent, quizUuid);
        
        console.log("Questions extracted successfully:", {
          quizUuid,
          questionCount: extractedQuestions.length
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
    const { questionUuids } = req.body; // Optional: specific questions to translate

    // Fetch available languages
    const languages = await translationService.getLanguages();
    if (!languages || languages.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Configuration Error",
        message: "No target languages available for translation"
      });
    }

    // Extract language codes
    const targetLanguages = languages.map(lang => lang.code);

    // Fetch questions from the quiz
    const quizResponse = await quizFactorApiService.verifyQuiz(quizUuid);
    if (!quizResponse.data?.questions) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: "No questions found in the quiz"
      });
    }

    let questionsToTranslate = quizResponse.data.questions;
    if (questionUuids && questionUuids.length > 0) {
      questionsToTranslate = questionsToTranslate.filter(q => questionUuids.includes(q.uuid));
    }

    // Translate questions
    const translatedQuestions = await translationService.translateQuizQuestions(
      quizUuid,
      targetLanguages,
      questionsToTranslate
    );

    res.status(200).json({
      success: true,
      message: "Questions translated successfully",
      data: {
        quizUuid,
        questionsCount: questionsToTranslate.length,
        targetLanguages,
        result: translatedQuestions
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

// export const translateQuestion = async (req, res) => {
//   try {
//     const { questionUuid } = req.params;
//     const { targetLanguages } = req.body;

//     if (
//       !targetLanguages ||
//       !Array.isArray(targetLanguages) ||
//       targetLanguages.length === 0
//     ) {
//       return res.status(400).json({
//         success: false,
//         error: "Invalid request",
//         message: "Please provide an array of target languages",
//       });
//     }

//     const translations = await translationService.translateQuestion(
//       questionUuid,
//       targetLanguages
//     );

//     res.status(200).json({
//       success: true,
//       message: "Question translated successfully",
//       data: { translations },
//     });
//   } catch (error) {
//     const formattedError = formatControllerError(error, "Question Translation");
//     res.status(formattedError.status).json({
//       success: false,
//       error: formattedError.error,
//       message: formattedError.message,
//     });
//   }
// };
