import { config } from "../config/config.js";
import llmService from "./llmService.js";

class RAGExtraction {
  constructor() {
    // No need to initialize LLM clients here anymore
  }

  async extractQuestions(text) {
    // Split text into manageable chunks (roughly 4000 tokens each)
    const chunks = this.splitIntoChunks(text, 4000);
    let allQuestions = [];
    let errors = [];

    console.log(`Split text into ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      try {
        console.log(`Processing chunk ${i + 1}/${chunks.length} (approximate size: ${Math.ceil(chunks[i].length / 4)} tokens)`);
        const questions = await this.processChunk(chunks[i]);
        console.log(`Found ${questions.length} questions in chunk ${i + 1}`);
        allQuestions = [...allQuestions, ...questions];
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}:`, error);
        errors.push({
          chunk: i + 1,
          error: error.message
        });
        
        // If the error is related to token limits, try splitting the chunk further
        if (error.message.includes('max_tokens')) {
          console.log(`Attempting to split chunk ${i + 1} into smaller pieces`);
          const subChunks = this.splitIntoChunks(chunks[i], 2000);
          for (let j = 0; j < subChunks.length; j++) {
            try {
              console.log(`Processing sub-chunk ${j + 1}/${subChunks.length} of chunk ${i + 1}`);
              const subQuestions = await this.processChunk(subChunks[j]);
              console.log(`Found ${subQuestions.length} questions in sub-chunk ${j + 1}`);
              allQuestions = [...allQuestions, ...subQuestions];
            } catch (subError) {
              console.error(`Error processing sub-chunk ${j + 1} of chunk ${i + 1}:`, subError);
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      console.warn('Errors occurred during extraction:', errors);
    }

    console.log(`Total questions extracted: ${allQuestions.length}`);
    return allQuestions;
  }

  async processChunk(text) {
    const prompt = `You are a question extraction expert. Your task is to analyze text and extract multiple-choice questions into a structured JSON format. Each question must include the question text, options (A, B, C, D), correct answer, and any explanation provided.

Important rules:
1. Extract ALL questions you can find, even if they're not perfectly formatted
2. If a question is missing options or the correct answer, still include it
3. For questions without explicit options, try to identify potential options from the context
4. If no explanation is provided, leave it as an empty string
5. Make sure to preserve any mathematical formulas, special characters, or formatting in the questions

Extract all multiple-choice questions from this text into a JSON array with this structure:
{
  "content": "question text",
  "options": [
    { "text": "option text", "isCorrect": boolean }
  ],
  "answer": "A/B/C/D",
  "explanation": "explanation text",
  "metadata": {
    "confidence": "high/medium/low",
    "hasExplicitOptions": boolean,
    "hasExplicitAnswer": boolean
  }
}

Here's the text to analyze:

${text}

Return only the JSON array, no other text.`;

    try {
      const response = await llmService.processPrompt(prompt, {
        maxTokens: 4096,
        temperature: 0
      });

      return this.parseResponse(response);
    } catch (error) {
      console.error("Error processing chunk with LLM:", error);
      throw error; // Propagate error to handle retry with smaller chunks
    }
  }

  parseResponse(response) {
    try {
      // Clean and extract JSON array from response
      let jsonStr = response;
      
      // Try to find JSON array in the response using regex
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        jsonStr = match[0];
      }

      // Remove any markdown code block syntax
      jsonStr = jsonStr.replace(/```json\s*|\s*```/g, '');
      
      // Remove any non-JSON text before or after the array
      jsonStr = jsonStr.replace(/^[^[]*(\[[\s\S]*\])[^\]]*$/, '$1');
      
      // Fix common JSON formatting issues
      jsonStr = jsonStr
        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
        .replace(/([{,]\s*)"(\w+)"(?=\s*:)/g, '$1"$2"') // Ensure property names are quoted
        .replace(/:\s*'([^']*)'/g, ':"$1"') // Replace single quotes with double quotes
        .replace(/\n\s*\/\/.*/g, '') // Remove any inline comments
        .replace(/\\'/g, "'") // Fix escaped single quotes
        .replace(/\\"/g, '"') // Fix escaped double quotes
        .replace(/\\\\/g, '\\'); // Fix double escaped backslashes

      // Try to parse the cleaned JSON
      let questions = [];
      try {
        questions = JSON.parse(jsonStr);
      } catch (parseError) {
        console.warn("Initial JSON parse failed, attempting to fix common issues:", parseError.message);
        
        // If parsing fails, try more aggressive cleaning
        jsonStr = jsonStr
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Quote all unquoted keys
          .replace(/:\s*([\w-]+)\s*([,}])/g, ':"$1"$2') // Quote all unquoted values
          .replace(/,\s*([}\]])/g, '$1'); // Remove any remaining trailing commas
        
        questions = JSON.parse(jsonStr);
      }
      
      // Validate and normalize questions
      return questions.filter(q => {
        // Must have at least a question
        if (!q || typeof q !== 'object' || !q.content) {
          console.warn("Skipping invalid question object");
          return false;
        }

        try {
          // Normalize the question object
          q.content = q.content.trim();
          
          // Initialize arrays if missing
          if (!Array.isArray(q.options)) {
            console.warn(`Question "${q.content.substring(0, 50)}..." has no options, initializing empty array`);
            q.options = [];
          }

          // Normalize options
          q.options = q.options.map(opt => {
            if (typeof opt === 'string') {
              return { text: opt, isCorrect: false };
            }
            return {
              text: (opt.text || '').trim(),
              isCorrect: !!opt.isCorrect
            };
          });

          // Ensure metadata exists with defaults
          q.metadata = {
            confidence: q.metadata?.confidence || "low",
            hasExplicitOptions: q.options.length > 0,
            hasExplicitAnswer: !!q.answer,
            ...(q.metadata || {})
          };

          // Normalize other fields
          q.answer = (q.answer || '').trim();
          q.explanation = (q.explanation || '').trim();

          return true;
        } catch (error) {
          console.warn(`Error normalizing question: ${error.message}`);
          return false;
        }
      });
    } catch (error) {
      console.error("Error parsing LLM response:", error);
      console.error("Raw response:", response);
      return [];
    }
  }

  splitIntoChunks(text, maxChunkSize = 4000) {
    // First try to split by question markers
    const questionMarkers = [
      /Question\s+\d+/i,
      /Q\d+[\.)]/i,
      /\d+[\.)]\s+/,
      /\n\s*\n/  // Double newline as fallback
    ];

    let chunks = [];
    let currentChunk = "";
    let currentSize = 0;
    
    // Split text into potential question blocks
    const blocks = text.split(/(?=Question\s+\d+|Q\d+[\.)]\s|\n\d+[\.)]\s)/i);
    
    for (const block of blocks) {
      // Rough estimate: 1 token ≈ 4 characters
      const blockSize = Math.ceil(block.length / 4);
      
      if (currentSize + blockSize > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = block;
        currentSize = blockSize;
      } else {
        currentChunk += block;
        currentSize += blockSize;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // If no chunks were created (no question markers found),
    // fall back to word-based splitting
    if (chunks.length === 0) {
      return this.splitByWords(text, maxChunkSize);
    }

    return chunks;
  }

  splitByWords(text, maxChunkSize) {
    const words = text.split(/\s+/);
    const chunks = [];
    let currentChunk = [];
    let currentSize = 0;

    for (const word of words) {
      // Rough estimate: 1 token ≈ 4 characters
      const wordSize = Math.ceil(word.length / 4);
      
      if (currentSize + wordSize > maxChunkSize) {
        chunks.push(currentChunk.join(" "));
        currentChunk = [word];
        currentSize = wordSize;
      } else {
        currentChunk.push(word);
        currentSize += wordSize;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
    }

    return chunks;
  }

  async determineCategory(questions) {
    const prompt = `Analyze these questions and determine the most appropriate academic category. The response should be a JSON object with the following structure:

{
  "name": "Category name (e.g., Mathematics, Physics, Chemistry)",
  "description": "Brief description of the category",
  "type": "academic",
  "tagName": "lowercase tag (e.g., math, physics, chemistry)",
  "confidence": "high/medium/low",
  "reasoning": "Brief explanation of why this category was chosen"
}

Consider:
1. Question content and terminology
2. Types of problems and concepts
3. Subject-specific keywords
4. Mathematical formulas or scientific notation
5. Topic hierarchy (e.g., "Algebra" should be categorized under "Mathematics")

Questions to analyze:
${JSON.stringify(questions, null, 2)}

Return only the JSON object, no other text.`;

    try {
      const response = await llmService.processPrompt(prompt, {
        maxTokens: 1000,
        temperature: 0
      });

      const categoryInfo = JSON.parse(response);
      console.log('Category determined:', categoryInfo);
      return categoryInfo;
    } catch (error) {
      console.error('Error determining category:', error);
      // Return a default category if determination fails
      return {
        name: "General Knowledge",
        description: "General academic questions and concepts",
        type: "academic",
        tagName: "general",
        confidence: "low",
        reasoning: "Default category due to error in determination"
      };
    }
  }
}

export default new RAGExtraction();
