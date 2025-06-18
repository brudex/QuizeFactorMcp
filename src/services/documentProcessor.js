import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';
import EPub from 'epub';
import fs from 'fs/promises';
import path from 'path';
import ragExtraction from './ragExtraction.js';
import { v4 as uuidv4 } from 'uuid';

class DocumentProcessor {
  async processPDF(filePath) {
    try {
      console.log("Processing PDF file:", filePath);
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      console.log("PDF text length:", data.text.length);
      console.log("First 200 characters:", data.text.substring(0, 200));
      return this.extractQuestions(data.text);
    } catch (error) {
      console.error("PDF processing error:", error);
      throw new Error(`Failed to process PDF: ${error.message}`);
    }
  }

  // Custom renderer to preserve formatting
  renderPage(pageData) {
    let render_options = {
      normalizeWhitespace: false,
      disableCombineTextItems: false
    };
    return pageData.getTextContent(render_options)
      .then(function(textContent) {
        let lastY, text = '';
        for (let item of textContent.items) {
          if (lastY == item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += '\n' + item.str;
          }
          lastY = item.transform[5];
        }
        return text;
      });
  }

  async processDOC(filePath) {
    try {
      console.log("Processing DOC file:", filePath);
      const result = await mammoth.extractRawText({ path: filePath });
      console.log("DOC text length:", result.value.length);
      console.log("First 200 characters:", result.value.substring(0, 200));
      return this.extractQuestions(result.value);
    } catch (error) {
      console.error("DOC processing error:", error);
      throw new Error(`Failed to process DOC: ${error.message}`);
    }
  }

  async processEPUB(filePath) {
    return new Promise((resolve, reject) => {
      const epub = new EPub(filePath);
      epub.on('end', async () => {
        try {
          let content = '';
          for (let i = 0; i < epub.flow.length; i++) {
            const chapter = await this.getEpubChapter(epub, epub.flow[i].id);
            content += chapter + '\n';
          }
          resolve(this.extractQuestions(content));
        } catch (error) {
          reject(new Error(`Failed to process EPUB: ${error.message}`));
        }
      });
      epub.parse();
    });
  }

  getEpubChapter(epub, chapterId) {
    return new Promise((resolve, reject) => {
      epub.getChapter(chapterId, (error, text) => {
        if (error) reject(error);
        else resolve(text.replace(/<[^>]+>/g, ''));
      });
    });
  }

  extractQuestions(text) {
    console.log("Starting question extraction");
    const questions = [];
    
    // Clean up text first
    text = text.replace(/\r\n/g, '\n')  // Normalize line endings
             .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks
             .trim();
    
    console.log("Cleaned text length:", text.length);
    
    // Split text into question blocks
    const questionBlocks = text.split(/(?=(?:Question\s*\d+:|Q\d+:|\n\d+\.))/i)
      .filter(block => block.trim().length > 0);
    
    console.log("Found question blocks:", questionBlocks.length);

    for (let i = 0; i < questionBlocks.length; i++) {
      const block = questionBlocks[i].trim();
      if (!block) continue;

      try {
        console.log(`Processing block ${i}, length: ${block.length}`);
        console.log("Block preview:", block.substring(0, 100));
        
        const questionData = this.parseQuestionContent(block);
        if (questionData) {
          console.log("Successfully parsed question:", questionData.question.substring(0, 50));
          questions.push({
            uuid: uuidv4(),
            content: questionData.question,
            options: questionData.options,
            explanation: questionData.explanation,
            metadata: {
              difficulty: this.assessDifficulty(questionData),
              points: this.calculatePoints(questionData)
            }
          });
        }
      } catch (error) {
        console.warn(`Failed to parse question block ${i}:`, error);
      }
    }

    console.log(`Total questions found: ${questions.length}`);
    return questions;
  }

  looksLikeQuestion(text) {
    // Check if the text looks like a question
    const questionIndicators = [
      /\?$/m,  // Ends with question mark
      /what|when|where|why|how|which/i,  // Question words
      /choose|select|pick|identify/i,  // Selection words
      /\b[A-D]\)/,  // Has A) B) C) D) options
      /\boptions?\b/i,  // Contains "option" or "options"
      /\bcorrect\s+answer\b/i,  // Contains "correct answer"
      /\bexplanation\b/i,  // Contains "explanation"
      /\b(?:true|false)\b/i,  // True/False questions
      /\bmultiple\s+choice\b/i  // Multiple choice indicator
    ];

    const matches = questionIndicators.filter(pattern => pattern.test(text));
    console.log("Question indicators found:", matches.length);
    return matches.length >= 2; // Require at least 2 indicators
  }

  parseQuestionContent(section) {
    console.log("Parsing question content");
    
    // Split into lines and clean up
    const lines = section.split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    
    console.log("Number of lines:", lines.length);
    
    let questionText = '';
    let options = [];
    let explanation = '';
    let currentOption = null;

    // More flexible patterns
    const questionPattern = /^(?:Question\s*\d+:|Q\d+:|[\d]+\.)\s*(.+)/i;
    const optionPattern = /^(?:[A-E][\.\)]|\([A-E]\)|\b(?:option|choice)\s+[A-E])\s*(.+)/i;
    const answerPattern = /^(?:Answer|Correct Answer|Solution)[\s:\.\)]+([A-E](?:\s*,\s*[A-E])*)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      console.log("Processing line:", line.substring(0, 50));

      // Try to match question
      const questionMatch = line.match(questionPattern);
      if (questionMatch) {
        questionText = questionMatch[1].trim();
        continue;
      }

      // Try to match option
      const optionMatch = line.match(optionPattern);
      if (optionMatch) {
        const optionLetter = line.match(/[A-E]/)[0];
        const optionText = optionMatch[1].trim();
        options.push({
          text: optionText,
          isCorrect: false,
          letter: optionLetter
        });
        currentOption = options[options.length - 1];
        continue;
      }

      // Try to match answer
      const answerMatch = line.match(answerPattern);
      if (answerMatch) {
        const correctAnswers = answerMatch[1].split(',')
          .map(a => a.trim().toUpperCase())
          .filter(a => /^[A-E]$/.test(a));
        
        // Mark correct options
        correctAnswers.forEach(letter => {
          const option = options.find(o => o.letter === letter);
          if (option) {
            option.isCorrect = true;
          }
        });
        continue;
      }

      // Check for explanation
      if (line.toLowerCase().startsWith('explanation:')) {
        explanation = line.substring('explanation:'.length).trim();
        continue;
      }

      // If we're in the middle of an option, append to it
      if (currentOption && !optionPattern.test(line) && !answerPattern.test(line)) {
        currentOption.text += ' ' + line;
      }
    }

    // Clean up the options
    options = options.map(opt => ({
      text: opt.text.replace(/\(correct\)/i, '').trim(),
      isCorrect: opt.isCorrect
    }));

    // Ensure we have the minimum required data
    if (!questionText || options.length === 0) {
      console.log("Missing required data - Question:", !!questionText, "Options:", options.length);
      return null;
    }

    // If no correct answer was marked, default to first option
    if (!options.some(opt => opt.isCorrect)) {
      options[0].isCorrect = true;
    }

    console.log("Successfully parsed question content");
    return {
      question: questionText,
      options: options,
      explanation: explanation || "No explanation provided."
    };
  }

  parseQuestionSection(section) {
    // First try to split by explicit markers
    const parts = section.split(/(?:Options|Choices|Explanation):/i);
    
    if (parts.length >= 2) {
      // We found explicit markers
      const question = parts[0].trim();
      const optionsPart = parts[1]?.trim();
      const explanation = parts[2]?.trim() || "No explanation provided.";

      // Parse options
      const options = this.parseOptions(optionsPart, section);

      return {
        question,
        options,
        explanation
      };
    }

    // If explicit markers didn't work, try content-based parsing
    return this.parseQuestionContent(section);
  }

  parseOptions(optionsPart, fullText) {
    const options = [];
    if (!optionsPart) return options;

    // Try different option patterns
    const patterns = [
      /([A-E])\)\s*(.+?)(?=(?:[A-E]\)|$))/g,
      /([A-E])[\.\)]\s*(.+?)(?=(?:[A-E][\.\)]|$))/g,
      /Option\s+([A-E])\s*[:\.]\s*(.+?)(?=(?:Option\s+[A-E]|$))/gi
    ];

    for (const pattern of patterns) {
      let matches = [...optionsPart.matchAll(pattern)];
      if (matches.length > 0) {
        matches.forEach(match => {
          const [, letter, text] = match;
          const isCorrect = text.toLowerCase().includes('(correct)') || 
                           fullText.toLowerCase().includes(`correct answer: ${letter}`) ||
                           fullText.toLowerCase().includes(`answer: ${letter}`);
          
          options.push({
            text: text.replace(/\(correct\)/i, '').trim(),
            isCorrect: isCorrect
          });
        });
        break; // Use first successful pattern
      }
    }

    // If no options found, try line-by-line parsing
    if (options.length === 0) {
      const lines = optionsPart.split('\n');
      lines.forEach(line => {
        const match = line.trim().match(/^([A-E])[\.\)]\s*(.+)$/);
        if (match) {
          const [, letter, text] = match;
          const isCorrect = text.toLowerCase().includes('(correct)') || 
                           fullText.toLowerCase().includes(`correct answer: ${letter}`) ||
                           fullText.toLowerCase().includes(`answer: ${letter}`);
          
          options.push({
            text: text.replace(/\(correct\)/i, '').trim(),
            isCorrect: isCorrect
          });
        }
      });
    }

    // Ensure at least one option is marked as correct
    if (!options.some(opt => opt.isCorrect) && options.length > 0) {
      options[0].isCorrect = true; // Default to first option
    }

    return options;
  }

  assessDifficulty(questionData) {
    // Implement difficulty assessment logic
    return "medium";
  }

  calculatePoints(questionData) {
    // Implement points calculation logic
    return 1;
  }
}

export default new DocumentProcessor(); 