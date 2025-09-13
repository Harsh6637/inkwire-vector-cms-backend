import { Router } from 'express';
import { createResource, getResources, deleteResource  } from '../controllers/resourceController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticate, createResource);
router.get('/', authenticate, getResources);
router.delete('/:id', authenticate, deleteResource);

export default router;
