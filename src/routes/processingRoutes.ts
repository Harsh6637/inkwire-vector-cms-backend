import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware';
import {
  processChunks,
  processAllPending,
  getProcessingStatus
} from '../controllers/processingController';

const router = Router();

// Process chunks for specific resource
router.post('/process/:id', authenticate, processChunks);

// Process all pending resources
router.post('/process-all', authenticate, processAllPending);

// Get processing status
router.get('/status/:id', authenticate, getProcessingStatus);

export default router;