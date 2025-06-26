import axios from "axios";
import { v4 as uuidv4 } from "uuid";
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
      timeout: 30000,
    });
  }

  async translateWithLLM(text, targetLanguage, context = "", maxRetries = 3) {
    let retries = 0;
    const baseDelay = 2000; // Start with 2 second delay
    
    while (retries < maxRetries) {
      try {
        const prompt = `Translate the following text to ${targetLanguage}. Return ONLY the translation, without any prefixes or explanations:

Context: ${context}
Text to translate: "${text}"`;

        const translatedText = await llmService.processPrompt(prompt, {
          maxTokens: 1024,
          temperature: 0
        });

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

        if (error.message.includes('Rate limit') || error.message.includes('429')) {
          retries++;
          // Exponential backoff with jitter
          const jitter = Math.random() * 1000;
          const delay = (baseDelay * Math.pow(2, retries)) + jitter;
          console.log(`Rate limited, waiting ${delay/1000} seconds before retry ${retries}/${maxRetries}`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Failed to translate with LLM: ${error.message}`);
      }
    }
    throw new Error(`Failed to translate after ${maxRetries} retries due to rate limiting`);
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
                  correctAnswer: existingTrans.correctAnswer,
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
                correctAnswer: sourceTranslation.correctAnswer, // Keep the same correct answer key
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
      console.log('\n=== API Request Payload ===');
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
      console.log('\nFull payload:', JSON.stringify(payload, null, 2));
      console.log('=== End API Request Payload ===\n');

      const updateResponse = await this.client.post("/api/ai/add-quiz-questions", payload);

      if (updateResponse.data?.status !== '00') {
        throw new Error(`Failed to update quiz questions: ${updateResponse.data?.message || 'Unknown error'}`); 
      }

      return {
        quizUuid,
        questions: translatedQuestions,
        updatedLanguages: targetLanguages,
        timestamp: new Date().toISOString(),
        response: updateResponse.data
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
    // Ensure question has required fields
    if (!question.translations || !Array.isArray(question.translations)) {
      throw new Error("Question must have translations array");
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
    try {
      // Validate input data
      if (!quizUuid || !Array.isArray(questionsData) || questionsData.length === 0) {
        throw new Error("Invalid input: quizUuid and questions array are required");
      }

      // Process questions one at a time to avoid rate limits
      const translatedQuestions = [];
      
      for (let i = 0; i < questionsData.length; i++) {
        console.log(`Processing question ${i + 1}/${questionsData.length}`);
        const questionData = questionsData[i];

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

        // Find source translation (prefer English)
        const sourceTranslation = standardizedQuestion.translations.find(t => t.languageCode === 'en') 
          || standardizedQuestion.translations[0];
        
        if (!sourceTranslation) {
          throw new Error(`No source translation found for question ${standardizedQuestion.uuid}`);
        }

        // Keep existing translations
        const existingTranslations = standardizedQuestion.translations;

        // Translate to each target language sequentially
        const newTranslations = [];
        for (const lang of targetLanguages) {
          // Skip if translation already exists
          const existingTrans = existingTranslations.find(t => t.languageCode === lang);
          if (existingTrans) {
            newTranslations.push(existingTrans);
            continue;
          }

          try {
            // Translate question text
            const questionText = await this.translateWithLLM(
              sourceTranslation.questionText,
              lang,
              "This is a quiz question"
            );

            // Wait between translations to respect rate limits
            await this.sleep(2000);

            // Translate options sequentially
            const options = {};
            for (const [key, value] of Object.entries(sourceTranslation.options)) {
              // If the value is numeric or has units, keep it as is
              if (/^-?\d+(\.\d+)?(%|cm|m)?$/.test(value) || /^[A-Za-z0-9]+$/.test(value)) {
                options[key] = value;
              } else {
                options[key] = await this.translateWithLLM(
                  value,
                  lang,
                  "This is a quiz answer option"
                );
              }
              await this.sleep(2000);
            }

            // Translate explanation
            const explanation = await this.translateWithLLM(
              sourceTranslation.explanation,
              lang,
              "This is an explanation for the correct answer"
            );

            newTranslations.push({
              languageCode: lang,
              questionText,
              options,
              correctAnswer: sourceTranslation.correctAnswer,
              explanation
            });

            // Wait between languages to respect rate limits
            await this.sleep(5000);
          } catch (error) {
            if (error.status === 429) {
              console.log(`Rate limited, waiting 60 seconds before continuing...`);
              await this.sleep(60000);
              i--; // Retry this question
              continue;
            }
            throw error;
          }
        }

        // Update question with all translations
        standardizedQuestion.translations = newTranslations;
        translatedQuestions.push(standardizedQuestion);

        // Wait between questions to respect rate limits
        if (i < questionsData.length - 1) {
          await this.sleep(5000);
        }
      }

      // Prepare API payload
      const payload = {
        quizUuid,
        questions: translatedQuestions
      };

      // Log the payload for debugging
      console.log('\n=== API Request Payload ===');
      console.log('Quiz UUID:', quizUuid);
      console.log('Number of questions:', translatedQuestions.length);
      console.log('First question sample:');
      if (translatedQuestions[0]) {
        console.log('- UUID:', translatedQuestions[0].uuid);
        console.log('- Type:', translatedQuestions[0].questionType);
        console.log('- Number of translations:', translatedQuestions[0].translations.length);
        console.log('- Languages:', translatedQuestions[0].translations.map(t => t.languageCode).join(', '));
        console.log('- First translation:');
        if (translatedQuestions[0].translations[0]) {
          const trans = translatedQuestions[0].translations[0];
          console.log('  - Language:', trans.languageCode);
          console.log('  - Question:', trans.questionText);
          console.log('  - Options:', JSON.stringify(trans.options, null, 2));
          console.log('  - Correct Answer:', trans.correctAnswer);
        }
      }
      console.log('\nFull payload:', JSON.stringify(payload, null, 2));
      console.log('=== End API Request Payload ===\n');

      // Send to API
      const updateResponse = await this.client.post("/api/ai/add-quiz-questions", payload);

      if (updateResponse.data?.status !== '00') {
        throw new Error(`Failed to update quiz questions: ${updateResponse.data?.message || 'Unknown error'}`);
      }

      return {
        quizUuid,
        questions: translatedQuestions,
        updatedLanguages: targetLanguages,
        timestamp: new Date().toISOString(),
        response: updateResponse.data
      };
    } catch (error) {
      console.error("Quiz questions translation error:", error);
      throw new Error(`Failed to translate quiz questions: ${error.message}`);
    }
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
              correctAnswer: correctAnswer,
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
              correctAnswer: Array.isArray(q.correctAnswer) ? q.correctAnswer[0] : q.correctAnswer,
              explanation: q.explanation || "No explanation provided"
            }]
          }));
          
          if (!questions || questions.length === 0) {
            throw new Error("No questions could be extracted from the document");
          }

          console.log(`Using ${questions.length} pre-extracted questions`);

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
          correctAnswer: q.correctAnswer,
          explanation: q.explanation
        }]
      }));

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
  

      // Send to API
      const updateResponse = await this.client.post("/api/ai/add-quiz-questions", payload);

      if (updateResponse.data?.status !== '00') {
        throw new Error(`Failed to add quiz questions: ${updateResponse.data?.message || 'Unknown error'}`);
      }

      return {
        quizUuid,
        questions,
        timestamp: new Date().toISOString(),
        response: updateResponse.data
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
        const quizResponse = await this.client.get(`/api/ai/quiz/${quizUuid}`);
        
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
          correctAnswer,
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
}

export default new TranslationService();
