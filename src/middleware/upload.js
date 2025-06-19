import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config/config.js';

// Ensure upload directory exists
const uploadDir = config.files.upload.uploadDir;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Ensure the file has a name
    if (!file.originalname) {
      return cb(new Error('No file name provided'), null);
    }
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Map file extensions to MIME types
const mimeTypeMap = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.epub': 'application/epub+zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain'
};

const fileFilter = (req, file, cb) => {
  // Ensure we have a file with a mimetype
  if (!file || !file.mimetype) {
    return cb(new Error('Invalid file upload'), false);
  }

  const allowedMimeTypes = config.files.upload.allowedTypes;
  const fileExt = path.extname(file.originalname).toLowerCase();
  const fileMimeType = file.mimetype.toLowerCase();
  
  // Check if either the file extension's corresponding MIME type or the actual MIME type is allowed
  const expectedMimeType = mimeTypeMap[fileExt];
  if (allowedMimeTypes.includes(fileMimeType) || (expectedMimeType && allowedMimeTypes.includes(expectedMimeType))) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: config.files.upload.maxSize
  }
});

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        maxSize: config.files.upload.maxSize
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected field',
        message: 'Please use the field name "document" or "file" for the file upload'
      });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ 
      error: err.message,
      allowedTypes: config.files.upload.allowedTypes
    });
  }
  next();
};

// Support multiple field names (document or file)
export const uploadAny = (req, res, next) => {
  const uploadSingle = upload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'file', maxCount: 1 }
  ]);

  uploadSingle(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }

    // Process the file from either field
    if (req.files) {
      if (req.files.document && req.files.document.length > 0) {
        req.file = req.files.document[0];
      } else if (req.files.file && req.files.file.length > 0) {
        req.file = req.files.file[0];
      }
    }
    
    next();
  });
}; 