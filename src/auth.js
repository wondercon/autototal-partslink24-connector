const { buildErrorResponse } = require("./schema");

function createBearerMiddleware(env) {
  return function bearerAuth(req, res, next) {
    const configuredToken = env.CONNECTOR_BEARER_TOKEN;
    if (!configuredToken) {
      next();
      return;
    }

    const header = req.headers.authorization || "";
    const expected = `Bearer ${configuredToken}`;
    if (header !== expected) {
      res.status(401).json(
        buildErrorResponse(
          "UNAUTHORIZED",
          "Missing or invalid bearer token.",
          "Provide Authorization: Bearer <token>."
        )
      );
      return;
    }

    next();
  };
}

module.exports = { createBearerMiddleware };
