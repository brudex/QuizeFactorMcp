# Translation and Question Extraction API

This API provides endpoints for translating educational content (categories, courses, quizzes, and questions) and extracting questions from various document formats.

## Features

- Content Translation:
  - Categories (names and descriptions)
  - Courses (titles and descriptions)
  - Quizzes (titles, descriptions, and questions)
  - Individual questions
- Question Extraction:
  - Extract questions from uploaded documents
  - Process and translate extracted questions
  - Add questions to existing quizzes

## API Endpoints

### Translation Endpoints

1. **Translate Category**
```http
POST /api/translate/category/:categoryUuid
```
Translates a category's content to specified languages.

2. **Translate Course**
```http
POST /api/translate/course/:courseUuid
```
Translates a course's content to specified languages.

3. **Translate Quiz**
```http
POST /api/translate/quiz/:quizUuid
```
Translates a quiz's title and description to specified languages.

### Question Extraction Endpoint

```http
POST /api/translate/quiz/:quizUuid/extract
```
Extracts questions from uploaded documents and adds them to a specified quiz.

## Request Format

### Translation Requests

All translation endpoints accept the following request body format:

```json
{
  "targetLanguages": ["es", "fr"],  // Array of target language codes
  "preserveExisting": true          // Optional: preserve existing translations
}
```

### File Upload Request

For question extraction, use multipart/form-data with the following field:
- `document`: The file to be processed (PDF, DOCX, etc.)

## Response Format

### Success Response

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
      "uuid": "content-uuid",
      "type": "quiz|course|category|question"
    }
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error Type",
  "message": "Detailed error message"
}
```

## Error Codes

- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Server Error

## Usage Examples

### Translate a Quiz

```bash
curl -X POST http://your-api-url/quiz/123e4567-e89b-12d3-a456-426614174000 \
  -H "Content-Type: application/json" \
  -d '{
    "targetLanguages": ["es", "fr"],
    "preserveExisting": true
  }'
```

### Extract Questions from Document

```bash
curl -X POST http://your-api-url/quiz/123e4567-e89b-12d3-a456-426614174000/extract \
  -F "document=@/path/to/your/questions.pdf"
```

## Best Practices

1. **Language Codes**
   - Use standard ISO language codes (e.g., "en", "es", "fr")
   - Ensure target languages don't include the source language

2. **File Upload**
   - Supported formats: PDF, DOCX, etc.
   - Ensure files are properly formatted for question extraction
   - Keep file sizes reasonable

3. **Error Handling**
   - Always check response status codes
   - Implement proper error handling in your client code
   - Handle timeouts for large files or batch operations

## Security Considerations

- API requires authentication
- File uploads are validated and sanitized
- Rate limiting is implemented
- Maximum file size restrictions apply

## Support

For additional support or to report issues, please contact the development team or create an issue in the repository.
