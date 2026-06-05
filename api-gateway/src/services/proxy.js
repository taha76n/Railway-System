import axios from "axios";
import { config } from "../configs/index.js";
import { GatewayTimeoutError, NotFoundError, ServiceUnavailableError } from "../utils/error.js";
import { logger } from "../configs/logger.js";

/**
 * Circuit Breaker implementation
 * Prevents cascading failures when downstream services are down
 */

class CircuitBreaker {
  constructor(
    serviceName,
    threshold = config.CIRCUIT_BREAKER_THRESHOLD,
    timeout = config.CIRCUIT_BREAKER_TIMEOUT
  ) {
    this.serviceName = serviceName;
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = "CLOSED";
    this.nextAttempt = Date.now();
  }

  async execute(request) {
    if (this.state === "OPEN") {
      if (Date.now() < this.nextAttempt) {
        throw new ServiceUnavailableError(
          `Service ${this.serviceName} is temporarily unavailable. Circuit breaker is OPEN.`
        );
      }
      this.state = "HALF_OPEN";
      logger.info(
        `Circuit Breaker is HALF_OPEN for service ${this.serviceName}`
      );
    }
    try {
      const response = await request();
      this.onSuccess();
      return response;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
      logger.info(`Circuit Breaker Closed for service ${this.serviceName}`);
    }
  }

  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.timeout;
      logger.info(
        `Circuit Breaker is OPEN for service ${
          this.serviceName
        }. Next attempt at ${new Date(this.nextAttempt).toISOString()}`
      );
    }
  }

  getState() {
    return {
      service: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt:
        this.state === "OPEN" ? new Date(this.nextAttempt).toISOString() : null,
    };
  }
}

//Circuit breakers for each service
const circuitBreakers = {
  userService: new CircuitBreaker("user-service"),
  adminService: new CircuitBreaker("admin-service"),
};


/**
 * Forward request to downstream service
 */

async function forwardRequest(
  serviceUrl,
  path,
  method,
  data,
  headers,
  circuitBreaker
) {
  const url = `${serviceUrl}${path}`;
  logger.info(url);

  const requestConfig = {
    method,
    url,
    timeout: config.SERVICE_TIMEOUT_MS,
    headers: {
      ...headers,
      'x-internal-service-key': config.INTERNAL_SERVICE_KEY,
      host: undefined,
      "content-length": undefined,
    },

    validateStatus: () => true,
    maxRedirects: 5,
  };

  // if (method !== "GET" && method !== "POST" && data) {
  //   requestConfig.data = data;
  // }

  // if ((method === "GET" || method === "POST") && data) {
  //   requestConfig.params = data;
  // }

  if (method !== "GET" && data) {
    requestConfig.data = data;
  }
  
  if (method === "GET" && data) {
    requestConfig.params = data;
  }

  logger.debug(`Forwarding request ${method} ${url}`, {
    headers: requestConfig.headers,
    hasData: !!data,
    timeout: config.SERVICE_TIMEOUT_MS,
  });

  try {
    logger.info(`[Proxy] Calling ${method} ${url}`);
    const response = await circuitBreaker.execute(() => axios(requestConfig));

    logger.debug(`Response from ${url}:`, {
      status: response.status,
      statusText: response.statusText,
    });

    return {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };
  } catch (err) {
    logger.error(`Error forwarding to ${serviceUrl}:`, {
      message: err.message,
      code: err.code,
      url: url,
      method: method,
      timeout: config.SERVICE_TIMEOUT_MS,
    });

    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      throw new GatewayTimeoutError(
        `Request to ${serviceUrl} timed out after ${config.SERVICE_TIMEOUT_MS}ms`
      );
    }

    if (err.code === "ECONNREFUSED") {
      throw new ServiceUnavailableError(
        `Cannot connect to ${serviceUrl}. Service may be down.`
      );
    }

    if (err.response) {
      logger.error(`Service error from ${serviceUrl}:`, {
        status: err.response.status,
        data: err.response.data,
      });

      return {
        status: err.response.status,
        data: err.response.data,
        headers: err.response.headers,
      };
    }

    logger.error(`Network error while calling ${serviceUrl}:`, err.message);
    throw new ServiceUnavailableError(
      `Service temporarily unavailable: ${err.message}`
    );
  }
}


/**
 * Proxy middleware factory
 */

function createProxy(serviceName, serviceUrl) {
  const circuitBreaker = circuitBreakers[serviceName];

  if (!circuitBreaker) {
    throw new NotFoundError(`No circuit breaker found for service: ${serviceName}`);
  }

  return async (req, res, next) => {
    try {
      logger.info(req.path);
      // Extract path (remove /api prefix only)
      // Gateway: /api/users/auth/login -> Service: /auth/login
      // Gateway: /api/users/user/profile -> Service: /user/profile
      const pathParts = req.path.split("/").filter(Boolean);
      logger.info(pathParts);
      // Remove 'users' (first part), keep the rest
      // ['users', 'auth', 'login'] -> ['auth', 'login'] -> '/auth/login'

      const servicePath = "/" + pathParts.slice(1).join("/");
      logger.info(servicePath);

      const result = await forwardRequest(
        serviceUrl,
        servicePath + (req.url.includes("?")
          ? req.url.substring(req.url.indexOf("?"))
          : ""),
        req.method,
        req.body,
        req.headers,
        circuitBreaker
      );

      // Forward response headers except some
      const excludeHeaders = [
        "connection",
        "keep-alive",
        "transfer-encoding",
        "host",
      ];
      Object.keys(result.headers).forEach((keys) => {
        if (!excludeHeaders.includes(keys.toLowerCase())) {
          res.setHeader(keys, result.headers[keys]);
        }
      });

      res.status(result.status).json(result.data);
    } catch (error) {
      next(error);
    }
  };
}


/**
 * Health check endpoint for circuit breakers
 */

function circuitBreakerStatus () {
  return Object.values(circuitBreakers).map((cb) => 
    cb.getState()
  )
}

export {
  createProxy,
  circuitBreakers,
  CircuitBreaker,
  circuitBreakerStatus
}
