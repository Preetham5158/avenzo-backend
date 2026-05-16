"use strict";
/**
 * Wraps an async route handler so rejected promises forward to Express error middleware.
 */
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
