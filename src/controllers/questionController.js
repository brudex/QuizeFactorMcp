import Question from '../models/Question.js';
import documentProcessor from '../services/documentProcessor.js';
import quizFactorApiService from '../services/quizFactorApiService.js';
import { TranslationService } from '../services/translationService.js';
import path from 'path';
import { config } from '../config/config.js';
import fs from 'fs';

const formatControllerError = (error, context) => {
  return {
    context,
    error: error.message,
    status: error.status || 500,
    timestamp: new Date().toISOString(),
    details: error.details || null
  };
};

const logControllerError = (error, context) => {
  const formattedError = formatControllerError(error, context);
  console.error('\n=== Controller Error ===');
  console.error(`Context: ${formattedError.context}`);
  console.error(`Error: ${formattedError.error}`);
  console.error(`Status: ${formattedError.status}`);
  if (formattedError.details) {
    console.error('Details:', formattedError.details);
  }
  console.error(`Timestamp: ${formattedError.timestamp}`);
  console.error('========================\n');
  return formattedError;
};

export const uploadDocument = async (req, res) => {
  try {
    console.log('\n🚀 Starting Document Upload Process');

    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded', 
        message: 'Please upload a file using the field name "document" or "file"',
        timestamp: new Date().toISOString()
      });
    }

    console.log('📄 File received:', req.file.originalname);

    const fileType = path.extname(req.file.originalname).toLowerCase();
    let questions = [];

    try {
      // Extract questions from document using LLM
      console.log('📝 Processing document...');
      switch (fileType) {
        case '.pdf':
          questions = await documentProcessor.processPDF(req.file.path);
          break;
        case '.doc':
        case '.docx':
          questions = await documentProcessor.processDOC(req.file.path);
          break;
        case '.epub':
          questions = await documentProcessor.processEPUB(req.file.path);
          break;
        case '.txt':
          const textContent = await fs.promises.readFile(req.file.path, 'utf8');
          const translationService = new TranslationService();
          questions = await translationService.extractQuestions(textContent);
          break;
        default:
          return res.status(400).json({ 
            error: 'Unsupported file type',
            supportedTypes: config.files.upload.allowedTypes,
            receivedType: fileType,
            timestamp: new Date().toISOString()
          });
      }

      if (!questions || questions.length === 0) {
        return res.status(422).json({
          error: 'No questions extracted',
          message: 'The document was processed but no questions were found',
          timestamp: new Date().toISOString()
        });
      }

      console.log(`✅ Successfully extracted ${questions.length} questions`);

      // Save questions to database
      //console.log('💾 Saving questions to database...');
      // const savedQuestions = await Promise.all(
      //   questions.map(async (question) => {
      //     const newQuestion = new Question({
      //       ...question,
      //       sourceDocument: {
      //         name: req.file.originalname,
      //         type: fileType.substring(1),
      //         path: req.file.path
      //       }
      //     });
      //     return await newQuestion.save();
      //   })
      // );
      console.log('✅ Questions saved successfully');

      // Create course and quiz with extracted questions in QuizFactor
      try {
        const fileName = path.basename(req.file.originalname, path.extname(req.file.originalname));
        const metadata = {
          // Course metadata
          courseTitle: `Course: ${fileName}`,
          courseDescription: `Course generated from ${req.file.originalname}`,
          level: req.body.level || 'beginner',
          duration: parseInt(req.body.duration) || 60,
          
          // Quiz metadata
          title: `Quiz: ${fileName}`,
          description: `Questions extracted from ${req.file.originalname}`,
          difficulty: req.body.difficulty || 'medium',
          timeLimit: parseInt(req.body.timeLimit) || 30,
          passingScore: parseInt(req.body.passingScore) || 70,

          // Optional topic metadata
          topicTitle: req.body.topicTitle,
          topicDescription: req.body.topicDescription
        };

        // Verify QuizFactor API key is configured
        if (!config.api.quizFactor.apiKey) {
          throw new Error('QuizFactor API key is not configured. Please check your environment variables.');
        }

        console.log('🔄 Creating quiz in QuizFactor...');
        const quizFactorResponse = await quizFactorApiService.createQuizWithQuestions(
          questions,
          metadata
        );

        if (!quizFactorResponse || !quizFactorResponse.quiz || !quizFactorResponse.quiz.uuid) {
          throw new Error('Invalid response from QuizFactor API');
        }

        // Update questions with all UUIDs
        console.log('📝 Updating questions with QuizFactor UUIDs...');
        // await Question.updateMany(
        //   { _id: { $in: questions.map(q => q._id) } },
        //   { 
        //     $set: { 
        //       categoryUuid: quizFactorResponse.category.uuid,
        //       courseUuid: quizFactorResponse.course.uuid,
        //       quizUuid: quizFactorResponse.quiz.uuid,
        //       topicUuid: quizFactorResponse.course.topicUuid || null
        //     } 
        //   }
        // );

        console.log('✅ Process completed successfully');
        // res.status(200).json({
        //   success: true,
        //   message: 'Document processed and quiz created successfully',
        //   timestamp: new Date().toISOString(),
        //   data: {
        //     questionsExtracted: questions.length,
        //     questions: questions,
        //     category: quizFactorResponse.category,
        //     course: quizFactorResponse.course,
        //     quiz: quizFactorResponse.quiz
        //   }
        // });

      } catch (apiError) {
        const formattedError = formatControllerError(apiError, 'QuizFactor Integration');
        
        // Handle specific API errors
        if (apiError.message.includes('Authentication failed') || apiError.message.includes('API key')) {
          return res.status(401).json({
            success: false,
            error: 'QuizFactor API authentication failed',
            message: 'Please check your API credentials',
            timestamp: new Date().toISOString()
          });
        }
        
        // Still return success for the question extraction
        res.status(200).json({
          success: true,
          message: 'Document processed but failed to create quiz',
          timestamp: new Date().toISOString(),
          warning: {
            message: formattedError.error,
            details: formattedError.details
          },
          data: {
            questionsExtracted: questions.length,
            questions: questions
          }
        });
      }
      
    } catch (processingError) {
      // Handle credit balance error
      if (processingError.message.includes('credit balance is too low')) {
        return res.status(402).json({
          success: false,
          error: 'Payment Required',
          message: processingError.message,
          code: 'INSUFFICIENT_CREDITS',
          timestamp: new Date().toISOString()
        });
      }

      const formattedError = logControllerError(processingError, 'Document Processing');
      return res.status(422).json({ 
        success: false,
        error: 'Error processing document',
        message: formattedError.error,
        details: formattedError.details,
        timestamp: formattedError.timestamp
      });
    }
  } catch (error) {
    const formattedError = logControllerError(error, 'Document Upload');
    res.status(500).json({ 
      success: false,
      error: 'Upload failed',
      message: formattedError.error,
      details: formattedError.details,
      timestamp: formattedError.timestamp
    });
  }
};

// export const assignQuestionsToQuiz = async (req, res) => {
//   try {
//     const { quizUuid } = req.params;
//     const { questionIds } = req.body;

//     if (!questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
//       return res.status(400).json({
//         error: 'Invalid request',
//         message: 'Please provide an array of question IDs to assign to the quiz'
//       });
//     }

//     // Fetch questions from database
//     const questions = await Question.find({ _id: { $in: questionIds } });

//     if (questions.length === 0) {
//       return res.status(404).json({
//         error: 'Questions not found',
//         message: 'None of the provided question IDs were found in the database'
//       });
//     }

//     if (questions.length !== questionIds.length) {
//       console.warn(`Only ${questions.length} out of ${questionIds.length} questions were found`);
//     }

//     try {
//       // Verify quiz exists
//       await quizFactorApiService.verifyQuiz(quizUuid);
      
//       // Add questions to quiz
//       const quizFactorResponse = await quizFactorApiService.addQuizQuestions(quizUuid, questions);
      
//       // Update questions with quiz assignment
//       await Question.updateMany(
//         { _id: { $in: questionIds } },
//         { $set: { quizUuid: quizUuid } }
//       );

//       res.status(200).json({
//         message: 'Questions successfully assigned to quiz',
//         assignedQuestions: questions.length,
//         quizUuid,
//         quizFactorResponse
//       });
//     } catch (apiError) {
//       console.error('Error assigning questions to quiz:', apiError);
      
//       const statusCode = 
//         apiError.message.includes('not found') ? 404 :
//         apiError.message.includes('Bad request') ? 400 : 500;
      
//       res.status(statusCode).json({
//         error: 'QuizFactor API Error',
//         message: apiError.message
//       });
//     }
//   } catch (error) {
//     console.error('Assignment error:', error);
//     res.status(500).json({ error: error.message });
//   }
// };

// export const getQuestions = async (req, res) => {
//   try {
//     const { page = 1, limit = 10, tags, difficulty } = req.query;
//     const query = {};

//     if (tags) {
//       query.tags = { $in: tags.split(',') };
//     }

//     if (difficulty) {
//       query['metadata.difficulty'] = difficulty;
//     }

//     const questions = await Question.find(query)
//       .limit(limit * 1)
//       .skip((page - 1) * limit)
//       .exec();

//     const count = await Question.countDocuments(query);

//     res.status(200).json({
//       questions,
//       totalPages: Math.ceil(count / limit),
//       currentPage: page,
//       totalQuestions: count
//     });
//   } catch (error) {
//     console.error('Error fetching questions:', error);
//     res.status(500).json({ error: error.message });
//   }
// };

// export const updateQuestion = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const updates = req.body;

//     const question = await Question.findByIdAndUpdate(
//       id,
//       { ...updates, updatedAt: Date.now() },
//       { new: true }
//     );

//     if (!question) {
//       return res.status(404).json({ error: 'Question not found' });
//     }

//     // If quizUuid is provided, update the question in QuizeFactor API
//     if (req.body.quizUuid && req.body.quizQuestionUuid) {
//       try {
//         const quizFactorResponse = await quizFactorApiService.addQuizQuestions(
//           req.body.quizUuid,
//           [question]
//         );
        
//         res.status(200).json({
//           question,
//           quizFactorResponse
//         });
//       } catch (apiError) {
//         console.error('Error updating question in QuizeFactor API:', apiError);
        
//         res.status(200).json({
//           question,
//           apiError: apiError.message
//         });
//       }
//     } else {
//       res.status(200).json(question);
//     }
//   } catch (error) {
//     console.error('Error updating question:', error);
//     res.status(500).json({ error: error.message });
//   }
// };

// export const deleteQuestion = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const question = await Question.findByIdAndDelete(id);

//     if (!question) {
//       return res.status(404).json({ error: 'Question not found' });
//     }

//     res.status(200).json({ message: 'Question deleted successfully' });
//   } catch (error) {
//     console.error('Error deleting question:', error);
//     res.status(500).json({ error: error.message });
//   }
// }; 