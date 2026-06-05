import mongoose from "mongoose";
import logger from "../configs/logger.js";

/**
 * Retry an async function when MongoDB throws a transient transaction error.
 *
 * @param {Function} fn - The async function to execute.
 * @param {number} maxRetries - Maximum number of attempts (default 3).
 * @returns {Promise<any>} - The return value of `fn`.
 */
const retryTransaction = async (fn, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Execute the transactional function (which should manage its own session)
      return await fn();
    } catch (error) {
      // Determine if the error is a transient MongoDB transaction error.
      // MongoServerError with error label 'TransientTransactionError' or
      // 'UnknownTransactionCommitResult' indicates the transaction can be retried.
      const isRetryable =
        error instanceof mongoose.mongo.MongoServerError &&
        (error.hasErrorLabel("TransientTransactionError") ||
          error.hasErrorLabel("UnknownTransactionCommitResult"));

      // If the error is retryable and we still have attempts left, wait and retry
      if (isRetryable && attempt < maxRetries) {
        const delayMs = 50 * attempt; // linear backoff
        console.warn(
          `Transaction attempt ${attempt} failed (retryable), retrying in ${delayMs}ms...`
        );
        logger.warn(
          `Transaction attempt ${attempt} failed (retryable), retrying in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // Otherwise, re-throw the error (non-retryable or no attempts left)
      throw error;
    }
  }
};

export { retryTransaction };
