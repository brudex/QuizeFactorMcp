import translationService from '../services/translationService.js';

const sampleQuizData = {
  quizUuid: "quiz-123",
  questions: [
    {
      uuid: "question-456",
      questionType: "single-choice",
      difficulty: "hard",
      points: 2,
      translations: [
        {
          languageCode: "en",
          questionText: "What is the result of 2x + 3 when x = 5?",
          options: {
            first: "10",
            second: "13",
            third: "15",
            fourth: "12",
            fifth: "14"
          },
          correctAnswer: "second",
          explanation: "To solve this, substitute x = 5 into 2x + 3: 2(5) + 3 = 10 + 3 = 13"
        }
      ]
    }
  ]
};

async function testTranslationService() {
  console.log("\n=== Starting Translation Service Test ===\n");

  try {
    // Test Questions Translation
    console.log("Testing Questions Translation");
    console.log("\nInput Questions Data:", JSON.stringify(sampleQuizData, null, 2));

    const questionsTranslations = await translationService.translateQuestions(
      sampleQuizData.quizUuid,
      ["fr", "es"],
      sampleQuizData.questions
    );
    console.log("\nQuestions Translation Result:", JSON.stringify(questionsTranslations, null, 2));

    // Test Question Extraction
    console.log("\nTesting Question Extraction");
    const contentToExtract = `
    Question: What is the derivative of x² + 3x + 2?
    Options:
    A) 2x + 3
    B) x² + 3
    C) 2x
    D) 3x + 2
    Correct Answer: A
    Explanation: The derivative of x² is 2x, and the derivative of 3x is 3. The derivative of a constant (2) is 0.
    `;
    console.log("\nContent to Extract:", contentToExtract);

    const extractedQuestions = await translationService.extractAndAddQuestions(
      sampleQuizData.quizUuid,
      contentToExtract
    );
    console.log("\nExtracted Questions Result:", JSON.stringify(extractedQuestions, null, 2));

    console.log("\n=== Translation Service Test Completed Successfully ===\n");
  } catch (error) {
    console.error("\n=== Translation Service Test Failed ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Run the test
testTranslationService(); 