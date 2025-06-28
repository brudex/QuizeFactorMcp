# Translation Queue System

The translation system now uses a queue-based approach instead of processing requests immediately. This provides better control, prevents system overload, and offers excellent progress tracking.

## What Changed

### Before (Immediate Processing)
- Requests were processed immediately in the background
- No way to track progress or check status
- Multiple concurrent requests could overwhelm the system
- Rate limit issues were harder to manage

### After (Queue System)
- All translation requests are queued for processing
- Full status tracking and progress monitoring
- One translation at a time to avoid rate limits
- Cancellation support for queued requests
- Comprehensive logging and time estimates

## API Endpoints

### 1. Submit Translation Requests

All translation endpoints now return queue information instead of processing immediately:

#### Category Translation
```bash
POST /api/translation/category/{categoryUuid}
Body: { "priority": "normal" } # optional: "normal" or "high"
```

#### Course Translation
```bash
POST /api/translation/course/{courseUuid}
Body: { "priority": "normal" } # optional
```

#### Quiz Translation
```bash
POST /api/translation/quiz/{quizUuid}
Body: { "priority": "normal" } # optional
```

#### Questions Translation
```bash
POST /api/translation/questions/{quizUuid}
Body: {
  "targetLanguages": ["es", "fr", "de"],
  "questions": [...],
  "priority": "normal" # optional
}
```

### 2. Check Translation Status

#### Individual Request Status
```bash
GET /api/translation/status/{queueId}
```

#### Overall Queue Status
```bash
GET /api/translation/queue-status
```

### 3. Cancel Requests

```bash
DELETE /api/translation/cancel/{queueId}
```

## Benefits

1. **Better Control**: Queue prevents system overload
2. **Progress Tracking**: Real-time status and progress updates
3. **Rate Limit Handling**: Automatic detection and adaptive responses
4. **Reliability**: Failed requests are tracked and logged
5. **User Experience**: Clear time estimates and queue positions
6. **System Stability**: Controlled processing prevents crashes

## Queue Features

- **Priority System**: Normal and high priority requests
- **Automatic Rate Limit Management**: Adaptive delays and backoff
- **Progress Monitoring**: Real-time updates with percentages
- **Human-Readable Logging**: Clear status messages with emojis
- **Automatic Cleanup**: Old records removed after 1 hour
- **Cancellation Support**: Cancel queued requests before processing 