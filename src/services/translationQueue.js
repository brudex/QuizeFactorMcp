import { v4 as uuidv4 } from 'uuid';
import { TranslationService } from './translationService.js';

class TranslationQueue {
  constructor() {
    this.queue = [];
    this.processing = new Map(); // Currently processing requests
    this.completed = new Map(); // Completed requests (keep for 1 hour)
    this.failed = new Map(); // Failed requests (keep for 1 hour)
    this.isProcessing = false;
    this.maxConcurrent = 1; // Process one translation at a time to avoid rate limits
    this.currentlyProcessing = 0;
    
    // Clean up completed/failed requests every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
    
    // Start processing queue
    this.startProcessing();
  }

  // Add a translation request to the queue
  addToQueue(type, data, priority = 'normal') {
    const queueId = uuidv4();
    const queueItem = {
      id: queueId,
      type, // 'category', 'course', 'quiz', 'questions'
      data,
      priority,
      status: 'queued',
      createdAt: new Date(),
      estimatedStartTime: this.estimateStartTime(),
      progress: {
        current: 0,
        total: this.estimateTotal(type, data),
        percentage: 0,
        message: 'Waiting in queue...'
      }
    };

    // Insert based on priority (high priority goes first)
    if (priority === 'high') {
      this.queue.unshift(queueItem);
    } else {
      this.queue.push(queueItem);
    }

    // Update estimated start times for all queued items
    this.updateEstimatedTimes();

    console.log(`\n📥 QUEUED TRANSLATION REQUEST`);
    console.log(`🆔 Queue ID: ${queueId}`);
    console.log(`📂 Type: ${type}`);
    console.log(`⚡ Priority: ${priority}`);
    console.log(`📊 Queue position: ${this.getQueuePosition(queueId)} of ${this.queue.length}`);
    console.log(`⏰ Estimated start: ${queueItem.estimatedStartTime.toLocaleTimeString()}`);
    console.log(`📋 Total items in queue: ${this.queue.length}\n`);

    return queueId;
  }

  // Get status of a queued/processing/completed request
  getStatus(queueId) {
    // Check if currently processing
    if (this.processing.has(queueId)) {
      return {
        status: 'processing',
        ...this.processing.get(queueId)
      };
    }

    // Check if completed
    if (this.completed.has(queueId)) {
      return {
        status: 'completed',
        ...this.completed.get(queueId)
      };
    }

    // Check if failed
    if (this.failed.has(queueId)) {
      return {
        status: 'failed',
        ...this.failed.get(queueId)
      };
    }

    // Check if in queue
    const queueItem = this.queue.find(item => item.id === queueId);
    if (queueItem) {
      return {
        status: 'queued',
        queuePosition: this.getQueuePosition(queueId),
        totalInQueue: this.queue.length,
        estimatedStartTime: queueItem.estimatedStartTime,
        estimatedTotal: queueItem.progress.total,
        message: queueItem.progress.message
      };
    }

    return null; // Not found
  }

  // Get current queue status
  getQueueStatus() {
    const queuedItems = this.queue.map(item => ({
      id: item.id,
      type: item.type,
      priority: item.priority,
      createdAt: item.createdAt,
      estimatedStartTime: item.estimatedStartTime,
      estimatedTotal: item.progress.total
    }));

    const processingItems = Array.from(this.processing.values()).map(item => ({
      id: item.id,
      type: item.type,
      progress: item.progress,
      startedAt: item.startedAt
    }));

    return {
      queue: queuedItems,
      processing: processingItems,
      stats: {
        queued: this.queue.length,
        processing: this.processing.size,
        completed: this.completed.size,
        failed: this.failed.size
      }
    };
  }

  // Start processing the queue
  async startProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('🚀 Translation queue processor started');

    while (this.isProcessing) {
      try {
        if (this.currentlyProcessing < this.maxConcurrent && this.queue.length > 0) {
          const item = this.queue.shift();
          this.processItem(item);
        }
        
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Queue processing error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait longer on error
      }
    }
  }

  // Process a single queue item
  async processItem(item) {
    this.currentlyProcessing++;
    
    // Move to processing
    item.status = 'processing';
    item.startedAt = new Date();
    item.progress.message = 'Starting translation...';
    this.processing.set(item.id, item);

    console.log(`\n🔄 STARTING TRANSLATION`);
    console.log(`🆔 Queue ID: ${item.id}`);
    console.log(`📂 Type: ${item.type}`);
    console.log(`🕒 Started at: ${item.startedAt.toLocaleTimeString()}`);

    try {
      let result;
      const translationService = new TranslationService();

      // Update progress callback
      const updateProgress = (current, total, message) => {
        if (this.processing.has(item.id)) {
          const processingItem = this.processing.get(item.id);
          processingItem.progress = {
            current,
            total,
            percentage: total > 0 ? Math.round((current / total) * 100) : 0,
            message
          };
          this.processing.set(item.id, processingItem);
        }
      };

      switch (item.type) {
        case 'category':
          updateProgress(0, 2, 'Translating category...');
          result = await translationService.translateCategory(
            item.data.categoryUuid,
            item.data.targetLanguages
          );
          break;

        case 'course':
          updateProgress(0, 2, 'Translating course...');
          result = await translationService.translateCourse(
            item.data.courseUuid,
            item.data.targetLanguages
          );
          break;

        case 'quiz':
          updateProgress(0, 2, 'Translating quiz...');
          result = await translationService.translateQuiz(
            item.data.quizUuid,
            item.data.targetLanguages
          );
          break;

        case 'questions':
          const totalOperations = item.data.questions.length * item.data.targetLanguages.length;
          updateProgress(0, totalOperations, 'Translating questions...');
          
          result = await translationService.translateQuestions(
            item.data.quizUuid,
            item.data.targetLanguages,
            item.data.questions
          );
          break;

        default:
          throw new Error(`Unknown translation type: ${item.type}`);
      }

      // Mark as completed
      this.processing.delete(item.id);
      this.completed.set(item.id, {
        id: item.id,
        type: item.type,
        status: 'completed',
        result,
        startedAt: item.startedAt,
        completedAt: new Date(),
        duration: Date.now() - item.startedAt.getTime()
      });

      console.log(`\n✅ TRANSLATION COMPLETED`);
      console.log(`🆔 Queue ID: ${item.id}`);
      console.log(`📂 Type: ${item.type}`);
      console.log(`⏱️  Duration: ${Math.round((Date.now() - item.startedAt.getTime()) / 1000)}s`);
      console.log(`🎉 Success!\n`);

    } catch (error) {
      console.error(`\n❌ TRANSLATION FAILED`);
      console.error(`🆔 Queue ID: ${item.id}`);
      console.error(`📂 Type: ${item.type}`);
      console.error(`💥 Error: ${error.message}\n`);

      // Mark as failed
      this.processing.delete(item.id);
      this.failed.set(item.id, {
        id: item.id,
        type: item.type,
        status: 'failed',
        error: error.message,
        startedAt: item.startedAt,
        failedAt: new Date(),
        duration: Date.now() - item.startedAt.getTime()
      });
    } finally {
      this.currentlyProcessing--;
      this.updateEstimatedTimes();
    }
  }

  // Helper methods
  getQueuePosition(queueId) {
    return this.queue.findIndex(item => item.id === queueId) + 1;
  }

  estimateStartTime() {
    // Rough estimate: 2 minutes per item in queue
    const minutesDelay = this.queue.length * 2;
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() + minutesDelay);
    return startTime;
  }

  estimateTotal(type, data) {
    switch (type) {
      case 'category':
      case 'course':
      case 'quiz':
        return 2; // Simple translation
      case 'questions':
        return data.questions ? data.questions.length * data.targetLanguages.length : 10;
      default:
        return 1;
    }
  }

  updateEstimatedTimes() {
    this.queue.forEach((item, index) => {
      const minutesDelay = index * 2; // 2 minutes per preceding item
      const startTime = new Date();
      startTime.setMinutes(startTime.getMinutes() + minutesDelay);
      item.estimatedStartTime = startTime;
    });
  }

  // Cancel a queued request
  cancelRequest(queueId) {
    const index = this.queue.findIndex(item => item.id === queueId);
    if (index !== -1) {
      const cancelledItem = this.queue.splice(index, 1)[0];
      console.log(`❌ CANCELLED TRANSLATION REQUEST`);
      console.log(`🆔 Queue ID: ${queueId}`);
      console.log(`📂 Type: ${cancelledItem.type}`);
      console.log(`📋 Remaining in queue: ${this.queue.length}\n`);
      
      // Update estimated times for remaining items
      this.updateEstimatedTimes();
      return true;
    }
    return false;
  }

  cleanup() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    // Clean up completed requests older than 1 hour
    for (const [id, item] of this.completed.entries()) {
      if (item.completedAt.getTime() < oneHourAgo) {
        this.completed.delete(id);
      }
    }

    // Clean up failed requests older than 1 hour
    for (const [id, item] of this.failed.entries()) {
      if (item.failedAt.getTime() < oneHourAgo) {
        this.failed.delete(id);
      }
    }

    console.log(`🧹 Cleaned up old translation records`);
  }

  // Stop processing (for graceful shutdown)
  stopProcessing() {
    this.isProcessing = false;
    console.log('⏹️  Translation queue processor stopped');
  }
}

// Create singleton instance
const translationQueue = new TranslationQueue();

export default translationQueue; 