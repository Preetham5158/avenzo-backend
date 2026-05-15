import logger from "../lib/logger.js";

// Consistent error response format: {success: false, error: {code, message}}
export function errorMiddleware(err, req, res, next) {
  const requestId = req.requestId;
  const status = err.status || err.statusCode || 500;

  // Log 5xx as errors, 4xx as warnings
  if (status >= 500) {
    logger.error({ err, requestId, path: req.path, method: req.method }, "Internal server error");
  } else if (status >= 400) {
    logger.warn({ err: err.message, requestId, path: req.path, method: req.method, status }, "Client error");
  }

  // Never expose stack traces or internal details to clients
  const isProd = process.env.NODE_ENV === "production";
  res.status(status).json({
    success: false,
    error: {
      code: err.code || httpStatusCode(status),
      message: status < 500 ? (err.message || "Request failed") : "Internal server error",
      ...(requestId && { requestId }),
      ...(!isProd && status >= 500 && err.stack && { stack: err.stack }),
    },
  });
}

function httpStatusCode(status) {
  const codes = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "UNPROCESSABLE_ENTITY",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_SERVER_ERROR",
  };
  return codes[status] || "ERROR";
}
