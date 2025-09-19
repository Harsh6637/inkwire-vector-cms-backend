import { Router } from 'express';
import {
createResource,
getResources,
deleteResource,
getResource,
searchResources
} from '../controllers/resourceController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticate, createResource);
router.get('/', authenticate, getResources);
router.get('/search', authenticate, searchResources); // New search endpoint
router.get('/:id', authenticate, getResource);
router.delete('/:id', authenticate, deleteResource);

export default router;