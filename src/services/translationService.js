import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { QuizFactorApiService } from "./quizFactorApiService.js";
import { config } from "../config/config.js";
import llmService from './llmService.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class TranslationService {
  constructor(quizUuid) {
    this.quizUuid = quizUuid;
    this.quizFactorApiService = new QuizFactorApiService();
    
    this.client = axios.create({
      baseURL: config.api.quizFactor.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "X-API-Version": "1.0",
      },
      timeout: 120000, // Increased to 2 minutes for large payloads
    });

    // Rate limiting state
    this.rateLimitState = {
      isRateLimited: false,
      rateLimitCount: 0,
      lastRateLimitTime: null,
      backoffMultiplier: 1,
      maxBackoffMultiplier: 8
    };
  }

  async translateWithLLM(text, targetLanguage, context = "", maxRetries = 3) {
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        // Check if we're in a rate limited state and wait if needed
        await this.handleRateLimitBackoff();

        const prompt = `Translate the following text to ${targetLanguage}. Return ONLY the translation, without any prefixes or explanations:

Context: ${context}
Text to translate: "${text}"`;

        const translatedText = await llmService.processPrompt(prompt, {
          maxTokens: 1024,
          temperature: 0
        });

        // Reset rate limit state on successful call
        this.resetRateLimitState();

        // Clean up the response by removing common prefixes and trimming
        let cleanedText = translatedText.trim();
        const prefixesToRemove = [
          `Here's the ${targetLanguage} translation:`,
          `The ${targetLanguage} translation is:`,
          `${targetLanguage} translation:`,
          `Translation:`,
          `Translated text:`,
        ];

        // Remove any known prefixes
        for (const prefix of prefixesToRemove) {
          if (cleanedText.toLowerCase().startsWith(prefix.toLowerCase())) {
            cleanedText = cleanedText.slice(prefix.length).trim();
          }
        }

        // Remove any quotes if they wrap the entire text
        if (cleanedText.startsWith('"') && cleanedText.endsWith('"')) {
          cleanedText = cleanedText.slice(1, -1).trim();
        }

        return cleanedText;
      } catch (error) {
        console.error("Translation error:", error);

        if (this.isRateLimitError(error)) {
          retries++;
          await this.handleRateLimitError(retries, maxRetries);
          continue;
        }
        throw new Error(`Failed to translate with LLM: ${error.message}`);
      }
    }
    throw new Error(`Failed to translate after ${maxRetries} retries due to rate limiting`);
  }

  isRateLimitError(error) {
    return error.message.includes('Rate limit') || 
           error.message.includes('429') ||
           error.message.includes('rate limit') ||
           error.status === 429;
  }

  async handleRateLimitError(retries, maxRetries) {
    this.rateLimitState.isRateLimited = true;
    this.rateLimitState.rateLimitCount++;
    this.rateLimitState.lastRateLimitTime = Date.now();
    
    // Increase backoff multiplier for subsequent calls
    this.rateLimitState.backoffMultiplier = Math.min(
      this.rateLimitState.backoffMultiplier * 1.5, 
      this.rateLimitState.maxBackoffMultiplier
    );

    // Exponential backoff with jitter
    const baseDelay = 5000; // Start with 5 seconds
    const jitter = Math.random() * 2000;
    const delay = (baseDelay * Math.pow(2, retries) * this.rateLimitState.backoffMultiplier) + jitter;
    
    console.log(`         ⚠️  API busy (${this.rateLimitState.rateLimitCount} rate limits so far), taking a ${(delay/1000).toFixed(1)}s break before try ${retries} of ${maxRetries}...`);
    await sleep(delay);
  }

  async handleRateLimitBackoff() {
    if (this.rateLimitState.isRateLimited) {
      const timeSinceLastRateLimit = Date.now() - this.rateLimitState.lastRateLimitTime;
      const backoffTime = 10000 * this.rateLimitState.backoffMultiplier; // 10s base backoff
      
      if (timeSinceLastRateLimit < backoffTime) {
        const remainingWait = backoffTime - timeSinceLastRateLimit;
        const remainingMinutes = Math.floor(remainingWait / 60000);
        const remainingSeconds = Math.floor((remainingWait % 60000) / 1000);
        
        if (remainingMinutes > 0) {
          console.log(`         ⏳ Still cooling down from rate limits, ${remainingMinutes}m ${remainingSeconds}s more to wait...`);
        } else {
          console.log(`         ⏳ Still cooling down from rate limits, ${remainingSeconds}s more to wait...`);
        }
        await sleep(remainingWait);
      }
    }
  }

  resetRateLimitState() {
    // Gradually reduce backoff multiplier on successful calls
    if (this.rateLimitState.backoffMultiplier > 1) {
      this.rateLimitState.backoffMultiplier = Math.max(1, this.rateLimitState.backoffMultiplier * 0.8);
    }
    
    // Reset rate limited state after successful calls
    if (this.rateLimitState.isRateLimited) {
      const timeSinceLastRateLimit = Date.now() - this.rateLimitState.lastRateLimitTime;
      if (timeSinceLastRateLimit > 30000) { // 30 seconds
        this.rateLimitState.isRateLimited = false;
        console.log("         ✅ Back to normal speed - rate limits cleared!");
      }
    }
  }

  async translateCategory(categoryUuid, targetLanguages) {
    try {
      // Fetch category data
      const response = await this.client.get(
        `/api/ai/course-category/${categoryUuid}`
      );

      if (!response.data?.data?.name || !response.data?.data?.description) {
        throw new Error("Invalid category data: missing required fields");
      }

      const category = response.data.data;

      // Translate category content for each language using LLM
      const translations = await Promise.all(
        targetLanguages.map(async (lang) => ({
          languageCode: lang,
          name: await this.translateWithLLM(
            category.name,
            lang,
            "This is a course category name"
          ),
          description: await this.translateWithLLM(
            category.description,
            lang,
            "This is a course category description"
          ),
        }))
      );

      // Update category with translations
      const updateResponse = await this.client.post(
        "/api/ai/update-course-category",
        {
          uuid: category.uuid,
          name: category.name,
          description: category.description,
          type: category.type,
          tagName: category.tagName,
          order: category.order,
          translations,
        }
      );

      if (!updateResponse.data || updateResponse.data.status !== "00") {
        throw new Error(
          updateResponse.data?.message ||
            "Failed to update category translations"
        );
      }

      return translations;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Category not found: ${categoryUuid}`);
      }
      throw new Error(`Failed to translate category: ${error.message}`);
    }
  }

  async translateCourse(courseUuid, targetLanguages) {
    try {
      // Fetch course data
      const response = await this.client.get(`/api/ai/course/${courseUuid}`);
      const course = response.data?.data;  // Fix: Access the data property

      if (!course) {
        throw new Error("Course not found");
      }

      console.log("Course data:", course);

      // Get source text (English) from course data
      const sourceTitle = course.title;
      const sourceDesc = course.description;

      if (!sourceTitle || !sourceDesc) {
        throw new Error("Course title and description are required");
      }

      // Prepare the update payload with existing course data
      const updatePayload = {
        uuid: courseUuid,
        level: course.level || "beginner",
        duration: course.duration || 60,
        imageUrl: course.imageUrl || "https://example.com/course-image.jpg",
        translations: []
      };

      // Get existing translations map for preserving UUIDs
      const existingTranslations = new Map(
        (course.translations || []).map(t => [t.languageCode, t])
      );

      // Add translations for all target languages
      const newTranslations = await Promise.all(
        targetLanguages.map(async (lang) => {
          const existingTrans = existingTranslations.get(lang);

          // For English or existing translations, preserve the UUID and use existing content
          if (existingTrans) {
            return {
              uuid: existingTrans.uuid,
              courseUuid: courseUuid,
              languageCode: lang,
              title: existingTrans.title,
              description: existingTrans.description
            };
          }

          // For other languages, translate using LLM
          const translatedTitle = await this.translateWithLLM(
            sourceTitle,
            lang,
            "This is a course title"
          );
          const translatedDesc = await this.translateWithLLM(
            sourceDesc,
            lang,
            "This is a course description"
          );

          return {
            courseUuid: courseUuid,
            languageCode: lang,
            title: translatedTitle || sourceTitle, // Fallback to source if translation fails
            description: translatedDesc || sourceDesc // Fallback to source if translation fails
          };
        })
      );

      // Set translations in payload
      updatePayload.translations = newTranslations;

      // Sort translations by language code for consistency
      updatePayload.translations.sort((a, b) =>
        a.languageCode.localeCompare(b.languageCode)
      );

      console.log("Updating course with payload:", updatePayload);

      const updateResponse = await this.client.post(
        "/api/ai/update-course",
        updatePayload
      );

      console.log("Update course response:", updateResponse);

      if (updateResponse.data?.status !== '00') {
        const errorMessage = updateResponse.data?.message || 
          updateResponse.data?.error || 
          "Unknown error";
        console.error("Update course response:", updateResponse.data);
        throw new Error(`Failed to update course: ${errorMessage}`);
      }

      return {
        courseUuid,
        level: updatePayload.level,
        duration: updatePayload.duration,
        imageUrl: updatePayload.imageUrl,
        translations: updatePayload.translations,
        updatedLanguages: targetLanguages,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Course translation error:", error);
      throw new Error(`Failed to translate course: ${error.message}`);
    }
  }

  async translateQuiz(quizUuid, targetLanguages) {
    try {
      // Fetch quiz data
      const quizResponse = await this.client.get(`/api/ai/quiz/${quizUuid}`);
      
      if (quizResponse.data?.status !== '00') {
        throw new Error(`Failed to fetch quiz: ${quizResponse.data?.message || 'Unknown error'}`);
      }

      const quiz = quizResponse.data.data;

      // Get existing translations map for preserving data
      const existingTranslations = new Map(
        (quiz.translations || []).map(t => [t.languageCode, t])
      );

      // Prepare translations array
      const translations = await Promise.all(
        targetLanguages.map(async (lang) => {
          // If translation exists, preserve it
          const existingTrans = existingTranslations.get(lang);
          if (existingTrans) {
            return {
              languageCode: lang,
              title: existingTrans.title,
              description: existingTrans.description
            };
          }

          // Otherwise translate using LLM
          return {
            languageCode: lang,
            title: await this.translateWithLLM(
              quiz.title,
              lang,
              "This is a quiz title"
            ),
            description: await this.translateWithLLM(
              quiz.description,
              lang,
              "This is a quiz description"
            ),
          };
        })
      );

      // Prepare update payload
      const updatePayload = {
        uuid: quiz.uuid,
        title: quiz.title,
        description: quiz.description,
        courseUuid: quiz.courseUuid,
        difficulty: quiz.difficulty,
        timeLimit: quiz.timeLimit,
        passingScore: quiz.passingScore,
        isActive: quiz.isActive,
        translations
      };

      // Update quiz with translations
      const updateResponse = await this.client.post("/api/ai/update-quiz", updatePayload);

      if (updateResponse.data?.status !== '00') {
        throw new Error(`Failed to update quiz: ${updateResponse.data?.message || 'Unknown error'}`);
      }

      console.log("Update quiz response:", JSON.stringify(updateResponse.data, null, 2));


      return {
        quizUuid,
        translations,
        updatedLanguages: targetLanguages,
        timestamp: new Date().toISOString(),
        response: updateResponse.data
      };
    } catch (error) {
      console.error("Quiz translation error:", error);
      throw new Error(`Failed to translate quiz: ${error.message}`);
    }
  }

  async translateQuizQuestions(quizUuid, targetLanguages, questions) {
    try {
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        throw new Error('No questions provided for translation');
      }

      // Process each question
      const translatedQuestions = await Promise.all(
        questions.map(async (question) => {
          // Get existing translations map for preserving data
          const existingTranslations = new Map(
            (question.translations || []).map(t => [t.languageCode, t])
          );

          // Find source translation (prefer English)
          const sourceTranslation = existingTranslations.get('en') || 
            Array.from(existingTranslations.values())[0];

          if (!sourceTranslation) {
            throw new Error('No source translation found for question');
          }

          // Prepare translations array
          const translations = await Promise.all(
            targetLanguages.map(async (lang) => {
              // If translation exists, preserve it
              const existingTrans = existingTranslations.get(lang);
              if (existingTrans) {
                              return {
                languageCode: lang,
                questionText: existingTrans.questionText,
                options: existingTrans.options,
                correctAnswer: Array.isArray(existingTrans.correctAnswer) 
                  ? existingTrans.correctAnswer 
                  : [existingTrans.correctAnswer], // Ensure correctAnswer is always an array
                explanation: existingTrans.explanation
              };
              }

              // Translate question text
              const questionText = await this.translateWithLLM(
                sourceTranslation.questionText,
                lang,
                "This is a quiz question"
              );

              // Translate options
              const options = {};
              for (const [key, value] of Object.entries(sourceTranslation.options)) {
                options[key] = await this.translateWithLLM(
                  value,
                  lang,
                  "This is a quiz answer option"
                );
              }

              // Translate explanation
              const explanation = await this.translateWithLLM(
                sourceTranslation.explanation,
                lang,
                "This is an explanation for the correct answer"
              );

              return {
                languageCode: lang,
                questionText,
                options,
                correctAnswer: Array.isArray(sourceTranslation.correctAnswer) 
                  ? sourceTranslation.correctAnswer 
                  : [sourceTranslation.correctAnswer], // Ensure correctAnswer is always an array
                explanation
              };
            })
          );

          // Return question with new translations
          return {
            uuid: question.uuid || uuidv4(), // Generate UUID if not provided
            questionType: question.questionType || 'single-choice',
            difficulty: question.difficulty || 'medium',
            points: question.points || 1,
            translations
          };
        })
      );

      // Update questions with translations
      const payload = {
        quizUuid,
        questions: translatedQuestions
      };

      // Log the payload for debugging
      console.log('\n=== API Request Summary ===');
      console.log('Quiz UUID:', quizUuid);
      console.log('Number of questions:', translatedQuestions.length);
      console.log('First question sample:');
      if (translatedQuestions[0]) {
        console.log('- UUID:', translatedQuestions[0].uuid);
        console.log('- Type:', translatedQuestions[0].questionType);
        console.log('- First translation:');
        if (translatedQuestions[0].translations[0]) {
          const trans = translatedQuestions[0].translations[0];
          console.log('  - Language:', trans.languageCode);
          console.log('  - Question:', trans.questionText);
          console.log('  - Options:', JSON.stringify(trans.options, null, 2));
          console.log('  - Correct Answer:', trans.correctAnswer);
        }
      }
      console.log('=== End API Request Summary ===\n');

      // Chunk questions into smaller batches to avoid "request entity too large" error
      const batchSize = 25; // Reduced from 100 to 25 due to server limitations
      const questionBatches = [];
      
      for (let i = 0; i < translatedQuestions.length; i += batchSize) {
        questionBatches.push(translatedQuestions.slice(i, i + batchSize));
      }

      console.log(`📦 Chunking ${translatedQuestions.length} questions into ${questionBatches.length} batches of ${batchSize}`);

      // Send each batch to the API
      const batchResponses = [];
      for (let i = 0; i < questionBatches.length; i++) {
        const batch = questionBatches[i];
        const batchPayload = {
          quizUuid,
          questions: batch
        };

        // Log payload size for debugging
        const payloadSize = JSON.stringify(batchPayload).length;
        console.log(`📤 Sending batch ${i + 1}/${questionBatches.length} with ${batch.length} questions (payload size: ${(payloadSize / 1024).toFixed(1)}KB)...`);
        
        try {
          const updateResponse = await this.client.post("/api/ai/add-quiz-questions", batchPayload);

          if (updateResponse.data?.status !== '00') {
            throw new Error(`Failed to update quiz questions batch ${i + 1}: ${updateResponse.data?.message || 'Unknown error'}`); 
          }

          batchResponses.push(updateResponse.data);
          console.log(`✅ Batch ${i + 1}/${questionBatches.length} completed successfully`);

          // Add a small delay between batches to avoid overwhelming the server
          if (i < questionBatches.length - 1) {
            console.log(`⏳ Brief pause before next batch...`);
            await this.sleep(2000); // 2 second delay
          }
        } catch (error) {
          console.error(`❌ Failed to send batch ${i + 1}/${questionBatches.length}:`, error.message);
          
          // If it's a 500 error and we have more than 5 questions, try splitting into smaller batches
          if (error.response?.status === 500 && batch.length > 5) {
            console.log(`⚠️  Server error with ${batch.length} questions. Trying smaller batches of 5...`);
            
            try {
              const smallBatches = [];
              for (let j = 0; j < batch.length; j += 5) {
                smallBatches.push(batch.slice(j, j + 5));
              }
              
              for (let k = 0; k < smallBatches.length; k++) {
                const smallBatch = smallBatches[k];
                const smallPayload = {
                  quizUuid,
                  questions: smallBatch
                };
                
                const smallPayloadSize = JSON.stringify(smallPayload).length;
                console.log(`📤 Trying mini-batch ${k + 1}/${smallBatches.length} with ${smallBatch.length} questions (${(smallPayloadSize / 1024).toFixed(1)}KB)...`);
                
                const smallResponse = await this.client.post("/api/ai/add-quiz-questions", smallPayload);
                
                if (smallResponse.data?.status !== '00') {
                  throw new Error(`Failed to add mini-batch ${k + 1}: ${smallResponse.data?.message || 'Unknown error'}`);
                }
                
                console.log(`✅ Mini-batch ${k + 1}/${smallBatches.length} succeeded`);
                
                // Brief pause between mini-batches
                if (k < smallBatches.length - 1) {
                  await this.sleep(1000);
                }
              }
              
              // Use the last small response for the main response
              batchResponses.push(smallBatches[smallBatches.length - 1]);
              console.log(`🎉 Successfully processed ${batch.length} questions using smaller batches`);
              
            } catch (smallBatchError) {
              console.error(`❌ Even smaller batches failed:`, smallBatchError.message);
              throw new Error(`Failed to update quiz questions batch ${i + 1}: ${smallBatchError.message}`);
            }
          } else {
            throw new Error(`Failed to update quiz questions batch ${i + 1}: ${error.message}`);
          }
        }
      }

      console.log(`🎉 All ${questionBatches.length} batches sent successfully!`);

      // Combine all batch responses (use the last response as the main response)
      const finalResponse = batchResponses[batchResponses.length - 1];

      return {
        quizUuid,
        questions: translatedQuestions,
        updatedLanguages: targetLanguages,
        timestamp: new Date().toISOString(),
        response: finalResponse,
        batchInfo: {
          totalBatches: questionBatches.length,
          batchSize: batchSize,
          totalQuestions: translatedQuestions.length
        }
      };
    } catch (error) {
      console.error("Quiz questions translation error:", error);
      throw new Error(`Failed to translate quiz questions: ${error.message}`);
    }
  }

  async createQuiz(title, description) {
    try {
      const response = await this.client.post("/api/ai/add-quiz-questions", {
        title,
        description,
      });

      if (!response.data.success) {
        throw new Error(`Failed to create quiz: ${response.data.message}`);
      }

      return response.data.quizUuid;
    } catch (error) {
      console.error("Quiz creation error:", error);
      // For testing purposes, return a mock quiz ID if the API fails
      return "test-quiz-123";
    }
  }

  normalizeOptionKey(key) {
    // Convert A, B, C, D, E to first, second, third, fourth, fifth
    const letterToOrdinal = {
      A: "first",
      B: "second",
      C: "third",
      D: "fourth",
      E: "fifth",
    };

    const ordinalToOrdinal = {
      1: "first",
      2: "second",
      3: "third",
      4: "fourth",
      5: "fifth",
      first: "first",
      second: "second",
      third: "third",
      fourth: "fourth",
      fifth: "fifth",
    };

    key = key.trim().toUpperCase();

    // Try letter format (A, B, C, D, E)
    if (letterToOrdinal[key]) {
      return letterToOrdinal[key];
    }

    // Try number format (1, 2, 3, 4, 5)
    if (ordinalToOrdinal[key]) {
      return ordinalToOrdinal[key];
    }

    // Try ordinal format (already in first, second, etc.)
    const lowerKey = key.toLowerCase();
    if (ordinalToOrdinal[lowerKey]) {
      return ordinalToOrdinal[lowerKey];
    }

    // If no match found, return the original key in lowercase
    return key.toLowerCase();
  }

  standardizeQuestionOptions(question) {
    // Create default translation if translations array is missing
    if (!question.translations || !Array.isArray(question.translations)) {
      console.log("Creating default translation for question without translations");
      
      // Create a default English translation from the question's direct properties
      const defaultTranslation = {
        languageCode: "en",
        questionText: question.questionText || question.text || "Question text not available",
        options: question.options || {},
        correctAnswer: Array.isArray(question.correctAnswer) 
          ? question.correctAnswer 
          : [question.correctAnswer || "option_1"], // Ensure correctAnswer is always an array
        explanation: question.explanation || "No explanation provided"
      };
      
      question.translations = [defaultTranslation];
    }

    // Normalize each translation's options
    question.translations = question.translations.map(translation => {
      if (!translation.options) return translation;

      // Convert options to standard format
      const normalizedOptions = {};
      Object.entries(translation.options).forEach(([key, value]) => {
        // Keep numbers and % signs as is
        let normalizedValue = String(value)
          .replace(/[「」『』]/g, '') // Remove Japanese quotes
          .replace(/[""]/g, '') // Remove English quotes
          .replace(/['']/g, '') // Remove single quotes
          .replace(/[（）]/g, '()') // Normalize parentheses
          .replace(/，/g, ',') // Normalize commas
          .replace(/[．。]/g, '.') // Normalize periods
          .trim();

        // If the value is a number or ends with units (cm, %, etc.), keep it as is
        if (
          /^-?\d+(\.\d+)?(%|cm|m)?$/.test(normalizedValue) || // Numbers with optional units
          /^[A-Za-z0-9]+$/.test(normalizedValue) // Alphanumeric values
        ) {
          normalizedOptions[key] = normalizedValue;
        } else {
          // For non-numeric values, keep the original
          normalizedOptions[key] = value;
        }
      });

      return {
        ...translation,
        options: normalizedOptions
      };
    });

    return question;
  }

  async translateQuestions(quizUuid, targetLanguages, questionsData = []) {
    const startTime = Date.now();
    const totalOperations = questionsData.length * targetLanguages.length;
    
    try {
      // Validate input data
      if (!quizUuid || !Array.isArray(questionsData) || questionsData.length === 0) {
        throw new Error("Invalid input: quizUuid and questions array are required");
      }

      console.log('\n🚀 ===== STARTING TRANSLATION =====');
      console.log(`📚 We need to translate ${questionsData.length} questions`);
      console.log(`🌍 Into ${targetLanguages.length} languages: ${targetLanguages.join(', ')}`);
      console.log(`⚡ That's ${totalOperations} translation tasks in total`);
      console.log(`🕒 Starting now at ${new Date().toLocaleTimeString()}`);
      console.log('🎯 Let\'s get started!\n');
      
      // Process questions in parallel with controlled concurrency
      const translatedQuestions = await this.processQuestionsInBatches(questionsData, targetLanguages, startTime, totalOperations);

      // Write translated questions to file before sending to server
      await this.writeQuestionsToFile(translatedQuestions, quizUuid, 'translated');

      // Prepare API payload
      const payload = {
        quizUuid,
        questions: translatedQuestions
      };

      console.log('\n=== API Request Summary ===');
      console.log('Quiz UUID:', quizUuid);
      console.log('Number of questions:', translatedQuestions.length);
      console.log('Target languages:', targetLanguages.join(', '));
      console.log('=== End API Request Summary ===\n');

      // Chunk questions into smaller batches to avoid "request entity too large" error
      const batchSize = 25; // Reduced from 100 to 25 due to server limitations
      const questionBatches = [];
      
      for (let i = 0; i < translatedQuestions.length; i += batchSize) {
        questionBatches.push(translatedQuestions.slice(i, i + batchSize));
      }

      if (questionBatches.length > 1) {
        console.log(`📦 Chunking ${translatedQuestions.length} questions into ${questionBatches.length} batches of ${batchSize}`);
      }

      // Send each batch to the API
      const batchResponses = [];
      for (let i = 0; i < questionBatches.length; i++) {
        const batch = questionBatches[i];
        const batchPayload = {
          quizUuid,
          questions: batch
        };

        // Log payload size for debugging
        const payloadSize = JSON.stringify(batchPayload).length;
        if (questionBatches.length > 1) {
          console.log(`📤 Sending batch ${i + 1}/${questionBatches.length} with ${batch.length} questions (payload size: ${(payloadSize / 1024).toFixed(1)}KB)...`);
        }
        
        try {
          const updateResponse = await this.client.post("/api/ai/update-quiz-questions", batchPayload);

          if (updateResponse.data?.status !== '00') {
            throw new Error(`Failed to update quiz questions${questionBatches.length > 1 ? ` batch ${i + 1}` : ''}: ${updateResponse.data?.message || 'Unknown error'}`);
          }

          batchResponses.push(updateResponse.data);
          
          if (questionBatches.length > 1) {
            console.log(`✅ Batch ${i + 1}/${questionBatches.length} completed successfully`);

            // Add a small delay between batches to avoid overwhelming the server
            if (i < questionBatches.length - 1) {
              console.log(`⏳ Brief pause before next batch...`);
              await this.sleep(2000); // 2 second delay
            }
          }
        } catch (error) {
          console.error(`❌ Failed to send${questionBatches.length > 1 ? ` batch ${i + 1}/${questionBatches.length}` : ''}:`, error.message);
          console.error(`🔍 Error details:`, {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
            timeout: error.code === 'ECONNABORTED' ? 'API call timed out' : 'No timeout',
            url: error.config?.url,
            method: error.config?.method
          });
          
          // If it's a 500 error and we have more than 5 questions, try splitting into smaller batches
          if (error.response?.status === 500 && batch.length > 5) {
            console.log(`⚠️  Server error with ${batch.length} questions. Trying smaller batches of 5...`);
            
            try {
              const smallBatches = [];
              for (let j = 0; j < batch.length; j += 5) {
                smallBatches.push(batch.slice(j, j + 5));
              }
              
              for (let k = 0; k < smallBatches.length; k++) {
                const smallBatch = smallBatches[k];
                const smallPayload = {
                  quizUuid,
                  questions: smallBatch
                };
                
                const smallPayloadSize = JSON.stringify(smallPayload).length;
                console.log(`📤 Trying mini-batch ${k + 1}/${smallBatches.length} with ${smallBatch.length} questions (${(smallPayloadSize / 1024).toFixed(1)}KB)...`);
                
                const smallResponse = await this.client.post("/api/ai/update-quiz-questions", smallPayload);
                
                if (smallResponse.data?.status !== '00') {
                  throw new Error(`Failed to update mini-batch ${k + 1}: ${smallResponse.data?.message || 'Unknown error'}`);
                }
                
                console.log(`✅ Mini-batch ${k + 1}/${smallBatches.length} succeeded`);
                
                // Brief pause between mini-batches
                if (k < smallBatches.length - 1) {
                  await this.sleep(1000);
                }
              }
              
              // Use the last small response for the main response
              batchResponses.push(smallBatches[smallBatches.length - 1]);
              console.log(`🎉 Successfully processed ${batch.length} questions using smaller batches`);
              
            } catch (smallBatchError) {
              console.error(`❌ Even smaller batches failed:`, smallBatchError.message);
              throw new Error(`Failed to update quiz questions${questionBatches.length > 1 ? ` batch ${i + 1}` : ''}: ${smallBatchError.message}`);
            }
          } else {
            throw new Error(`Failed to update quiz questions${questionBatches.length > 1 ? ` batch ${i + 1}` : ''}: ${error.message}`);
          }
        }
      }

      if (questionBatches.length > 1) {
        console.log(`🎉 All ${questionBatches.length} batches sent successfully!`);
      }

      // Combine all batch responses (use the last response as the main response)
      const finalResponse = batchResponses[batchResponses.length - 1];
      console.log("Update quiz questions response:", finalResponse);

      // Final summary
      const endTime = Date.now();
      const totalTime = (endTime - startTime) / 1000;
      const averageTimePerOperation = totalTime / totalOperations;
      
      console.log('\n🎉 ===== TRANSLATION COMPLETED! =====');
      console.log(`✅ Successfully translated all ${questionsData.length} questions!`);
      console.log(`🌍 Now available in: ${targetLanguages.join(', ')}`);
      console.log(`⏱️  Total time taken: ${Math.floor(totalTime / 60)}m ${Math.floor(totalTime % 60)}s`);
      console.log(`📊 Average time per task: ${averageTimePerOperation.toFixed(1)} seconds`);
      if (this.rateLimitState.rateLimitCount > 0) {
        console.log(`⚠️  Had to wait for rate limits ${this.rateLimitState.rateLimitCount} times`);
      } else {
        console.log(`🚀 No rate limit issues - smooth sailing!`);
      }
      console.log(`🕒 Finished at ${new Date().toLocaleTimeString()}`);
      console.log('🎊 All done! Your quiz is ready to go!\n');

      return {
        quizUuid,
        questions: translatedQuestions,
        updatedLanguages: targetLanguages,
        timestamp: new Date().toISOString(),
        response: finalResponse,
        status: finalResponse?.status,
        message: finalResponse?.message,
        batchInfo: {
          totalBatches: questionBatches.length,
          batchSize: batchSize,
          totalQuestions: translatedQuestions.length
        },
        statistics: {
          totalQuestions: questionsData.length,
          totalLanguages: targetLanguages.length,
          totalOperations: totalOperations,
          totalTimeSeconds: totalTime,
          averageTimePerOperation: averageTimePerOperation,
          rateLimitEncounters: this.rateLimitState.rateLimitCount
        }
      };
    } catch (error) {
      console.error("Quiz questions translation error:", error);
      throw new Error(`Failed to translate quiz questions: ${error.message}`);
    }
  }

  async processQuestionsInBatches(questionsData, targetLanguages, startTime, totalOperations, initialBatchSize = 3) {
    const translatedQuestions = [];
    let currentBatchSize = initialBatchSize;
    let completedOperations = 0;
    
    // Adjust batch size based on rate limiting state
    if (this.rateLimitState.isRateLimited || this.rateLimitState.rateLimitCount > 0) {
      currentBatchSize = 1; // Process one at a time when rate limited
      console.log("⚠️  Going slower due to rate limits - processing one question at a time");
    }
    
    // Process questions in batches to control load
    for (let i = 0; i < questionsData.length; i += currentBatchSize) {
      const batch = questionsData.slice(i, i + currentBatchSize);
      const batchNumber = Math.floor(i/currentBatchSize) + 1;
      const totalBatches = Math.ceil(questionsData.length/currentBatchSize);
      const completedQuestions = i;
      const progressPercentage = Math.round((completedQuestions / questionsData.length) * 100);
      
      console.log(`\n📦 Working on batch ${batchNumber} of ${totalBatches}`);
      if (batch.length === 1) {
        console.log(`📝 Processing question ${completedQuestions + 1} of ${questionsData.length}`);
      } else {
        console.log(`📝 Processing ${batch.length} questions (${completedQuestions + 1}-${completedQuestions + batch.length} of ${questionsData.length})`);
      }
      // Create a simple progress bar
      const progressBarLength = 20;
      const filledLength = Math.round((completedQuestions / questionsData.length) * progressBarLength);
      const progressBar = '█'.repeat(filledLength) + '░'.repeat(progressBarLength - filledLength);
      
      console.log(`📊 Progress: ${completedQuestions}/${questionsData.length} questions done (${progressPercentage}%)`);
      console.log(`📈 [${progressBar}] ${progressPercentage}%`);
      
      // Calculate and display time estimates
      if (completedOperations > 0) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        const avgTimePerOperation = elapsedTime / completedOperations;
        const remainingOperations = totalOperations - completedOperations;
        const estimatedRemainingTime = (remainingOperations * avgTimePerOperation) / 60; // in minutes
        
        const elapsedMinutes = Math.floor(elapsedTime / 60);
        const elapsedSeconds = Math.floor(elapsedTime % 60);
        
        if (elapsedMinutes > 0) {
          console.log(`⏱️  Time so far: ${elapsedMinutes}m ${elapsedSeconds}s | About ${estimatedRemainingTime.toFixed(1)} minutes left`);
        } else {
          console.log(`⏱️  Time so far: ${elapsedSeconds}s | About ${estimatedRemainingTime.toFixed(1)} minutes left`);
        }
        
        if (this.rateLimitState.rateLimitCount > 0) {
          console.log(`⚠️  Rate limits encountered: ${this.rateLimitState.rateLimitCount} times (going ${this.rateLimitState.backoffMultiplier.toFixed(1)}x slower)`);
        }
      }
      
             // Check rate limit state before processing batch
       if (this.rateLimitState.isRateLimited) {
         console.log("⚠️  Taking it slow due to rate limits - processing one at a time");
         // Process questions one by one when rate limited
         for (const questionData of batch) {
           const questionIndex = questionsData.indexOf(questionData) + 1;
           console.log(`\n🔄 Working on question ${questionIndex} of ${questionsData.length}`);
           
           const result = await this.translateSingleQuestion(questionData, targetLanguages, questionIndex, questionsData.length);
           translatedQuestions.push(result);
           completedOperations += targetLanguages.length;
           
           console.log(`✅ Question ${questionIndex} is done! (translated into ${targetLanguages.length} languages)`);
           
           // Longer delay between questions when rate limited
           if (questionsData.indexOf(questionData) < questionsData.length - 1) {
             console.log("⏳ Taking a 5-second break before the next question...");
             await this.sleep(5000);
           }
         }
       } else {
         // Process questions in current batch in parallel
         try {
           console.log(`🚀 Processing ${batch.length} questions at the same time (fast mode)`);
           const batchPromises = batch.map(async (questionData, index) => {
             const actualIndex = i + index;
             return await this.translateSingleQuestion(questionData, targetLanguages, actualIndex + 1, questionsData.length);
           });
           
           const batchResults = await Promise.all(batchPromises);
           translatedQuestions.push(...batchResults);
           completedOperations += batch.length * targetLanguages.length;
           
           const totalTranslations = batch.length * targetLanguages.length;
           console.log(`✅ Batch complete! Just finished ${totalTranslations} translations (${batch.length} questions × ${targetLanguages.length} languages)`);
         } catch (error) {
           if (this.isRateLimitError(error)) {
             console.log("⚠️  Hit a rate limit! Let's try again more slowly...");
             // If batch fails due to rate limiting, retry sequentially
             for (const questionData of batch) {
               const questionIndex = questionsData.indexOf(questionData) + 1;
               console.log(`\n🔄 Retrying question ${questionIndex} of ${questionsData.length} (going slower now)`);
               
               const result = await this.translateSingleQuestion(questionData, targetLanguages, questionIndex, questionsData.length);
               translatedQuestions.push(result);
               completedOperations += targetLanguages.length;
               
               console.log(`✅ Question ${questionIndex} completed (retry successful!)`);
               await this.sleep(5000);
             }
           } else {
             throw error;
           }
         }
       }
      
             // Adaptive delay between batches based on rate limiting state
       if (i + currentBatchSize < questionsData.length) {
         const delayTime = this.rateLimitState.isRateLimited ? 10000 : 3000;
         const nextBatchNumber = batchNumber + 1;
         const remainingBatches = totalBatches - batchNumber;
         
         if (this.rateLimitState.isRateLimited) {
           console.log(`\n⏳ Taking a 10-second break before batch ${nextBatchNumber} (${remainingBatches} batches left)...`);
         } else {
           console.log(`\n⏳ Quick 3-second pause before batch ${nextBatchNumber} (${remainingBatches} more to go)...`);
         }
         await this.sleep(delayTime);
       }
       
       // Adjust batch size dynamically
       if (!this.rateLimitState.isRateLimited && this.rateLimitState.rateLimitCount === 0 && currentBatchSize < initialBatchSize) {
         currentBatchSize = Math.min(currentBatchSize + 1, initialBatchSize);
         console.log(`🚀 Speeding up! Now processing ${currentBatchSize} questions at once (no rate limits)`);
       }
    }
    
    return translatedQuestions;
  }

  async translateSingleQuestion(questionData, targetLanguages, questionIndex = 0, totalQuestions = 0) {
    console.log(`   🔍 Getting question ${questionIndex} of ${totalQuestions} ready...`);
    
    // Standardize and validate the question
    const standardizedQuestion = this.standardizeQuestionOptions(questionData);

    // Validate required fields
    if (!standardizedQuestion.uuid) {
      standardizedQuestion.uuid = uuidv4();
    }
    if (!standardizedQuestion.questionType) {
      standardizedQuestion.questionType = 'single-choice';
    }
    if (!standardizedQuestion.difficulty) {
      standardizedQuestion.difficulty = 'medium';
    }
    if (!standardizedQuestion.points) {
      standardizedQuestion.points = 1;
    }

    const questionPreview = standardizedQuestion.translations[0]?.questionText?.substring(0, 60) || 'N/A';
    console.log(`   📝 Question preview: "${questionPreview}..."`);

    // Find source translation (prefer English)
    const sourceTranslation = standardizedQuestion.translations.find(t => t.languageCode === 'en') 
      || standardizedQuestion.translations[0];
    
    if (!sourceTranslation) {
      throw new Error(`No source translation found for question ${standardizedQuestion.uuid}`);
    }

    // Keep existing translations
    const existingTranslations = standardizedQuestion.translations;
    const existingLanguages = existingTranslations.map(t => t.languageCode);
    const languagesToTranslate = targetLanguages.filter(lang => !existingLanguages.includes(lang));
    
    if (existingLanguages.length > 0) {
      console.log(`   🌍 Already have: ${existingLanguages.join(', ')}`);
    }
    if (languagesToTranslate.length > 0) {
      console.log(`   🎯 Need to create: ${languagesToTranslate.join(', ')} (${languagesToTranslate.length} of ${targetLanguages.length} languages)`);
    } else {
      console.log(`   ✅ This question already has all the languages we need!`);
    }

    // Translate to target languages - use sequential processing if rate limited
    let newTranslations;
    if (this.rateLimitState.isRateLimited || this.rateLimitState.rateLimitCount > 2) {
      console.log("   ⚠️  Going one language at a time (rate limits require slower pace)");
      newTranslations = [];
      for (let i = 0; i < targetLanguages.length; i++) {
        const lang = targetLanguages[i];
        console.log(`   🌍 Working on ${lang} (${i + 1} of ${targetLanguages.length} languages)`);
        
        // Skip if translation already exists
        const existingTrans = existingTranslations.find(t => t.languageCode === lang);
        if (existingTrans) {
          newTranslations.push(existingTrans);
          console.log(`   ✅ ${lang}: Already done, using existing version`);
          continue;
        }

        console.log(`   🔄 ${lang}: Creating translation...`);
        const translation = await this.translateToLanguage(sourceTranslation, lang);
        newTranslations.push(translation);
        console.log(`   ✅ ${lang}: Done!`);
        
        // Add delay between languages when rate limited
        if (i < targetLanguages.length - 1) {
          const remaining = targetLanguages.length - 1 - i;
          console.log(`   ⏳ Taking a 3-second break (${remaining} languages left)...`);
          await this.sleep(3000);
        }
      }
    } else {
      // Translate to all target languages in parallel
      const needTranslation = targetLanguages.filter(lang => 
        !existingTranslations.find(t => t.languageCode === lang)
      );
      
      if (needTranslation.length === 0) {
        console.log(`   ✅ All ${targetLanguages.length} languages already available!`);
        newTranslations = existingTranslations;
      } else {
        console.log(`   🚀 Translating ${needTranslation.length} languages at once (fast mode)`);
        
        const translationPromises = targetLanguages.map(async (lang, index) => {
          // Skip if translation already exists
          const existingTrans = existingTranslations.find(t => t.languageCode === lang);
          if (existingTrans) {
            return existingTrans;
          }

          const translation = await this.translateToLanguage(sourceTranslation, lang);
          return translation;
        });

        try {
          newTranslations = await Promise.all(translationPromises);
          console.log(`   🎉 All ${targetLanguages.length} languages ready!`);
        } catch (error) {
          if (this.isRateLimitError(error)) {
            console.log("   ⚠️  Hit rate limits! Let's try one language at a time...");
            newTranslations = [];
            for (let i = 0; i < targetLanguages.length; i++) {
              const lang = targetLanguages[i];
              console.log(`   🔄 Retrying ${lang} (${i + 1} of ${targetLanguages.length})`);
              
              const existingTrans = existingTranslations.find(t => t.languageCode === lang);
              if (existingTrans) {
                newTranslations.push(existingTrans);
                console.log(`   ✅ ${lang}: Using existing version`);
                continue;
              }

              const translation = await this.translateToLanguage(sourceTranslation, lang);
              newTranslations.push(translation);
              console.log(`   ✅ ${lang}: Success on retry!`);
              
              if (i < targetLanguages.length - 1) {
                console.log(`   ⏳ Brief pause before next language...`);
                await this.sleep(3000);
              }
            }
          } else {
            throw error;
          }
        }
      }
    }
    
    // Update question with all translations
    standardizedQuestion.translations = newTranslations;
    return standardizedQuestion;
  }

  async translateToLanguage(sourceTranslation, targetLanguage, maxRetries = 2) {
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        // Try batch translation first for efficiency
        console.log(`     🔄 ${targetLanguage}: Trying fast batch method...`);
        const result = await this.batchTranslateTexts(sourceTranslation, targetLanguage);
        console.log(`     ✅ ${targetLanguage}: Fast method worked!`);
        return result;
      } catch (error) {
        console.log(`     ⚠️  ${targetLanguage}: Fast method didn't work - ${error.message.substring(0, 50)}...`);
        console.log(`     🔄 ${targetLanguage}: Trying slower but more reliable method...`);
        
        // Fallback to individual translations
        try {
          const result = await this.individualTranslateTexts(sourceTranslation, targetLanguage);
          console.log(`     ✅ ${targetLanguage}: Slower method succeeded!`);
          return result;
        } catch (fallbackError) {
          if (fallbackError.message.includes('Rate limit') || fallbackError.status === 429) {
            retries++;
            const delay = Math.min(10000 * Math.pow(2, retries), 60000); // Max 60s delay
            const delayMinutes = Math.floor(delay / 60000);
            const delaySeconds = Math.floor((delay % 60000) / 1000);
            
            if (delayMinutes > 0) {
              console.log(`     ⚠️  ${targetLanguage}: Hit rate limit! Waiting ${delayMinutes}m ${delaySeconds}s before retry ${retries} of ${maxRetries}...`);
            } else {
              console.log(`     ⚠️  ${targetLanguage}: Hit rate limit! Waiting ${delaySeconds}s before retry ${retries} of ${maxRetries}...`);
            }
            await this.sleep(delay);
            continue;
          }
          console.log(`     ❌ ${targetLanguage}: Both methods failed - ${fallbackError.message.substring(0, 50)}...`);
          throw fallbackError;
        }
      }
    }
    
    throw new Error(`Couldn't translate to ${targetLanguage} after ${maxRetries} attempts`);
  }

  async batchTranslateTexts(sourceTranslation, targetLanguage) {
    // Batch translate all text in one API call for efficiency
    const allOptionValues = Object.values(sourceTranslation.options);
    const optionsToTranslate = allOptionValues.filter(value => 
      // Skip numeric/alphanumeric values
      !/^-?\d+(\.\d+)?(%|cm|m)?$/.test(value) && !/^[A-Za-z0-9]+$/.test(value)
    );
    
    const textsToTranslate = [
      sourceTranslation.questionText,
      ...optionsToTranslate,
      sourceTranslation.explanation
    ];

    console.log(`       📝 Translating ${textsToTranslate.length} pieces of text to ${targetLanguage} all at once`);
    console.log(`       📊 That's the question + ${optionsToTranslate.length} of ${allOptionValues.length} answer options + explanation`);

    const batchTranslatePrompt = `Translate the following texts to ${targetLanguage}. 
IMPORTANT: Return EXACTLY ${textsToTranslate.length} translations separated by "###SEPARATOR###".
Do NOT add explanations, prefixes, or additional text.
Format: translation1###SEPARATOR###translation2###SEPARATOR###translation3

Texts to translate:
${textsToTranslate.map((text, i) => `[${i + 1}] ${text}`).join('\n\n')}`;

    const batchResult = await this.translateWithLLM(
      batchTranslatePrompt,
      targetLanguage,
      "Batch translation of quiz content"
    );

    console.log('Batch translation result:', batchResult);

    const translations = batchResult.split('###SEPARATOR###').map(t => t.trim());
    
    console.log(`Expected ${textsToTranslate.length} translations, got ${translations.length}`);
    console.log('Translations:', translations);
    
    if (translations.length !== textsToTranslate.length) {
      throw new Error(`Batch translation count mismatch: expected ${textsToTranslate.length}, got ${translations.length}`);
    }

    // Reconstruct the translation object
    let translationIndex = 0;
    const questionText = translations[translationIndex++];
    
    const options = {};
    for (const [key, value] of Object.entries(sourceTranslation.options)) {
      // Keep numeric/alphanumeric values as is
      if (/^-?\d+(\.\d+)?(%|cm|m)?$/.test(value) || /^[A-Za-z0-9]+$/.test(value)) {
        options[key] = value;
      } else {
        options[key] = translations[translationIndex++];
      }
    }
    
    const explanation = translations[translationIndex++];

    return {
      languageCode: targetLanguage,
      questionText,
      options,
      correctAnswer: Array.isArray(sourceTranslation.correctAnswer) 
        ? sourceTranslation.correctAnswer 
        : [sourceTranslation.correctAnswer], // Ensure correctAnswer is always an array
      explanation
    };
  }

  async individualTranslateTexts(sourceTranslation, targetLanguage) {
    const allOptions = Object.entries(sourceTranslation.options);
    const optionsToTranslate = allOptions.filter(([key, value]) => 
      !/^-?\d+(\.\d+)?(%|cm|m)?$/.test(value) && !/^[A-Za-z0-9]+$/.test(value)
    );
    
    console.log(`       🔄 Translating to ${targetLanguage} piece by piece (reliable method)`);
    console.log(`       📊 Will translate: question + ${optionsToTranslate.length} of ${allOptions.length} answer options + explanation`);
    
    // Translate question text
    console.log(`       📝 Starting with the question...`);
    const questionText = await this.translateWithLLM(
      sourceTranslation.questionText,
      targetLanguage,
      "This is a quiz question"
    );

    // Adaptive delay based on rate limiting state
    const baseDelay = this.rateLimitState.isRateLimited ? 3000 : 1000;
    if (baseDelay > 1000) {
      console.log(`       ⏳ Taking a ${baseDelay/1000}s break before answer options...`);
    } else {
      console.log(`       ⏳ Quick ${baseDelay/1000}s pause before answer options...`);
    }
    await this.sleep(baseDelay);

    // Translate options
    const options = {};
    let optionCount = 0;
    for (const [key, value] of Object.entries(sourceTranslation.options)) {
      // Keep numeric/alphanumeric values as is
      if (/^-?\d+(\.\d+)?(%|cm|m)?$/.test(value) || /^[A-Za-z0-9]+$/.test(value)) {
        options[key] = value;
        console.log(`       ✅ Option ${key}: Keeping "${value}" as-is (it's a number/code)`);
      } else {
        optionCount++;
        console.log(`       🔄 Working on answer option ${optionCount} of ${optionsToTranslate.length} (${key})...`);
        options[key] = await this.translateWithLLM(
          value,
          targetLanguage,
          "This is a quiz answer option"
        );
        console.log(`       ✅ Option ${key} done!`);
        
        if (optionCount < optionsToTranslate.length) {
          console.log(`       ⏳ Brief pause before next option...`);
          await this.sleep(baseDelay);
        }
      }
    }

    // Translate explanation
    console.log(`       🔄 Finally, translating the explanation...`);
    const explanation = await this.translateWithLLM(
      sourceTranslation.explanation,
      targetLanguage,
      "This is an explanation for the correct answer"
    );
    console.log(`       ✅ All done with ${targetLanguage}!`);

    return {
      languageCode: targetLanguage,
      questionText,
      options,
      correctAnswer: Array.isArray(sourceTranslation.correctAnswer) 
        ? sourceTranslation.correctAnswer 
        : [sourceTranslation.correctAnswer], // Ensure correctAnswer is always an array
      explanation
    };
  }

  async extractQuestionsWithRegex(text) {
    console.log("Falling back to regex-based extraction");
    const questions = [];
    
    // Match question blocks
    const questionRegex = /Question\s+\d+:\s*(.*?)(?=Question\s+\d+:|$)/gs;
    const matches = text.matchAll(questionRegex);
    
    for (const match of matches) {
      try {
        const questionBlock = match[1].trim();
        
        // Extract question text
        const questionText = questionBlock.split('\n')[0].trim();
        
        // Extract options
        const options = {};
        const optionMatches = questionBlock.matchAll(/\s+([A-Za-z0-9]+)\s*(?:\.|:)?\s*(.*?)(?=\s+[A-Za-z0-9]+\s*(?:\.|:)|Answer|$)/gs);
        let optionIndex = 1;
        
        for (const optionMatch of optionMatches) {
          const optionText = optionMatch[2].trim();
          if (optionText && !optionText.toLowerCase().includes('answer')) {
            options[`option_${optionIndex}`] = optionText;
            optionIndex++;
          }
        }
        
        // Extract answer
        const answerMatch = questionBlock.match(/Answer\s*\(([A-Z,]+)\)/i);
        let correctAnswer = '';
        if (answerMatch) {
          const answerLetter = answerMatch[1].split(',')[0]; // Take first answer for multi-select
          const answerIndex = answerLetter.charCodeAt(0) - 64; // Convert A->1, B->2, etc.
          correctAnswer = `option_${answerIndex}`;
        }
        
        if (questionText && Object.keys(options).length > 0 && correctAnswer) {
          questions.push({
            questionType: "single-choice",
            difficulty: "medium",
            points: 1,
            metadata: {
              source: "regex_extraction",
              extractionMethod: "fallback"
            },
            translations: [{
              languageCode: "en",
              questionText: questionText,
              options: options,
              correctAnswer: Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer], // Convert to array as server expects array format
              explanation: "Extracted using fallback method due to API quota limits."
            }]
          });
        }
      } catch (error) {
        console.error("Error processing question block:", error);
      }
    }
    
    return questions;
  }

  async extractQuestions(text) {
    try {
      return await this.extractQuestionsWithLLM(text);
    } catch (error) {
      if (error.message.includes('quota') || error.message.includes('rate limit')) {
        console.log("Falling back to regex extraction due to API limits");
        const questions = await this.extractQuestionsWithRegex(text);
        
        if (questions.length === 0) {
          throw new Error("No questions could be extracted using fallback method");
        }
        
        // Add questions to the quiz 
        const payload = {
          quizUuid: this.quizUuid,
          questions: questions,
          metadata: {
            source: "regex_extraction",
            totalQuestions: questions.length,
            textLength: text.length,
            extractionMethod: "fallback"
          }
        };
        
        console.log(`Adding ${questions.length} questions extracted using fallback method`);
        return await this.quizFactorApiService.addQuestionsToQuiz(payload); 
      }
      throw error;
    }
  }

  async extractQuestionsWithLLM(text) {
    try {
      console.log("Extracting questions using LLM");
      console.log("Text length:", text.length);

    
      
      // Split text into smaller chunks (4000 characters per chunk)
      const chunks = this.splitIntoChunks(text, 4000);
      let allQuestions = [];
      
      console.log(`Split text into ${chunks.length} chunks`);
      
      // Initial quota check
      try {
        await llmService.processPrompt("test", { maxTokens: 100 });
        console.log("API connection test successful");
      } catch (quotaError) {
        console.error("API Quota/Connection Test Error:", quotaError);
        
        if (quotaError.message.includes('credit balance is too low')) {
          throw new Error("Your credit balance is too low. Please check your API credits.");
        }
        throw quotaError;
      }

      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        try {
          console.log(`Processing chunk ${i + 1}/${chunks.length} (length: ${chunks[i].length})`);
          
          const prompt = `Extract multiple choice questions from the following text. Each question must have:
1. A clear question text
2. Multiple choice options labeled as option_1, option_2, etc.
3. A single correct answer specified as "option_X"
4. An explanation for the correct answer

Format each question as a JSON object with this exact structure:
{
  "questionText": "the complete question text",
  "options": {
    "option_1": "first option text",
    "option_2": "second option text",
    "option_3": "third option text",
    "option_4": "fourth option text"
  },
  "correctAnswer": "option_X",
  "explanation": "detailed explanation of why this is the correct answer"
}

Important:
1. Extract ALL questions from this text
2. Include all options exactly as they appear
3. Make sure options are labeled as option_1, option_2, etc.
4. Ensure correctAnswer matches one of the option keys
5. Always include an explanation
6. Make sure the JSON is properly formatted

Text to process:
${chunks[i]}

Return ONLY a valid JSON array of question objects, with no additional text.`;

          const response = await llmService.processPrompt(prompt, {
            maxTokens: 4000,
            temperature: 0
          });

          try {
            // Clean up the response text
            let responseText = response.trim();
            if (!responseText.startsWith('[')) {
              const startBracket = responseText.indexOf('[');
              if (startBracket !== -1) {
                responseText = responseText.substring(startBracket);
              }
            }
            if (!responseText.endsWith(']')) {
              const endBracket = responseText.lastIndexOf(']');
              if (endBracket !== -1) {
                responseText = responseText.substring(0, endBracket + 1);
              }
            }

            const questions = JSON.parse(responseText);
            if (Array.isArray(questions)) {
              console.log(`Parsed ${questions.length} questions from chunk ${i + 1}`);
              allQuestions = allQuestions.concat(questions);
            }
          } catch (parseError) {
            console.error("Error parsing LLM response:", parseError);
            console.error("Response text:", response);
          }
        } catch (error) {
          console.error(`Error processing chunk ${i + 1}:`, error);
        }
      }

      console.log("Total questions extracted:", allQuestions.length);
      
      if (allQuestions.length === 0) {
        throw new Error("No questions could be extracted from any chunks");
      }

      console.log("All questions:", allQuestions);

      return allQuestions;
    } catch (error) {
      console.error("Question extraction error:", error);
      throw error;
    }
  }

  splitIntoChunks(text, maxChunkSize = 8000) {
    // First try to split by question markers
    const questionMarkers = [
      /Question\s+\d+[\.:\)]/i,
      /Q\d+[\.:\)]/i,
      /\d+\.\s+/,
      /\n\s*\n/  // Double newline as fallback
    ];

    let chunks = [];
    let currentChunk = "";
    let currentSize = 0;
    
    // Split text into potential question blocks
    const blocks = text.split(/(?=Question\s+\d+[\.:\)]|Q\d+[\.:\)]|\n\d+\.\s+)/i)
      .filter(block => block.trim().length > 0);  // Remove empty blocks
    
    console.log(`Found ${blocks.length} potential question blocks`);
    
    for (const block of blocks) {
      const blockSize = block.length;
      
      // If a single block is larger than maxChunkSize, split it further
      if (blockSize > maxChunkSize) {
        const subChunks = [];
        let i = 0;
        while (i < block.length) {
          // Try to split at a sentence boundary
          let end = i + maxChunkSize;
          if (end < block.length) {
            const nextPeriod = block.indexOf('.', end - 100);
            if (nextPeriod !== -1 && nextPeriod < end + 100) {
              end = nextPeriod + 1;
            }
          }
          subChunks.push(block.slice(i, end));
          i = end;
        }
        chunks.push(...subChunks);
      }
      // If adding this block would exceed maxChunkSize, start a new chunk
      else if (currentSize + blockSize > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = block;
        currentSize = blockSize;
      }
      // Otherwise, add to current chunk
      else {
        if (currentChunk && !currentChunk.endsWith('\n')) {
          currentChunk += '\n';
        }
        currentChunk += block;
        currentSize += blockSize;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // If no chunks were created, fall back to size-based splitting
    if (chunks.length === 0) {
      console.log("No question markers found, falling back to size-based splitting");
      let i = 0;
      while (i < text.length) {
        // Try to split at a sentence boundary
        let end = i + maxChunkSize;
        if (end < text.length) {
          const nextPeriod = text.indexOf('.', end - 100);
          if (nextPeriod !== -1 && nextPeriod < end + 100) {
            end = nextPeriod + 1;
          }
        }
        chunks.push(text.slice(i, end));
        i = end;
      }
    }

    console.log(`Created ${chunks.length} chunks`); 
    chunks.forEach((chunk, i) => {
      console.log(`Chunk ${i + 1} length: ${chunk.length}`);
    });

    return chunks;
  }

  async extractAndAddQuestions(content, quizUuid = null) {
    try {
      console.log("Starting question extraction process");
      
      // Ensure content is a string
      if (typeof content !== 'string') {
        if (Array.isArray(content)) {
          // If it's an array of questions, transform them directly
          const questions = content.map(q => ({
            uuid: uuidv4(),
            questionType: Array.isArray(q.correctAnswer) ? "multi-choice" : "single-choice",
            difficulty: "medium",
            points: 1,
            translations: [{
              languageCode: "en",
              questionText: q.content || q.questionText,
              options: q.options,
              correctAnswer: Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer], // Keep array format or convert string to array
              explanation: q.explanation || "No explanation provided"
            }]
          }));
          
          if (!questions || questions.length === 0) {
            throw new Error("No questions could be extracted from the document");
          }

          console.log(`Using ${questions.length} pre-extracted questions`);

          // Write questions to file before sending to server
          await this.writeQuestionsToFile(questions, quizUuid || 'temp', 'pre-extracted');

          // If no quiz UUID provided, create a new quiz
          if (!quizUuid) {
            quizUuid = await this.createQuiz(
              "Generated Quiz",
              "Quiz generated from text content"
            );
          }

          // Add questions to the quiz without translation
          const result = await this.addQuestionsToQuiz(quizUuid, questions);

          return {
            quizUuid: result.quizUuid,
            questions: result.questions,
            message: `Successfully added ${questions.length} questions`,
            status: 'extracted'
          };
        } else {
          throw new Error("Invalid content format");
        }
      }
      
      // Clean up the content
      content = content
        .replace(/\r\n/g, "\n")
        .replace(/\n\s+/g, "\n")
        .trim();

      // Extract questions using LLM with chunking
      const extractedQuestions = await this.extractQuestions(content);
      
      if (!extractedQuestions || extractedQuestions.length === 0) {
        throw new Error("No questions could be extracted from the document");
      }

      console.log(`Extracted ${extractedQuestions.length} questions`);

      // Transform extracted questions to the expected format
      const questions = extractedQuestions.map(q => ({
        uuid: uuidv4(),
        questionType: "single-choice",
        difficulty: "medium",
        points: 1,
        translations: [{
          languageCode: "en",
          questionText: q.questionText,
          options: q.options,
          correctAnswer: Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer], // Ensure correctAnswer is always an array
          explanation: q.explanation
        }]
      }));

      // Write questions to file before sending to server
      await this.writeQuestionsToFile(questions, quizUuid || 'temp', 'llm-extracted');

      // If no quiz UUID provided, create a new quiz
      if (!quizUuid) {
        quizUuid = await this.createQuiz(
          "Generated Quiz",
          "Quiz generated from text content"
        );
      }

      // Add questions to the quiz without translation
      const result = await this.addQuestionsToQuiz(quizUuid, questions);

      return {
        quizUuid: result.quizUuid,
        questions: result.questions,
        message: `Successfully extracted and added ${questions.length} questions`,
        status: 'extracted'
      };
    } catch (error) {
      console.error("Question extraction error:", error);
      throw new Error(`Failed to extract and add questions: ${error.message}`);
    }
  }

  async addQuestionsToQuiz(quizUuid, questions) {
    try {
      // Prepare API payload
      const payload = {
        quizUuid,
        questions
      };

      // Log the payload for debugging
      console.log('\n=== Adding Questions to Quiz ===');
      console.log('Quiz UUID:', quizUuid);
      console.log('Number of questions:', questions.length);
      console.log('First question sample:');
      if (questions[0]) {
        console.log('- UUID:', questions[0].uuid);
        console.log('- Type:', questions[0].questionType);
        console.log('- Number of translations:', questions[0].translations.length);
        console.log('- Languages:', questions[0].translations.map(t => t.languageCode).join(', '));
        console.log('- First translation:');
        if (questions[0].translations[0]) {
          const trans = questions[0].translations[0];
          console.log('  - Language:', trans.languageCode);
          console.log('  - Question:', trans.questionText);
          console.log('  - Options:', JSON.stringify(trans.options, null, 2));
          console.log('  - Correct Answer:', trans.correctAnswer);
        }
      }
      console.log('=== End Adding Questions to Quiz ===\n');

      // Write questions to file before sending to server for backup
      await this.writeQuestionsToFile(questions, quizUuid, 'pre-api-send');

      // Chunk questions into smaller batches to avoid "request entity too large" error
      const batchSize = 100; // Reduced to 100 to avoid "request entity too large" error
      const questionBatches = [];
      
      for (let i = 0; i < questions.length; i += batchSize) {
        questionBatches.push(questions.slice(i, i + batchSize));
      }

      if (questionBatches.length > 1) {
        console.log(`📦 Chunking ${questions.length} questions into ${questionBatches.length} batches of ${batchSize}`);
      }

      // Send each batch to the API
      const batchResponses = [];
      for (let i = 0; i < questionBatches.length; i++) {
        const batch = questionBatches[i];
        const batchPayload = {
          quizUuid,
          questions: batch
        };

        // Log payload size for debugging
        const payloadSize = JSON.stringify(batchPayload).length;
        if (questionBatches.length > 1) {
          console.log(`📤 Sending batch ${i + 1}/${questionBatches.length} with ${batch.length} questions (payload size: ${(payloadSize / 1024).toFixed(1)}KB)...`);
        } else {
          console.log(`📤 Sending ${batch.length} questions (payload size: ${(payloadSize / 1024).toFixed(1)}KB)...`);
        }
        
        try {
          console.log(`🚀 Making API call for batch ${i + 1}/${questionBatches.length}...`);
          const updateResponse = await this.client.post("/api/ai/add-quiz-questions", batchPayload);
          console.log(`✅ API call completed for batch ${i + 1}/${questionBatches.length}`);

          if (updateResponse.data?.status !== '00') {
            console.error(`❌ API returned error status:`, updateResponse.data);
            throw new Error(`Failed to add quiz questions${questionBatches.length > 1 ? ` batch ${i + 1}` : ''}: ${updateResponse.data?.message || 'Unknown error'}`);
          }

          console.log('updateResponse>>>>>', updateResponse);

          batchResponses.push(updateResponse.data);
          
          if (questionBatches.length > 1) {
            console.log(`✅ Batch ${i + 1}/${questionBatches.length} completed successfully`);

            // Add a small delay between batches to avoid overwhelming the server
            if (i < questionBatches.length - 1) {
              console.log(`⏳ Brief pause before next batch...`);
              await this.sleep(2000); // 2 second delay
            }
          } else {
            console.log(`✅ Questions added successfully`);
          }
        } catch (error) {
          console.error(`❌ Failed to send${questionBatches.length > 1 ? ` batch ${i + 1}/${questionBatches.length}` : ''}:`, error.message);
          console.error(`🔍 Error details:`, {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
            timeout: error.code === 'ECONNABORTED' ? 'API call timed out' : 'No timeout',
            url: error.config?.url,
            method: error.config?.method
          });
          
          // If it's a 500 error and we have more than 5 questions, try splitting into smaller batches
          if (error.response?.status === 500 && batch.length > 5) {
            console.log(`⚠️  Server error with ${batch.length} questions. Trying smaller batches of 5...`);
            
            try {
              const smallBatches = [];
              for (let j = 0; j < batch.length; j += 5) {
                smallBatches.push(batch.slice(j, j + 5));
              }
              
              for (let k = 0; k < smallBatches.length; k++) {
                const smallBatch = smallBatches[k];
                const smallPayload = {
                  quizUuid,
                  questions: smallBatch
                };
                
                const smallPayloadSize = JSON.stringify(smallPayload).length;
                console.log(`📤 Trying mini-batch ${k + 1}/${smallBatches.length} with ${smallBatch.length} questions (${(smallPayloadSize / 1024).toFixed(1)}KB)...`);
                
                const smallResponse = await this.client.post("/api/ai/add-quiz-questions", smallPayload);
                
                if (smallResponse.data?.status !== '00') {
                  throw new Error(`Failed to add mini-batch ${k + 1}: ${smallResponse.data?.message || 'Unknown error'}`);
                }
                
                console.log(`✅ Mini-batch ${k + 1}/${smallBatches.length} succeeded`);
                
                // Brief pause between mini-batches
                if (k < smallBatches.length - 1) {
                  await this.sleep(1000);
                }
              }
              
              // Use the last small response for the main response
              batchResponses.push(smallBatches[smallBatches.length - 1]);
              console.log(`🎉 Successfully processed ${batch.length} questions using smaller batches`);
              
            } catch (smallBatchError) {
              console.error(`❌ Even smaller batches failed:`, smallBatchError.message);
              throw new Error(`Failed to add quiz questions${questionBatches.length > 1 ? ` batch ${i + 1}` : ''}: ${smallBatchError.message}`);
            }
          } else {
            throw new Error(`Failed to add quiz questions${questionBatches.length > 1 ? ` batch ${i + 1}` : ''}: ${error.message}`);
          }
        }
      }

      if (questionBatches.length > 1) {
        console.log(`🎉 All ${questionBatches.length} batches sent successfully!`);
      }

      // Combine all batch responses (use the last response as the main response)
      const finalResponse = batchResponses[batchResponses.length - 1];

      return {
        quizUuid,
        questions,
        timestamp: new Date().toISOString(),
        response: finalResponse,
        status: finalResponse?.status,
        message: finalResponse?.message,
        batchInfo: {
          totalBatches: questionBatches.length,
          batchSize: batchSize,
          totalQuestions: questions.length
        }
      };
    } catch (error) {
      console.error("Add questions error:", error);
      throw new Error(`Failed to add questions to quiz: ${error.message}`);
    }
  } 

  async translateAndAddQuestions(quizUuid, targetLanguages, questions = null) {
    try {
      // If questions are not provided, fetch them from the quiz
      if (!questions) {
        const quizResponse = await this.client.get(`/api/ai/quiz/details/${quizUuid}`);
        
        if (quizResponse.data?.status !== '00') {
          throw new Error(`Failed to fetch quiz: ${quizResponse.data?.message || 'Unknown error'}`);
        }

        // Get questions from quiz (this would need to be implemented in the API)
        // For now, we'll assume questions are passed in
        throw new Error("Questions must be provided for translation");
      }

      console.log(`Starting translation for ${questions.length} questions`);

      // Add questions to the quiz with translations
      const result = await this.translateQuestions(quizUuid, targetLanguages, questions);

      return {
        quizUuid: result.quizUuid,
        questions: result.questions,
        message: `Successfully translated and added ${questions.length} questions`,
        updatedLanguages: targetLanguages,
        status: 'translated'
      };
    } catch (error) {
      console.error("Question translation error:", error);
      throw new Error(`Failed to translate and add questions: ${error.message}`);
    }
  }

  createQuestionObject(questionText, options, correctAnswer, explanation) {
    return {
      uuid: uuidv4(),
      questionType: "single-choice",
      difficulty: "medium",
      points: 1,
      translations: [
        {
          languageCode: "en",
          questionText,
          options,
          correctAnswer: Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer], // Ensure correctAnswer is always an array
          explanation,
        },
      ],
    };
  }

  async translateText(text, targetLanguage) {
    return this.translateWithLLM(text, targetLanguage);
  }

  async detectLanguages(text) {
    try {
      const prompt = `Please analyze the following text and detect its language. Return only the ISO 639-1 language code.
Text: "${text}"`;

      const response = await llmService.processPrompt(prompt, {
        maxTokens: 128,
        temperature: 0
      });

      return [response.trim()];
    } catch (error) {
      console.error("Language detection error:", error);
      throw new Error(`Failed to detect languages: ${error.message}`);
    }
  }

  async getLanguages() {
    try {
      const response = await this.client.get("/api/ai/languages");

      if (
        response.data &&
        response.data.data &&
        Array.isArray(response.data.data)
      ) {
        return response.data.data;
      }

      throw new Error("Invalid response format from API");
    } catch (error) {
      console.warn(
        "Failed to fetch languages from API, using default languages:",
        error.message
      );
      // Return default supported languages
    }
  }

  async getQuizInfo(quizUuid) {
    try {
      const response = await this.client.get(`/api/ai/quiz/${quizUuid}`);
      
      if (response.data?.status !== '00') {
        throw new Error(`Failed to fetch quiz: ${response.data?.message || 'Unknown error'}`);
      }

      const quiz = response.data.data;
      
      return {
        uuid: quiz.uuid,
        title: quiz.title,
        description: quiz.description,
        courseUuid: quiz.courseUuid,
        difficulty: quiz.difficulty,
        timeLimit: quiz.timeLimit,
        passingScore: quiz.passingScore,
        isActive: quiz.isActive,
        questions: quiz.questions || [],
        translations: quiz.translations || [],
        questionCount: (quiz.questions || []).length,
        availableLanguages: (quiz.translations || []).map(t => t.languageCode),
        hasQuestions: (quiz.questions || []).length > 0,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error("Get quiz info error:", error);
      throw new Error(`Failed to get quiz information: ${error.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper method to write questions to file before sending to server
  // This creates backup files in ./extracted-questions/ directory with the following structure:
  // {
  //   "metadata": {
  //     "quizUuid": "...",
  //     "status": "extracted|translated|pre-api-send|etc",
  //     "timestamp": "2024-01-01T12:00:00.000Z",
  //     "totalQuestions": 123,
  //     "languages": ["en", "es", "fr"],
  //     "questionTypes": ["single-choice"],
  //     "sampleQuestion": { "uuid": "...", "questionType": "...", "..." }
  //   },
  //   "questions": [...]
  // }
  async writeQuestionsToFile(questions, quizUuid, status = 'extracted') {
    try {
      // Create output directory if it doesn't exist
      const outputDir = path.join(process.cwd(), 'extracted-questions');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `questions_${quizUuid}_${status}_${timestamp}.json`;
      const filepath = path.join(outputDir, filename);

      // Prepare data to write
      const dataToWrite = {
        metadata: {
          quizUuid,
          status,
          timestamp: new Date().toISOString(),
          totalQuestions: questions.length,
          extractionSource: 'translationService',
          nodeVersion: process.version,
          platform: process.platform,
          languages: questions.length > 0 && questions[0].translations 
            ? questions[0].translations.map(t => t.languageCode) 
            : ['unknown'],
          questionTypes: [...new Set(questions.map(q => q.questionType || 'unknown'))],
          sampleQuestion: questions.length > 0 ? {
            uuid: questions[0].uuid,
            questionType: questions[0].questionType,
            translationCount: questions[0].translations?.length || 0,
            firstTranslation: questions[0].translations?.[0]?.questionText?.substring(0, 100) + '...' || 'N/A'
          } : null
        },
        questions: questions
      };

      // Write to file
      fs.writeFileSync(filepath, JSON.stringify(dataToWrite, null, 2), 'utf8');
      
      console.log(`📁 Questions saved to file: ${filename}`);
      console.log(`📍 Location: ${filepath}`);
      console.log(`📊 Total questions: ${questions.length}`);
      console.log(`🏷️  Status: ${status}`);
      console.log(`📄 File contains metadata + questions in JSON format`);

      return filepath;
    } catch (error) {
      console.error("Error writing questions to file:", error);
      // Don't throw error here - file writing failure shouldn't stop the main process
      return null;
    }
  }
}

export default new TranslationService();
