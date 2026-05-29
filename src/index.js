const express = require("express");
const pino = require("pino");
const pinoHttp = require("pino-http");
const { createBearerMiddleware } = require("./auth");
const browserApi = require("./browser");
const { createPartslink24Service } = require("./partslink24");
const {
  buildErrorResponse,
  getMissingConfig,
  validateSearchPayload
} = require("./schema");

function parseEnv(env = process.env) {
  return {
    CONNECTOR_BEARER_TOKEN: env.CONNECTOR_BEARER_TOKEN || "",
    HEADLESS: env.HEADLESS !== "false",
    LOG_LEVEL: env.LOG_LEVEL || "info",
    NAV_TIMEOUT_MS: Number.parseInt(env.NAV_TIMEOUT_MS || "30000", 10),
    PARTSLINK24_COMPANY_ID: env.PARTSLINK24_COMPANY_ID || "",
    PARTSLINK24_PASSWORD: env.PARTSLINK24_PASSWORD || "",
    PARTSLINK24_USERNAME: env.PARTSLINK24_USERNAME || "",
    PORT: Number.parseInt(env.PORT || "8080", 10),
    SCREENSHOT_DIR: env.SCREENSHOT_DIR || "/data/screenshots",
    STORAGE_STATE_PATH: env.STORAGE_STATE_PATH || "/data/storageState.json"
  };
}

function createApp(options = {}) {
  const env = parseEnv(options.env);
  const logger = options.logger || pino({ level: env.LOG_LEVEL });
  const app = express();
  const searchService = options.searchService || createPartslink24Service(options.serviceDeps);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(request) {
          const vin = typeof request.body?.vin === "string" ? request.body.vin.trim() : "";
          const last4 = vin ? vin.slice(-4) : undefined;
          return {
            id: request.id,
            method: request.method,
            url: request.url,
            brand: request.body?.filters?.brand,
            partName: request.body?.filters?.partName,
            partSelection: request.body?.filters?.partSelection,
            vin: last4 ? `***${last4}` : undefined
          };
        }
      }
    })
  );

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.post("/search", createBearerMiddleware(env), async (req, res) => {
    const missingConfig = getMissingConfig(env);
    if (missingConfig.length > 0) {
      res.json(
        buildErrorResponse(
          "CONNECTOR_NOT_CONFIGURED",
          `Missing env var: ${missingConfig[0]}`,
          "Set the required PARTSLINK24_* environment variables and retry."
        )
      );
      return;
    }

    const validation = validateSearchPayload(req.body);
    if (!validation.ok) {
      res.json(
        buildErrorResponse(
          "MISSING_REQUIRED_PARAM",
          validation.field,
          "Provide the missing request field and retry."
        )
      );
      return;
    }

    try {
      const result = await searchService({
        browserApi: options.browserApi || browserApi,
        env,
        logger: req.log,
        request: validation.value
      });
      res.json(result);
    } catch (error) {
      req.log.error({ err: error }, "Route handler failed");
      res.json(
        buildErrorResponse(
          "CONNECTOR_INTERNAL_ERROR",
          "Unexpected connector error.",
          "Check server logs and retry."
        )
      );
    }
  });

  return { app, env, logger };
}

if (require.main === module) {
  const { app, env, logger } = createApp();
  browserApi
    .initBrowser(env)
    .then(() => {
      app.listen(env.PORT, () => {
        logger.info({ port: env.PORT }, "partslink24-connector listening");
      });
    })
    .catch((error) => {
      logger.error({ err: error }, "Failed to launch browser");
      process.exit(1);
    });

  const shutdown = async () => {
    await browserApi.closeBrowser().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { createApp, parseEnv };
