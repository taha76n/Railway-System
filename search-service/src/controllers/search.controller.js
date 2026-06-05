import { searchService } from "../services/search.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { BadRequestError } from "../utils/error.js";

const searchTrains = asyncHandler(async (req, res) => {
  const { to, from, date } = req.query;

  if (!to || !from) {
    throw new BadRequestError("from and to station names/codes are required");
  }

  const results = await searchService.searchTrains(to, from, date || null);

  res.json({ success: true, data: results });
});

const autocomplete = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 2) {
    throw new BadRequestError("Provide atleast two characters");
  }

  const suggestions = await searchService.autocompleteStation(q);

  res.json({ success: true, data: suggestions });
});

const debugStations = asyncHandler(async (req, res) => {
  const data = await searchService.getAllStations();

  res.json({ success: true, count: data.length, data });
});

const debugTrains = asyncHandler(async (req, res) => {
  const data = await searchService.getAllTrains();

  res.json({ success: true, count: data.length, data });
});

export const searchController = {
  searchTrains,
  autocomplete,
  debugTrains,
  debugStations,
};
