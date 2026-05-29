const REQUIRED_ENV_VARS = [
  "PARTSLINK24_COMPANY_ID",
  "PARTSLINK24_USERNAME",
  "PARTSLINK24_PASSWORD"
];

function trimString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function buildErrorResponse(errorCode, errorMessage, recommendedNextAction) {
  return {
    success: false,
    found: false,
    errorCode,
    errorMessage,
    recommendedNextAction
  };
}

function buildNoMatchResponse(errorMessage, recommendedNextAction, evidence) {
  const response = {
    success: true,
    found: false,
    errorMessage,
    recommendedNextAction
  };

  if (evidence) {
    response.evidence = evidence;
  }

  return response;
}

function buildAmbiguousResponse(matches, evidence) {
  return {
    success: true,
    found: true,
    matches,
    evidence
  };
}

function validateSearchPayload(body) {
  const vin = trimString(body?.vin);
  if (!vin) {
    return { ok: false, field: "vin" };
  }

  const brand = trimString(body?.filters?.brand);
  if (!brand) {
    return { ok: false, field: "filters.brand" };
  }

  const partName = trimString(body?.filters?.partName);
  if (!partName) {
    return { ok: false, field: "filters.partName" };
  }

  const partSelection = trimString(body?.filters?.partSelection);

  return {
    ok: true,
    value: {
      platformName: trimString(body?.platformName),
      vin,
      filters: {
        brand,
        partName,
        ...(partSelection ? { partSelection } : {})
      },
      allowAmbiguousResults: body?.allowAmbiguousResults === true
    }
  };
}

function getMissingConfig(env) {
  return REQUIRED_ENV_VARS.filter((name) => !trimString(env[name]));
}

module.exports = {
  buildAmbiguousResponse,
  buildErrorResponse,
  buildNoMatchResponse,
  getMissingConfig,
  validateSearchPayload
};
