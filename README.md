# QuizeFactor Integration

This project provides functionality to translate questions, quizzes, courses, and categories in the QuizFactor platform, as well as extract and process questions from various document formats.

## Features

- Translate content to multiple languages:
  - Categories
  - Courses
  - Quizzes
  - Individual questions
- Support for multiple languages (e.g., English, Spanish, French)
- Automatic format standardization (A/B/C/D to first/second/third/fourth)
- Extract questions from PDF, DOC/DOCX, and EPUB files
- Save extracted questions to a local database
- Support for multiple LLM providers (Anthropic Claude and OpenAI GPT)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
# Create a .env file with the following variables
PORT=3000
UPLOAD_DIR=./uploads
QUIZ_FACTOR_API_URL=https://quizefactor.cachetechs.com
QUIZ_FACTOR_API_KEY=your_api_key_here

# LLM Configuration
DEFAULT_LLM_PROVIDER=anthropic  # or "openai" (defaults to "anthropic")
ANTHROPIC_API_KEY=your_anthropic_api_key_here  # Required if using Anthropic
ANTHROPIC_MODEL=claude-3-sonnet-20240229  # Optional, defaults to claude-3-sonnet-20240229
OPENAI_API_KEY=your_openai_api_key_here  # Required if using OpenAI
OPENAI_MODEL=gpt-3.5-turbo  # Optional, defaults to gpt-3.5-turbo
```

3. Create required directories:
```bash
mkdir -p uploads test-files
```

4. Start the server:
```bash
npm start
```

## LLM Provider Configuration

The system supports two LLM providers:

1. Anthropic Claude
   - Set `DEFAULT_LLM_PROVIDER=anthropic`
   - Requires `ANTHROPIC_API_KEY`
   - Optional: Set `ANTHROPIC_MODEL` (defaults to claude-3-sonnet-20240229)

2. OpenAI GPT
   - Set `DEFAULT_LLM_PROVIDER=openai`
   - Requires `OPENAI_API_KEY`
   - Optional: Set `OPENAI_MODEL` (defaults to gpt-3.5-turbo)

You can configure both providers and switch between them by changing `DEFAULT_LLM_PROVIDER`. If the default provider is not available, the system will automatically fall back to any available provider.

## Translation API Endpoints

### 1. Translate Category
```
POST /api/translate/category/:categoryUuid
```
Translate a category's name and description to specified languages.

Request body:
```json
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true  // Optional, defaults to true
}
```

### 2. Translate Course
```
POST /api/translate/course/:courseUuid
```
Translate a course's title and description to specified languages.

Request body:
```json
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true
}
```

### 3. Translate Quiz
```
POST /api/translate/quiz/:quizUuid
```
Translate a quiz's title and description to specified languages.

Request body:
```json
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true
}
```

### 4. Translate Quiz Questions
```
POST /api/translate/quiz/:quizUuid/questions
```
Translate all questions in a quiz to specified languages.

Request body:
```json
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true,
  "provider": "openai"  // Optional: specify LLM provider for this request
}
```

### 5. Translate Single Question
```
POST /api/translate/question/:questionUuid
```
Translate a specific question to specified languages.

Request body:
```json
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true
}
```

## Response Format

All translation endpoints return responses in the following format:

```json
{
  "success": true,
  "message": "Translation completed successfully",
  "data": {
    "translations": [
      {
        "languageCode": "es",
        "status": "completed"
      },
      {
        "languageCode": "fr",
        "status": "completed"
      }
    ],
    "originalContent": {
      "uuid": "content-uuid",
      "type": "quiz|course|category|question"
    }
  }
}
```

## Error Handling

The API returns appropriate HTTP status codes:

- 200: Success
- 400: Bad Request (invalid input)
- 401: Unauthorized (invalid API key)
- 404: Not Found (content not found)
- 500: Server Error

Error response format:
```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

## Testing with Postman

1. Set up environment variables in Postman:
```
QUIZ_FACTOR_BASE_URL: https://quizefactor.cachetechs.com
QUIZ_FACTOR_API_KEY: your_api_key_here
```

2. Example requests:

### Translate Quiz Questions
```http
POST {{QUIZ_FACTOR_BASE_URL}}/api/translate/quiz/{{QUIZ_UUID}}/questions
Headers:
- Content-Type: application/json
- Authorization: Bearer {{QUIZ_FACTOR_API_KEY}}

Body:
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true
}
```

### Translate Single Question
```http
POST {{QUIZ_FACTOR_BASE_URL}}/api/translate/question/{{QUESTION_UUID}}
Headers:
- Content-Type: application/json
- Authorization: Bearer {{QUIZ_FACTOR_API_KEY}}

Body:
{
  "targetLanguages": ["es", "fr"],
  "preserveExisting": true
}
```

## Best Practices

1. **Preserving Existing Translations**
   - Set `preserveExisting: true` to keep existing translations
   - Only new or updated translations will be modified

2. **Language Codes**
   - Use standard ISO language codes (e.g., "en", "es", "fr")
   - Ensure target languages don't include source language

3. **Batch Processing**
   - Use quiz-level translation for multiple questions
   - Use individual endpoints for single item updates

4. **Error Handling**
   - Always check response status and error messages
   - Implement proper error handling in your code

## Question Format Standards

The system automatically standardizes question formats:

1. **Option Keys**
   - Input formats accepted:
     - Letter format: A, B, C, D, E
     - Number format: 1, 2, 3, 4, 5
     - Word format: first, second, third, fourth, fifth
   - All outputs use word format (first, second, etc.)

2. **Required Fields**
   - questionText
   - options
   - correctAnswer
   - explanation

## Rate Limiting

- Window: 15 minutes
- Max requests: 100 per window
- Status 429 returned if limit exceeded

## Security

- CORS enabled with configurable origin
- Helmet security headers enabled
- Rate limiting enforced
- API key required for all requests

For more details on the QuizFactor API, refer to the Postman collection: `QuizeFactor_AI_Routes.postman_collection.json`

## API Endpoints

### Upload Document and Extract Questions

```
POST /api/questions/upload
```

Upload a document file (PDF, DOC/DOCX, EPUB) to extract questions. The questions will be saved to the local database.

**Important**: When uploading files, use either `document` or `file` as the field name in your form data.

Example using curl:
```
curl -X POST -F "document=@/path/to/your/file.pdf" http://localhost:3000/api/questions/upload
```

### Upload Document and Send to QuizeFactor

```
POST /api/questions/upload-to-quiz/:quizUuid
```

Upload a document file, extract questions, save them to the local database, and send them to a specific quiz on QuizeFactor.

Example using curl:
```
curl -X POST -F "document=@/path/to/your/file.pdf" http://localhost:3000/api/questions/upload-to-quiz/your-quiz-uuid
```

### Get Questions

```
GET /api/questions
```

Retrieve questions from the local database. Supports pagination, filtering by tags and difficulty.

### Update Question

```
PUT /api/questions/:id
```

Update a question in the local database. If `quizUuid` and `quizQuestionUuid` are provided in the request body, the question will also be updated on QuizeFactor.

### Delete Question

```
DELETE /api/questions/:id
```

Delete a question from the local database.

## Testing File Uploads

A test script is included to help diagnose file upload issues:

1. Place a test file in the `test-files` directory
2. Update the `FILE_PATH` in `test-upload.js` to point to your test file
3. Run the test script:
```
node test-upload.js
```

## QuizeFactor API Integration

The integration with QuizeFactor uses the following endpoints:

- `POST /api/ai/create-quiz`: Create a new quiz on QuizeFactor
- `POST /api/ai/add-quiz-questions`: Add questions to an existing quiz on QuizeFactor
- `POST /api/ai/update-quiz-questions`: Update questions on an existing quiz on QuizeFactor

For more details on the QuizeFactor API, refer to the Postman collection: `QuizeFactor_AI_Routes.postman_collection.json`

## Testing Guide

### Local Testing

1. Start the server locally:
```bash
npm start
```
Your server will be running at `http://localhost:3000` by default.

### Available Test Endpoints

1. **Test Category Translation**
```bash
# Translate a category
curl -X POST http://localhost:3000/api/translate/category/your-category-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es", "fr"],
    "preserveExisting": true
  }'
```

2. **Test Course Translation**
```bash
# Translate a course
curl -X POST http://localhost:3000/api/translate/course/your-course-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es", "fr"],
    "preserveExisting": true
  }'
```

3. **Test Quiz Translation**
```bash
# Translate a quiz title and description
curl -X POST http://localhost:3000/api/translate/quiz/your-quiz-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es", "fr"],
    "preserveExisting": true
  }'
```

4. **Test Quiz Questions Translation**
```bash
# Translate all questions in a quiz
curl -X POST http://localhost:3000/api/translate/quiz/your-quiz-uuid/questions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es", "fr"],
    "preserveExisting": true,
    "questionUuids": ["question-uuid-1", "question-uuid-2"]
  }'
```

5. **Test Single Question Translation**
```bash
# Translate a specific question
curl -X POST http://localhost:3000/api/translate/question/your-question-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es", "fr"],
    "preserveExisting": true
  }'
```

### Example Test Flow

Here's a complete test flow you can follow:

1. **Get an existing quiz with questions**
```bash
# First, get the quiz details
curl -X GET http://localhost:3000/api/translate/quiz/your-quiz-uuid \
  -H "Authorization: Bearer your-api-key"
```

2. **Translate the quiz title and description**
```bash
# Translate quiz metadata
curl -X POST http://localhost:3000/api/translate/quiz/your-quiz-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es"],
    "preserveExisting": true
  }'
```

3. **Translate specific questions**
```bash
# Translate questions
curl -X POST http://localhost:3000/api/translate/quiz/your-quiz-uuid/questions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es"],
    "preserveExisting": true,
    "questionUuids": ["question-uuid-1"]
  }'
```

### Testing with Different Question Formats

1. **Test A/B/C/D Format Translation**
```bash
curl -X POST http://localhost:3000/api/translate/question/your-question-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es"],
    "question": {
      "questionText": "What is the capital of France?",
      "options": {
        "A": "London",
        "B": "Paris",
        "C": "Berlin",
        "D": "Madrid"
      },
      "correctAnswer": "B",
      "explanation": "Paris is the capital of France."
    }
  }'
```

2. **Test Numeric Format Translation**
```bash
curl -X POST http://localhost:3000/api/translate/question/your-question-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "targetLanguages": ["es"],
    "question": {
      "questionText": "What is 2+2?",
      "options": {
        "1": "3",
        "2": "4",
        "3": "5",
        "4": "6"
      },
      "correctAnswer": "2",
      "explanation": "Basic addition: 2+2=4"
    }
  }'
```

### Expected Responses

1. **Successful Translation Response**
```json
{
  "success": true,
  "message": "Translation completed successfully",
  "data": {
    "translations": [
      {
        "languageCode": "es",
        "status": "completed"
      }
    ],
    "originalContent": {
      "uuid": "your-content-uuid",
      "type": "question"
    }
  }
}
```

2. **Error Response (Invalid UUID)**
```json
{
  "success": false,
  "error": "Not Found",
  "message": "Content with UUID 'invalid-uuid' not found"
}
```

3. **Error Response (Invalid API Key)**
```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Invalid API key"
}
```

### Troubleshooting Common Issues

1. **Connection Refused**
   - Ensure the server is running
   - Check the port number
   - Verify localhost URL

2. **Authentication Errors**
   - Verify API key format
   - Check Authorization header
   - Ensure API key is active

3. **Content Not Found**
   - Verify UUID exists
   - Check UUID format
   - Ensure content is accessible

4. **Invalid Request Format**
   - Validate JSON syntax
   - Check required fields
   - Verify language codes

[... rest of existing content ...] 


// Translation routes
router.post('/category/:categoryUuid', translateCategory);
router.post('/course/:courseUuid', translateCourse);
router.post('/quiz/:quizUuid', translateQuiz);
router.post('/quiz/:quizUuid/questions', translateQuestions);

// Question extraction and translation routes
router.post('/quiz/:quizUuid/extract', uploadAny, extractQuestions);