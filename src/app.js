import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { config } from './config/config.js';
import questionRoutes from './routes/questionRoutes.js';
import translationRoutes from './routes/translationRoutes.js';
import fs from 'fs/promises';
import path from 'path';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.security.corsOrigin
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMax
});
app.use(limiter);

// Logging
app.use(morgan('dev'));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload and report directories exist
const createRequiredDirs = async () => {
  try {
    await fs.mkdir(config.server.uploadDir, { recursive: true });
    await fs.mkdir(config.server.reportDir, { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
};
createRequiredDirs();

// Routes
app.use('/api/questions', questionRoutes);
app.use('/api/translate', translationRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message
  });
});

export default app;
