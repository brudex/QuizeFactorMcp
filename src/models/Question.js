import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    trim: true
  },
  options: [{
    text: String,
    isCorrect: Boolean
  }],
  answer: {
    type: String,
    default: ''
  },
  explanation: {
    type: String,
    default: ''
  },
  sourceDocument: {
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    path: {
      type: String,
      required: true
    }
  },
  metadata: {
    page: Number,
    section: String,
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium'
    }
  },
  tags: [String],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

questionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Question = mongoose.model('Question', questionSchema);

export default Question; 