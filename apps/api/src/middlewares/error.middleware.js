"use strict";
const STATUS_CODES = {
  400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
  409: "CONFLICT", 422: "UNPROCESSABLE_ENTITY", 429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR", 503: "SERVICE_UNAVAILABLE",
};

// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("[error]", err.message, err.stack);
  else if (status >= 400) console.warn("[warn]", err.message);
  const isProd = process.env.NODE_ENV === "production";
  res.status(status).json({
    success: false,
    error: {
      code: err.code || STATUS_CODES[status] || "ERROR",
      message: status < 500 ? (err.message || "Request failed") : "Something went wrong",
      ...(req.requestId && { requestId: req.requestId }),
      ...(!isProd && status >= 500 && err.stack && { stack: err.stack }),
    },
  });
}

module.exports = { errorMiddleware };
