import multer from 'multer';
import path from 'path';
import { config } from '../config/config.js';

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.files.upload.uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = config.files.upload.allowedTypes;
  const fileType = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(fileType)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`), false);
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
  next(err);
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