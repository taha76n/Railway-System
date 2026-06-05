import { UnauthorizedError } from '../utils/error.js';

/**
 * Extract user context from gateway headers
 * Gateway sets x-user-id after JWT verification(We have discussed this in video)
*/
function getUserContext(req, res, next) {
     const userId = req.headers['x-user-id'];

     console.log('getUserContext - req.params before:', req.params);
// ... existing code
console.log('getUserContext - req.params after:', req.params);

     if (!userId) {
          return next(
               new UnauthorizedError('User context missing - must come through gateway')
          );
     }

     req.user = { id: userId };
     next();
}

export default getUserContext;