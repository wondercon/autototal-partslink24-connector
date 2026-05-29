const { detectUiVariant: defaultDetectUiVariant } = require("./uiDetect");
const newUi = require("./ui/new");
const oldUi = require("./ui/old");
const {
  buildAmbiguousResponse,
  buildErrorResponse,
  buildNoMatchResponse
} = require("./schema");

const LOGIN_URL = "https://www.partslink24.com/partslink24/user/login.do";
const BRAND_MENU_URL = "https://www.partslink24.com/partslink24/user/brandMenu.do";

function normalizeForCompare(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function maskVin(vin) {
  return vin ? vin.slice(-4).padStart(vin.length, "*") : "";
}

function responseConfidence(selectionMode) {
  if (selectionMode === "exact") {
    return 0.99;
  }

  if (selectionMode === "substring") {
    return 0.8;
  }

  return 0.7;
}

async function gotoWithTimeout(page, url, timeout) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await settlePage(page, timeout);
}

async function findBrandLocator(page, brand) {
  const exactName = new RegExp(`^\\s*${escapeRegex(brand)}\\s*$`, "i");
  const cssBrand = cssEscape(brand);
  const lowerBrand = cssEscape(brand.toLowerCase());
  const factories = [
    () => page.getByRole("link", { name: exactName }).first(),
    () => page.locator("a").filter({ hasText: exactName }).first(),
    () =>
      page
        .locator(
          `a:has(img[alt*="${cssBrand}" i]), a:has(img[title*="${cssBrand}" i]), a:has(img[src*="${lowerBrand}"])`
        )
        .first(),
    () =>
      page
        .locator(
          `img[alt*="${cssBrand}" i], img[title*="${cssBrand}" i], [title*="${cssBrand}" i], [aria-label*="${cssBrand}" i]`
        )
        .first(),
    () =>
      page
        .locator(
          `xpath=//*[self::img or self::*[@title or @aria-label]][contains(translate(@alt, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${brand.toLowerCase()}") or contains(translate(@title, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${brand.toLowerCase()}") or contains(translate(@aria-label, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${brand.toLowerCase()}")]/ancestor-or-self::a[1]`
        )
        .first()
  ];

  for (const createLocator of factories) {
    let locator;
    try {
      locator = createLocator();
    } catch {
      continue;
    }

    if (await locator.count()) {
      const tagName = typeof locator.evaluate === "function"
        ? await locator.evaluate((node) => node.tagName).catch(() => "")
        : "";
      if (tagName.toLowerCase() === "a") {
        return locator;
      }

      const anchor = locator.locator("xpath=ancestor-or-self::a[1]").first();
      if (await anchor.count().catch(() => 0)) {
        return anchor;
      }

      return locator;
    }
  }

  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscape(value) {
  return value.replace(/["\\]/g, "\\$&");
}

async function canReuseSession(page, timeout) {
  await gotoWithTimeout(page, BRAND_MENU_URL, timeout);
  return isAuthenticatedSession(page, timeout);
}

async function ensureAuthenticatedSession(page, env) {
  if (await isAuthenticatedSession(page, Math.min(env.NAV_TIMEOUT_MS, 3000)).catch(() => false)) {
    return true;
  }

  return canReuseSession(page, env.NAV_TIMEOUT_MS);
}

async function login(page, env) {
  if (!page.url().includes("/user/login.do")) {
    await gotoWithTimeout(page, LOGIN_URL, env.NAV_TIMEOUT_MS);
  } else {
    await settlePage(page, env.NAV_TIMEOUT_MS);
  }
  if (await isAuthenticatedSession(page, Math.min(env.NAV_TIMEOUT_MS, 3000))) {
    return true;
  }

  const companyField = page
    .locator('input[name="companyId"], input#companyId, input[name="accountLogin"], input#login-id')
    .first();
  await companyField.waitFor({ state: "visible", timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  if (!(await companyField.count().catch(() => 0))) {
    return false;
  }
  await page.waitForFunction(() => typeof window.doLoginAjax === "function", {
    timeout: Math.min(env.NAV_TIMEOUT_MS, 5000)
  }).catch(() => {});
  await sleep(page, 500);

  await companyField.fill(env.PARTSLINK24_COMPANY_ID, {
    timeout: env.NAV_TIMEOUT_MS
  });
  await page
    .locator('input[name="username"], input#username, input[name="userLogin"], input#login-name')
    .first()
    .fill(env.PARTSLINK24_USERNAME, {
      timeout: env.NAV_TIMEOUT_MS
    });
  await page
    .locator('input[name="password"], input#password, input[name="loginBean.password"], input#inputPassword')
    .first()
    .fill(env.PARTSLINK24_PASSWORD, {
      timeout: env.NAV_TIMEOUT_MS
    });
  const explicitLoginButton = page.locator("#hidden-login").first();
  if (await explicitLoginButton.count().catch(() => 0)) {
    await explicitLoginButton.click({ timeout: env.NAV_TIMEOUT_MS });
  } else {
    await page
      .locator('button[type="submit"], input[type="submit"], button:has-text("Login")')
      .first()
      .click({ timeout: env.NAV_TIMEOUT_MS });
  }

  await sleep(page, 500);
  if (await needsSessionConfirm(page, Math.min(env.NAV_TIMEOUT_MS, 3000)).catch(() => false)) {
    await resolveSessionConfirm(page, env.NAV_TIMEOUT_MS);
  }
  await page.waitForURL(/brandMenu\.do/, { timeout: Math.min(env.NAV_TIMEOUT_MS, 8000) }).catch(() => {});
  await settlePage(page, env.NAV_TIMEOUT_MS);
  return isAuthenticatedSession(page, Math.min(env.NAV_TIMEOUT_MS, 3000));
}

async function resolveAttentionPage(page, timeout) {
  const title = await page.title().catch(() => "");
  const reloadLink = page.getByRole("link", { name: /^Reload$/i }).first();
  const bodyText = await page.locator("body").innerText({ timeout }).catch(() => "");
  const isAttentionPage =
    /Attention - Please read carefully/i.test(title) ||
    /bookmark that does not point to the main page|using the link below/i.test(bodyText);

  if (!isAttentionPage) {
    return false;
  }

  if (await reloadLink.count().catch(() => 0)) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout }),
      reloadLink.click({ timeout })
    ]);
    return true;
  }

  await page.goto("https://www.partslink24.com/", { waitUntil: "domcontentloaded", timeout });
  return true;
}

async function resolveSessionConfirm(page, timeout) {
  if (!(await needsSessionConfirm(page, timeout))) {
    return;
  }

  const confirmButton = page
    .locator('button:has-text("Confirm"), input[value="Confirm"], a:has-text("Confirm")')
    .first();

  if (await confirmButton.count().catch(() => 0)) {
    await confirmButton.click({ timeout });
    await settlePage(page, timeout);
  }
}

async function acceptCookieConsent(page, timeout) {
  const buttons = [
    page.getByRole("button", { name: /accept all/i }).first(),
    page.getByText(/^accept all$/i).first(),
    page.getByRole("button", { name: /accept only essential services/i }).first()
  ];

  for (const button of buttons) {
    try {
      const visible = await button.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      await button.click({ timeout: Math.min(timeout, 1000) });
      await sleep(page, 500);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function waitForLoadingOverlayToClear(page, timeout) {
  const loadingText = page.getByText(/^LOADING\.\.\.$/i).first();
  const interactiveReady = page.locator(
    'input[name="companyId"], input#companyId, input[name="accountLogin"], input#login-id, ' +
      'input[placeholder*="Direct entry" i], input[placeholder*="Search for parts" i], ' +
      'input[name*="vin" i], form input[type="text"]'
  ).first();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const visible = typeof loadingText.isVisible === "function"
      ? await loadingText.isVisible().catch(() => false)
      : false;
    if (!visible) {
      return;
    }

    if (await interactiveReady.isVisible().catch(() => false)) {
      return;
    }

    await sleep(page, 500);
  }
}

async function waitForLoginForm(page, timeout) {
  const formInputs = page.locator(
    'input[name="companyId"], input#companyId, input[name="accountLogin"], input#login-id'
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    await settlePage(page, Math.min(timeout, 5000));
    if (await isAuthenticatedSession(page, timeout)) {
      return "authenticated";
    }

    if ((await formInputs.count().catch(() => 0)) > 0) {
      return "form";
    }

    await sleep(page, 500);
  }

  return "timeout";
}

async function waitForPostLoginState(page, timeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    await settlePage(page, Math.min(timeout, 5000));

    if (await isAuthenticatedSession(page, timeout)) {
      return "authenticated";
    }

    if (await needsSessionConfirm(page, timeout)) {
      return "session_confirm";
    }

    if (Date.now() - startedAt >= 1500 && await looksLikeLoginPage(page, timeout)) {
      return "login_form";
    }

    await sleep(page, 500);
  }

  return "timeout";
}

async function waitForLoginOutcome(page, timeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await isAuthenticatedSession(page, Math.min(timeout, 3000)).catch(() => false)) {
      return "authenticated";
    }

    if (await needsSessionConfirm(page, Math.min(timeout, 3000)).catch(() => false)) {
      return "session_confirm";
    }

    await sleep(page, 250);
  }

  return "timeout";
}

async function settlePage(page, timeout) {
  const settleTimeout = Math.min(timeout, 5000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const resolvedAttention = await resolveAttentionPage(page, settleTimeout);
    const acceptedConsent = await acceptCookieConsent(page, settleTimeout);
    await waitForLoadingOverlayToClear(page, settleTimeout);

    if (!resolvedAttention && !acceptedConsent) {
      return;
    }
  }
}

async function sleep(page, delayMs) {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(delayMs);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function clickLocator(locator, timeout) {
  await locator.click({ timeout }).catch(async () => {
    await locator.evaluate((node) => node.click()).catch(async () => {
      await locator.click({ timeout, force: true });
    });
  });
}

async function waitForBrandAppReady(page, timeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    await waitForLoadingOverlayToClear(page, Math.min(timeout, 5000));

    const hasKnownUiMarkers =
      (await newUi.matchesVariant(page)) ||
      (await oldUi.matchesVariant(page));

    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (hasKnownUiMarkers) {
      return true;
    }

    const normalizedBody = bodyText.trim();
    const hasNewAppReadyText =
      /Direct entry|Search for parts|Select dealer|Model Overview/i.test(normalizedBody);
    const shellOnly =
      /^partslink24$/i.test(normalizedBody) ||
      /^partslink24\s*\.\.\.$/i.test(normalizedBody) ||
      /^partslink24\s*Select dealer$/i.test(normalizedBody);

    if (
      page.url().includes("/pl24-app/") &&
      title &&
      !/^Loading\.\.\.$/i.test(title) &&
      normalizedBody &&
      hasNewAppReadyText &&
      !shellOnly
    ) {
      return true;
    }

    await sleep(page, 1000);
  }

  return false;
}

async function looksLikeVinNotFoundState(page, uiVariant) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/no vehicles? found|vehicle could not be identified|vin.*not found|invalid vin/i.test(bodyText)) {
    return true;
  }

  if (uiVariant === "new") {
    if (/Model Overview/i.test(bodyText)) {
      return true;
    }

    if (/Start\s+\w+/i.test(bodyText) && /Direct entry/i.test(bodyText) && !/Search for parts/i.test(bodyText)) {
      return true;
    }
  }

  return false;
}

async function looksLikeLoginPage(page, timeout) {
  if (!page.url().includes("/user/login.do")) {
    return false;
  }

  const loginField = page.locator(
    'input[name="companyId"], input#companyId, input[name="accountLogin"], input#login-id'
  ).first();
  if ((await loginField.count().catch(() => 0)) > 0) {
    return true;
  }

  const textTimeout = Math.min(timeout, 3000);
  const bodyText = await page.locator("body").innerText({ timeout: textTimeout }).catch(() => "");
  return /login for registered partslink24 users/i.test(bodyText);
}

async function isAuthenticatedSession(page, timeout) {
  if (page.url().includes("brandMenu.do")) {
    return true;
  }

  if (page.url().includes("/user/login.do")) {
    return false;
  }

  const logoutLink = page.getByRole("link", { name: /log out/i }).first();
  if ((await logoutLink.count().catch(() => 0)) > 0) {
    return true;
  }

  const directAccess = page.getByText("DIRECT ACCESS", { exact: false }).first();
  if ((await directAccess.count().catch(() => 0)) > 0) {
    return true;
  }

  const textTimeout = Math.min(timeout, 3000);
  const bodyText = await page.locator("body").innerText({ timeout: textTimeout }).catch(() => "");
  return /a warm welcome to partslink24/i.test(bodyText) && !/login/i.test(bodyText);
}

async function needsSessionConfirm(page, timeout) {
  const textTimeout = Math.min(timeout, 3000);
  const bodyText = await page.locator("body").innerText({ timeout: textTimeout }).catch(() => "");
  return (
    /end the current session now and log in again/i.test(bodyText) ||
    /Confirm\s+Cancel/i.test(bodyText)
  );
}

function summarizeMatches(rows) {
  return rows.map((row) => ({
    resultLabel: row.description,
    rowText: row.rowText
  }));
}

function chooseRow(rows, request) {
  const selection = request.filters.partSelection;
  if (selection) {
    const wanted = normalizeForCompare(selection);
    const exact = rows.filter((row) => normalizeForCompare(row.description) === wanted);
    if (exact.length === 1) {
      return { kind: "selected", row: exact[0], selectionMode: "exact" };
    }

    if (exact.length > 1) {
      if (request.allowAmbiguousResults) {
        return { kind: "selected", row: exact[0], selectionMode: "exact" };
      }

      return { kind: "ambiguous", matches: summarizeMatches(exact) };
    }

    const exactRowText = rows.filter((row) => normalizeForCompare(row.rowText) === wanted);
    if (exactRowText.length === 1) {
      return { kind: "selected", row: exactRowText[0], selectionMode: "exact" };
    }

    if (exactRowText.length > 1) {
      if (request.allowAmbiguousResults) {
        return { kind: "selected", row: exactRowText[0], selectionMode: "exact" };
      }

      return { kind: "ambiguous", matches: summarizeMatches(exactRowText) };
    }

    const partial = rows.filter((row) => normalizeForCompare(row.description).includes(wanted));
    if (partial.length === 1) {
      return { kind: "selected", row: partial[0], selectionMode: "substring" };
    }

    if (partial.length > 1) {
      if (request.allowAmbiguousResults) {
        return { kind: "selected", row: partial[0], selectionMode: "substring" };
      }

      return { kind: "ambiguous", matches: summarizeMatches(partial) };
    }

    const partialRowText = rows.filter((row) => normalizeForCompare(row.rowText).includes(wanted));
    if (partialRowText.length === 1) {
      return { kind: "selected", row: partialRowText[0], selectionMode: "substring" };
    }

    if (partialRowText.length > 1) {
      if (request.allowAmbiguousResults) {
        return { kind: "selected", row: partialRowText[0], selectionMode: "substring" };
      }

      return { kind: "ambiguous", matches: summarizeMatches(partialRowText) };
    }

    return { kind: "missing" };
  }

  if (rows.length === 1) {
    return { kind: "selected", row: rows[0], selectionMode: "single" };
  }

  if (rows.length > 1 && request.allowAmbiguousResults) {
    return { kind: "selected", row: rows[0], selectionMode: "single" };
  }

  return { kind: "ambiguous", matches: summarizeMatches(rows) };
}

function createPartslink24Service(deps = {}) {
  const adapters = deps.adapters || { new: newUi, old: oldUi };
  const detectUiVariant = deps.detectUiVariant || defaultDetectUiVariant;
  const buildEvidence = deps.buildEvidence || require("./evidence").buildEvidence;

  return async function searchPartslink24({ browserApi, env, logger, request }) {
    const session = typeof browserApi.acquireSession === "function"
      ? await browserApi.acquireSession(env)
      : await browserApi.newContext(env);
    const { context, page } = session;
    const releaseSession = typeof session.release === "function" ? session.release : async () => {};
    const resetSession = typeof session.reset === "function" ? session.reset : async () => {};
    let uiVariant = null;
    let adapter = null;
    let shouldPersistSession = false;
    let evidenceSequence = 1;
    let shouldCloseContext = typeof browserApi.acquireSession !== "function";
    const takeEvidence = (label) => buildEvidence(page, env, label, uiVariant, request, evidenceSequence++);

    try {
      logger.info(
        {
          brand: request.filters.brand,
          partName: request.filters.partName,
          partSelection: request.filters.partSelection,
          vin: maskVin(request.vin)
        },
        "Received lookup request"
      );

      const sessionReused = await ensureAuthenticatedSession(page, env);
      logger.info({ sessionReused }, "Session check completed");
      if (!sessionReused) {
        logger.info("Starting interactive login");
        const loginSucceeded = await login(page, env);
        logger.info({ loginSucceeded, pageUrl: page.url() }, "Interactive login completed");
      }

      if (!page.url().includes("brandMenu.do")) {
        await gotoWithTimeout(page, BRAND_MENU_URL, env.NAV_TIMEOUT_MS);
        await resolveAttentionPage(page, env.NAV_TIMEOUT_MS);
      }
      logger.info({ pageUrl: page.url() }, "Reached brand menu");
      if (!page.url().includes("brandMenu.do")) {
        const evidence = await takeEvidence("login-failed");
        return {
          ...buildErrorResponse(
            "LOGIN_FAILED",
            "Login appears to have failed (no brand menu detected).",
            "Verify credentials or check the latest login screen layout."
          ),
          evidence
        };
      }

      shouldPersistSession = true;

      const brandLocator = await findBrandLocator(page, request.filters.brand);
      if (!brandLocator) {
        const evidence = await takeEvidence("brand-not-found");
        return {
          ...buildErrorResponse(
            "BRAND_NOT_FOUND",
            "Brand label not present on brand menu.",
            "Verify the brand label exactly as shown on partslink24."
          ),
          evidence
        };
      }

      await brandLocator.click({ timeout: env.NAV_TIMEOUT_MS });
      logger.info({ brand: request.filters.brand }, "Brand selected");
      await waitForBrandAppReady(page, env.NAV_TIMEOUT_MS);
      uiVariant = await detectUiVariant(page);
      if (!uiVariant || !adapters[uiVariant]) {
        const evidence = await takeEvidence("ui-variant-undetected");
        return {
          ...buildErrorResponse(
            "UI_VARIANT_UNDETECTED",
            "After selecting the brand, neither supported UI fingerprint matched.",
            "Selector tuning is required for the current partslink24 layout."
          ),
          evidence
        };
      }

      logger.info({ uiVariant }, "Detected UI variant");
      adapter = adapters[uiVariant];

      const vinInput = adapter.findVinInput(page);
      if (!(await vinInput.count())) {
        const evidence = await takeEvidence("vin-search-failed");
        return {
          ...buildErrorResponse(
            "VIN_SEARCH_FAILED",
            "Could not locate the VIN search input.",
            "Check the current UI selectors for the detected variant."
          ),
          evidence
        };
      }

      await vinInput.fill(request.vin, { timeout: env.NAV_TIMEOUT_MS });
      await vinInput.press("Enter", { timeout: env.NAV_TIMEOUT_MS }).catch(async () => {
        await vinInput.locator("xpath=following::*[self::button or self::input][1]").first().click({
          timeout: env.NAV_TIMEOUT_MS
        });
      });
      await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS });
      if (typeof adapter.waitForVinIdentification === "function") {
        await adapter.waitForVinIdentification(page, request.vin, env.NAV_TIMEOUT_MS).catch(() => false);
      }
      logger.info({ uiVariant, pageUrl: page.url() }, "VIN submitted");

      if (typeof adapter.openPartSearch === "function") {
        await adapter.openPartSearch(page, env);
        logger.info("Part search UI opened");
      }

      const partInput = adapter.findPartSearchInput(page);
      if (!(await partInput.count())) {
        const vinNotFound = await looksLikeVinNotFoundState(page, uiVariant);
        if (vinNotFound) {
          const evidence = await takeEvidence("vin-not-found");
          return {
            ...buildNoMatchResponse(
              "VIN search did not identify a vehicle in the selected brand catalog.",
              "Verify the VIN and brand combination, then retry or fall back to manual model selection if supported.",
              evidence
            ),
            errorCode: "VIN_NOT_FOUND"
          };
        }

        const evidence = await takeEvidence("part-search-failed");
        return {
          ...buildErrorResponse(
            "PART_SEARCH_FAILED",
            "Could not locate the part-name search input.",
            "Check the current UI selectors for the detected variant."
          ),
          evidence
        };
      }

      const partInputVisible = await partInput
        .waitFor({ state: "visible", timeout: env.NAV_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!partInputVisible) {
        const vinNotFound = await looksLikeVinNotFoundState(page, uiVariant);
        const evidence = await takeEvidence(vinNotFound ? "vin-not-found" : "part-search-failed");
        if (vinNotFound) {
          return {
            ...buildNoMatchResponse(
              "VIN search did not identify a vehicle in the selected brand catalog.",
              "Verify the VIN and brand combination, then retry or fall back to manual model selection if supported.",
              evidence
            ),
            errorCode: "VIN_NOT_FOUND"
          };
        }

        return {
          ...buildErrorResponse(
            "PART_SEARCH_FAILED",
            "The part-name search input was present in the DOM but never became visible.",
            "Inspect the post-VIN screen state and update the readiness handling for this brand."
          ),
          evidence
        };
      }

      await partInput.fill(request.filters.partName, { timeout: env.NAV_TIMEOUT_MS });
      const submitResult = typeof adapter.submitPartSearch === "function"
        ? await adapter.submitPartSearch(page, partInput, env).catch(() => false)
        : false;
      const submittedByAdapter = typeof submitResult === "object" ? submitResult.handled : submitResult;
      if (typeof submitResult === "object") {
        logger.info(
          {
            submittedByAdapter,
            submitAction: submitResult.action,
            resultsDetected: submitResult.resultsDetected
          },
          "Part search action completed"
        );
      } else {
        logger.info({ submittedByAdapter }, "Part search submitted");
      }

      if (!submittedByAdapter) {
        await partInput.press("Enter", { timeout: env.NAV_TIMEOUT_MS }).catch(async () => {
          await partInput.locator("xpath=following::*[self::button or self::input][1]").first().click({
            timeout: env.NAV_TIMEOUT_MS
          });
        });
      }
      await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS });

      const rows = await adapter.getResultRows(page);
      logger.info({ rowCount: rows.length }, "Result rows extracted");
      if (!rows.length) {
        const evidence = await takeEvidence("no-results");
        return buildNoMatchResponse(
          "Part-name search completed but no result rows were found.",
          "Verify the VIN and part name, then retry with a different part description.",
          evidence
        );
      }

      if (!request.filters.partSelection && adapter.shouldReturnListWithoutSelection?.()) {
        const evidence = await takeEvidence("part-list");
        return buildAmbiguousResponse(summarizeMatches(rows), evidence);
      }

      const selection = chooseRow(rows, request);
      if (selection.kind === "missing") {
        const evidence = await takeEvidence("result-row-not-found");
        return {
          ...buildErrorResponse(
            "RESULT_ROW_NOT_FOUND",
            "No result row matched the supplied partSelection.",
            "Inspect the returned matches and retry with a more specific partSelection."
          ),
          evidence
        };
      }

      if (selection.kind === "ambiguous") {
        const evidence = await takeEvidence("ambiguous-results");
        return buildAmbiguousResponse(selection.matches, evidence);
      }

      const selectedRow = selection.row;
      if (typeof adapter.selectResultRow === "function") {
        const handled = await adapter.selectResultRow(selectedRow, page, env).catch(() => false);
        if (handled) {
          const extractedSelection = typeof adapter.extractSelectionResult === "function"
            ? await adapter.extractSelectionResult(page, selectedRow, env).catch(() => null)
            : null;
          if (extractedSelection?.resultCode) {
            const evidence = await takeEvidence("single-match");
            return {
              success: true,
              found: true,
              resultCode: extractedSelection.resultCode,
              resultLabel: extractedSelection.resultLabel || selectedRow.description,
              ...(extractedSelection.resultDescription ? { resultDescription: extractedSelection.resultDescription } : {}),
              resultType: extractedSelection.resultType || "part_number",
              confidence: responseConfidence(selection.selectionMode),
              supersession: extractedSelection.supersession ?? false,
              evidence: {
                ...evidence,
                selectedRowText: selectedRow.rowText,
                ...(extractedSelection.rawText ? { selectedDetailText: extractedSelection.rawText } : {})
              }
            };
          }

          const extracted = await adapter.extractPartNumber(page);
          if (!extracted?.resultCode) {
            const evidence = await takeEvidence("part-number-not-found");
            return {
              ...buildErrorResponse(
                "PART_NUMBER_NOT_FOUND",
                'Part information rendered but no "Part no." value was extractable.',
                "Check the current Part information layout and update the selectors."
              ),
              evidence
            };
          }

          const evidence = await takeEvidence("single-match");
          return {
            success: true,
            found: true,
            resultCode: extracted.resultCode,
            resultLabel: selectedRow.description,
            resultType: "part_number",
            confidence: responseConfidence(selection.selectionMode),
            supersession: extracted.supersession,
            evidence: {
              ...evidence,
              selectedRowText: selectedRow.rowText
            }
          };
        }
      }

      const partInfoButton = adapter.findPartInfoButton(selectedRow.locator, page);
      if (!(await partInfoButton.count())) {
        const evidence = await takeEvidence("part-info-button-not-found");
        return {
          ...buildErrorResponse(
            "PART_INFO_BUTTON_NOT_FOUND",
            "Could not locate the Part information button for the selected row.",
            "Check the row action selectors for the detected UI variant."
          ),
          evidence
        };
      }

      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }),
        clickLocator(partInfoButton, env.NAV_TIMEOUT_MS)
      ]);

      const extracted = await adapter.extractPartNumber(page);
      if (!extracted?.resultCode) {
        const evidence = await takeEvidence("part-number-not-found");
        return {
          ...buildErrorResponse(
            "PART_NUMBER_NOT_FOUND",
            'Part information rendered but no "Part no." value was extractable.',
            "Check the current Part information layout and update the selectors."
          ),
          evidence
        };
      }

      const evidence = await takeEvidence("single-match");
      return {
        success: true,
        found: true,
        resultCode: extracted.resultCode,
        resultLabel: selectedRow.description,
        resultType: "part_number",
        confidence: responseConfidence(selection.selectionMode),
        supersession: extracted.supersession,
        evidence: {
          ...evidence,
          selectedRowText: selectedRow.rowText
        }
      };
    } catch (error) {
      await resetSession().catch(() => {});
      shouldCloseContext = false;
      let evidence;
      try {
        evidence = await takeEvidence("internal-error");
      } catch {
        evidence = undefined;
      }

      logger.error({ err: error, uiVariant }, "Connector request failed");
      return {
        ...buildErrorResponse(
          "CONNECTOR_INTERNAL_ERROR",
          "Unexpected connector error.",
          "Check server logs and refresh selectors if the upstream UI changed."
        ),
        ...(evidence ? { evidence } : {})
      };
    } finally {
      if (shouldPersistSession) {
        try {
          if (adapter && typeof adapter.returnToHome === "function") {
            await adapter.returnToHome(page, env);
          } else if (await isAuthenticatedSession(page, Math.min(env.NAV_TIMEOUT_MS, 3000)).catch(() => false)) {
            await gotoWithTimeout(page, BRAND_MENU_URL, Math.min(env.NAV_TIMEOUT_MS, 5000)).catch(() => {});
          }
          await browserApi.persistStorageState(context, env);
        } catch (error) {
          logger.warn({ err: error, uiVariant }, "Failed to persist post-request session state");
        }
      }
      if (shouldCloseContext) {
        await context.close();
      }
      await releaseSession();
    }
  };
}

module.exports = {
  createPartslink24Service
};
