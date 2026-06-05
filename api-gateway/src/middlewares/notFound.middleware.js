import { NotFoundError } from '../utils/error.js';

function notFound(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
};

export default notFound;