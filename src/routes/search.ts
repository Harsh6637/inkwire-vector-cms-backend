import { Router } from 'express';
import { searchResource } from '../controllers/searchController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.post('/:id', authenticate, searchResource);

export default router;
