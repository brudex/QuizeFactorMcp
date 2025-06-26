import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Resolve paths relative to project root
const projectRoot = path.resolve(__dirname, "../..");
const resolveProjectPath = (relativePath) => {
  if (relativePath.startsWith("./")) {
    return path.resolve(projectRoot, relativePath.slice(2));
  }
  return relativePath;
};

export const config = {
  server: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || "development",
    uploadDir: resolveProjectPath("./uploads"),
    reportDir: resolveProjectPath("./reports"),
  },

  // LLM Configuration
  llm: {
    defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "anthropic", // can be "anthropic" or "openai"
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-3-sonnet-20240229",
      fallbackModel: "claude-3-5-sonnet-20241022",
      enabled: !!process.env.ANTHROPIC_API_KEY,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      enabled: !!process.env.OPENAI_API_KEY,
    },
  },

  // File Configuration
  files: {
    upload: {
      maxSize: parseInt(process.env.MAX_FILE_SIZE || "10000000", 10), // 10MB
      uploadDir: resolveProjectPath("./uploads"),
      allowedTypes: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/epub+zip",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
        "text/plain"
      ],
    },
  },

  // Document Processing Configuration
  processing: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "10000000", 10), // 10MB
    allowedFileTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/epub+zip",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain"
    ],
  },

  // Security Configuration
  security: {
    corsOrigin: process.env.CORS_ORIGIN || "*",
    rateLimitWindowMs: parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || "900000",
      10
    ), // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100", 10), // limit each IP to 100 requests per windowMs
  },

  // MongoDB Configuration
  mongo: {
    uri: process.env.MONGO_URI || "mongodb://localhost:27017/mcp_llm",
  },

  // QuizFactor Configuration
  api: {
    quizFactor: {
      apiKey: process.env.QUIZFACTOR_API_KEY,
      baseUrl:process.env.QUIZFACTOR_API_URL || "https://quizefactor.cachetechs.com",
    },
  },
};
