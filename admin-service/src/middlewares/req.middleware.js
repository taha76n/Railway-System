import {logger} from '../configs/logger.js';

const reqLogger = (req, res, next) => {
     logger.debug(`[${req.method}] ${req.originalUrl}`);
     const start = Date.now();

     res.on('finish', () => {
          const duration = Date.now() - start;
          logger.info(
               `[${req.method}] ${req.originalUrl} - status: ${res.statusCode} - ${duration}ms`
          );
     });

     next();
};

export default reqLogger;





