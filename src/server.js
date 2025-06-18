import mongoose from 'mongoose';
import app from './app.js';
import { config } from './config/config.js';
import fs from 'fs/promises';
import path from 'path';

// Create required directories
async function createRequiredDirectories() {
  try {
    await fs.mkdir(config.server.uploadDir, { recursive: true });
    await fs.mkdir(config.server.reportDir, { recursive: true });
    console.log('Required directories created successfully');
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

// Initialize application
async function initialize() {
  await createRequiredDirectories();

  // Connect to MongoDB
  try {
    await mongoose.connect('mongodb://localhost:27017/qiuzellm');
    console.log('Connected to MongoDB');

    // Start server
    const PORT = config.server.port;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${config.server.environment}`);
    });
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

initialize().catch(error => {
  console.error('Initialization error:', error);
  process.exit(1);
});
