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
    },
    {
      uuid: "question-789",
      questionType: "multiple-choice",
      difficulty: "medium",
      points: 1,
      translations: [
        {
          languageCode: "en",
          questionText: "Which of the following are prime numbers?",
          options: {
            first: "15",
            second: "17",
            third: "19",
            fourth: "21",
            fifth: "23"
          },
          correctAnswer: "second,third,fifth",
          explanation: "Prime numbers are numbers that have exactly two factors: 1 and themselves. 17, 19, and 23 are prime numbers."
        }
      ]
    }
  ]
};

async function testTranslationFlow() {
  console.log("\n=== Starting Translation Service Test ===\n");

  try {
    // 1. Test Category Translation
    console.log("1. Testing Category Translation");
    const categoryData = {
      categoryUuid: "category-123",
      name: "Mathematics",
      description: "Advanced mathematical concepts and problem solving"
    };
    console.log("\nInput Category Data:", JSON.stringify(categoryData, null, 2));

    const categoryTranslations = await translationService.translateCategory(
      categoryData.categoryUuid,
      ["fr", "es"]
    );
    console.log("\nCategory Translation Result:", JSON.stringify(categoryTranslations, null, 2));

    // 2. Test Course Translation
    console.log("\n2. Testing Course Translation");
    const courseData = {
      courseUuid: "course-123",
      title: "Advanced Algebra",
      description: "Master algebraic equations and functions",
      level: "intermediate",
      duration: 90
    };
    console.log("\nInput Course Data:", JSON.stringify(courseData, null, 2));

    const courseTranslations = await translationService.translateCourse(
      courseData.courseUuid,
      ["fr", "es"],
      courseData
    );
    console.log("\nCourse Translation Result:", JSON.stringify(courseTranslations, null, 2));

    // 3. Test Quiz Translation
    console.log("\n3. Testing Quiz Translation");
    const quizData = {
      quizUuid: "quiz-123",
      title: "Algebraic Expressions",
      description: "Test your knowledge of algebraic expressions and equations"
    };
    console.log("\nInput Quiz Data:", JSON.stringify(quizData, null, 2));

    const quizTranslations = await translationService.translateQuiz(
      quizData.quizUuid,
      ["fr", "es"]
    );
    console.log("\nQuiz Translation Result:", JSON.stringify(quizTranslations, null, 2));

    // 4. Test Questions Translation
    console.log("\n4. Testing Questions Translation");
    console.log("\nInput Questions Data:", JSON.stringify(sampleQuizData, null, 2));

    const questionsTranslations = await translationService.translateQuestions(
      sampleQuizData.quizUuid,
      ["fr", "es"],
      sampleQuizData.questions
    );
    console.log("\nQuestions Translation Result:", JSON.stringify(questionsTranslations, null, 2));

    // 5. Test Question Extraction
    console.log("\n5. Testing Question Extraction");
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
testTranslationFlow(); 