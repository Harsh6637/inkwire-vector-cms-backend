import { Router } from 'express';
import { searchResource, searchAllResources, searchAllResourcesGrouped, getDocumentContent } from '../controllers/searchController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

// Search within a specific resource
router.post('/resource/:id', authenticate, searchResource);

// Search across all resources
router.post('/all', authenticate, searchAllResources);

// Enhanced grouped search across all resources
router.post('/grouped', authenticate, searchAllResourcesGrouped);

// Get full document content
router.get('/document/:id', authenticate, getDocumentContent);

// Test endpoints without authentication (for browser testing)

// GET routes for browser address bar testing
router.get('/test/:id/:query', (req, res) => {
  req.body = { query: req.params.query };
  searchResource(req, res);
});

router.get('/test-all/:query', (req, res) => {
  req.body = { query: req.params.query };
  searchAllResources(req, res);
});

router.get('/test-grouped/:query', (req, res) => {
  req.body = { query: req.params.query };
  searchAllResourcesGrouped(req, res);
});

// POST routes for proper API testing
router.post('/test/:id', searchResource);
router.post('/test-all', searchAllResources);
router.post('/test-grouped', searchAllResourcesGrouped);
router.get('/test-document/:id', getDocumentContent);

export default router;