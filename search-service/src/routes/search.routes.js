import express from 'express';
import { searchController } from '../controllers/search.controller.js';


const router = express.Router();

// GET /search/trains?from=Delhi&to=Mumbai&date=2025-07-15
router.get('/trains', searchController.searchTrains);

// GET /search/autocomplete?q=del
router.get('/autocomplete', searchController.autocomplete);

// Debug endpoints
router.get('/debug/stations', searchController.debugStations);
router.get('/debug/trains', searchController.debugTrains);

export default router;