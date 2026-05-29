const fs = require("node:fs/promises");
const path = require("node:path");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function sanitizeFileSegment(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return fallback;
  }

  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function screenshotFileName(request, sequence) {
  const brand = sanitizeFileSegment(request?.filters?.brand, "unknown-brand");
  const vin = sanitizeFileSegment(request?.vin, "unknown-vin");
  const partName = sanitizeFileSegment(request?.filters?.partName, "unknown-part");
  return {
    baseName: `${brand}_${vin}_${partName}`,
    sequence: sequence || 1
  };
}

async function reserveScreenshotPath(screenshotDir, request, sequence) {
  const { baseName, sequence: requestedSequence } = screenshotFileName(request, sequence);
  const entries = await fs.readdir(screenshotDir).catch(() => []);
  const pattern = new RegExp(`^${escapeRegex(baseName)}_(\\d{2})\\.png$`, "i");
  let highest = 0;

  for (const entry of entries) {
    const match = entry.match(pattern);
    if (!match) {
      continue;
    }

    highest = Math.max(highest, Number.parseInt(match[1], 10));
  }

  const nextIndex = Math.max(requestedSequence, highest + 1);
  const fileName = `${baseName}_${String(nextIndex).padStart(2, "0")}.png`;
  return path.resolve(screenshotDir, fileName);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function captureEvidence(page, options) {
  const {
    screenshotDir,
    request,
    sequence,
    timestamp,
    pageTitle,
    pageUrl,
    uiVariant
  } = options;

  await ensureDir(screenshotDir);
  const fullPath = await reserveScreenshotPath(screenshotDir, request, sequence);
  await page.screenshot({ path: fullPath, fullPage: true, timeout: options.timeoutMs });

  return {
    pageUrl,
    pageTitle,
    uiVariant,
    screenshotUrl: `file://${fullPath}`,
    timestamp
  };
}

async function buildEvidence(page, env, _label, uiVariant, request, sequence) {
  const timestamp = new Date().toISOString();
  const pageUrl = page.url();
  const pageTitle = await page.title();

  return captureEvidence(page, {
    screenshotDir: env.SCREENSHOT_DIR,
    request,
    sequence,
    pageTitle,
    pageUrl,
    timestamp,
    timeoutMs: env.NAV_TIMEOUT_MS,
    uiVariant: uiVariant || "unknown"
  });
}

module.exports = {
  buildEvidence
};
