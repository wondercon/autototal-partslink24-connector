async function matchesVariant(page) {
  const probes = [
    'input[placeholder*="Direct entry" i]',
    'input[aria-label*="Direct entry" i]',
    'input[placeholder*="Search for parts" i]',
    'input[aria-label*="Search for parts" i]',
    'header [role="searchbox"]',
    ':text("Model Overview")'
  ];

  for (const selector of probes) {
    if (await page.locator(selector).first().count()) {
      return true;
    }
  }

  return false;
}

function findVinInput(page) {
  return page
    .locator(
      'input[placeholder*="Direct entry" i], input[aria-label*="Direct entry" i], input[placeholder*="VIN" i], input[aria-label*="VIN" i], input[name*="vin" i], [role="textbox"][aria-label*="VIN" i]'
    )
    .first();
}

function findPartSearchInput(page) {
  return page
    .locator(
      'input[placeholder*="Search for parts" i], input[aria-label*="Search for parts" i], input[placeholder*="part" i], input[aria-label*="part" i], input[name*="part" i], [role="searchbox"]'
    )
    .first();
}

function findSearchPanel(page) {
  return page.locator('xpath=//div[contains(normalize-space(), "Search:")]').first();
}

async function openPartSearch() {
  return;
}

async function returnToHome(page, env) {
  const startLink = page
    .locator('a:has-text("Start"), button:has-text("Start"), [role="link"]:has-text("Start")')
    .first();

  if ((await startLink.count().catch(() => 0)) < 1) {
    return false;
  }

  await startLink.click({ timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  return true;
}

async function waitForVinIdentification(page, vin, timeout) {
  const startedAt = Date.now();
  const searchInput = findPartSearchInput(page);

  while (Date.now() - startedAt < timeout) {
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const identified =
      currentUrl.includes(`/${vin}/`) ||
      currentUrl.includes(`vin=${vin}`) ||
      bodyText.includes(vin);

    if (identified) {
      const visible = await searchInput
        .waitFor({ state: "visible", timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (visible) {
        return true;
      }
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return false;
}

function shouldReturnListWithoutSelection() {
  return true;
}

async function submitPartSearch(page, partInput, env) {
  const submitButton = page
    .locator(
      'xpath=(//input[contains(@placeholder, "Search for parts") or contains(@aria-label, "Search for parts")]' +
        '/following::*[self::button or self::input][1])[1]'
    )
    .first();

  await partInput.press("Enter", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  if (await waitForSearchResults(page, Math.min(env.NAV_TIMEOUT_MS, 25000)).catch(() => false)) {
    return true;
  }

  if ((await submitButton.count().catch(() => 0)) > 0) {
    await submitButton.click({ timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
    await waitForSearchResults(page, env.NAV_TIMEOUT_MS).catch(() => {});
    return true;
  }

  return false;
}

async function getResultRows(page) {
  await waitForSearchResults(page, 25000).catch(() => {});
  const cardLocator = page.locator(
    'xpath=//div[contains(normalize-space(), "Search:")]//*[self::div or self::li][.//*[contains(normalize-space(), "Part no.")] and .//*[contains(normalize-space(), "Description")] and not(.//*[self::div or self::li][.//*[contains(normalize-space(), "Part no.")] and .//*[contains(normalize-space(), "Description")]])]'
  );
  const cardCount = await cardLocator.count().catch(() => 0);
  const cardRows = [];

  for (let index = 0; index < cardCount; index += 1) {
    const locator = cardLocator.nth(index);
    const rowText = (await locator.innerText().catch(() => "")).trim();
    if (!rowText) {
      continue;
    }

    const lines = rowText.split("\n").map((line) => line.trim()).filter(Boolean);
    const partIndex = lines.findIndex((line) => /^Part no\.?$/i.test(line));
    const descIndex = lines.findIndex((line) => /^Description$/i.test(line));
    const partNumber =
      partIndex >= 0 && lines[partIndex + 1]
        ? lines[partIndex + 1]
        : lines[0];
    const description =
      descIndex >= 0 && lines[descIndex + 1]
        ? lines[descIndex + 1]
        : partNumber;

    cardRows.push({
      description: partNumber,
      resultDescription: description,
      rowText,
      locator
    });
  }

  if (cardRows.length > 0) {
    return cardRows;
  }

  const rowLocator = page.locator(
    '[role="row"]:has(button, a), .MuiDataGrid-row, tr:has(td), li:has(button, a), [data-testid*="row"]'
  );
  const count = await rowLocator.count();
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const locator = rowLocator.nth(index);
    const rowText = (await locator.innerText()).trim();
    if (!rowText) {
      continue;
    }

    const description = rowText.split("\n")[0].trim();
    rows.push({ description, rowText, locator });
  }

  return rows;
}

async function waitForSearchResults(page, timeout) {
  const startedAt = Date.now();
  const searchPanel = findSearchPanel(page);
  const cardMarker = searchPanel.locator(
    'xpath=.//*[contains(normalize-space(), "Part no.") or contains(normalize-space(), "Description")]'
  ).first();
  const partNumberRows = searchPanel.locator(
    'xpath=.//*[self::div or self::li][.//*[contains(normalize-space(), "Part no.")]]'
  );
  const noResultsMarker = searchPanel.locator(
    'xpath=.//*[contains(translate(normalize-space(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "no result")]'
  ).first();

  while (Date.now() - startedAt < timeout) {
    const rowCount = await partNumberRows.count().catch(() => 0);
    if ((await cardMarker.count().catch(() => 0)) > 0 && rowCount > 0) {
      return true;
    }

    if ((await noResultsMarker.count().catch(() => 0)) > 0) {
      return true;
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return false;
}

async function selectResultRow(selectedRow, page, env) {
  const row = selectedRow?.locator || selectedRow;
  const expectedPartNumber = selectedRow?.description?.trim() || "";
  const clickable = row.locator("a, button").first();
  if ((await clickable.count().catch(() => 0)) > 0) {
    await clickable.click({ timeout: env.NAV_TIMEOUT_MS }).catch(async () => {
      await row.click({ timeout: env.NAV_TIMEOUT_MS });
    });
  } else {
    await row.click({ timeout: env.NAV_TIMEOUT_MS });
  }

  await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  await waitForSelectionPage(page, expectedPartNumber, env.NAV_TIMEOUT_MS).catch(() => {});
  if (expectedPartNumber) {
    await openSelectedResult(page, env).catch(() => {});
    await waitForSelectionPage(page, expectedPartNumber, env.NAV_TIMEOUT_MS).catch(() => {});
    await clickMatchingPartInfoButton(page, expectedPartNumber, env).catch(() => {});
    await waitForSelectionPage(page, expectedPartNumber, env.NAV_TIMEOUT_MS).catch(() => {});
  }
  return true;
}

function findPartInfoButton(row) {
  return row.locator('button:has-text("Part information"), a:has-text("Part information"), [title*="Part information" i]').first();
}

async function extractSelectionResult(page, selectedRow) {
  const expectedPartNumber = selectedRow?.description?.trim();
  if (!expectedPartNumber) {
    return null;
  }

  const blockLocator = findPartInformationBlocks(page, expectedPartNumber);
  const blockCount = await blockLocator.count().catch(() => 0);

  for (let index = 0; index < blockCount; index += 1) {
    const block = blockLocator.nth(index);
    const text = (await block.innerText().catch(() => "")).trim();
    if (!text || !text.includes(expectedPartNumber)) {
      continue;
    }

    const partNumber = extractLabeledValue(text, "Part no") || expectedPartNumber;
    const description = extractLabeledValue(text, "Description") || selectedRow.resultDescription || "";
    if (description || partNumber) {
      return {
        resultCode: partNumber,
        resultLabel: partNumber,
        resultDescription: description,
        resultType: "part_description",
        rawText: text,
        supersession: false
      };
    }
  }

  return null;
}

function findPartInformationBlocks(page, expectedPartNumber = "") {
  const exactPartNo = escapeXPathText(expectedPartNumber);
  if (exactPartNo) {
    return page.locator(
      `xpath=//*[contains(normalize-space(), "Part information")]/ancestor-or-self::*[self::section or self::div or self::article][.//*[contains(normalize-space(), "Part no.")] and .//*[normalize-space()=${exactPartNo}]]`
    );
  }

  return page.locator(
    'xpath=//*[contains(normalize-space(), "Part information")]/ancestor-or-self::*[self::section or self::div or self::article][.//*[contains(normalize-space(), "Part no.")]]'
  );
}

async function clickMatchingPartInfoButton(page, expectedPartNumber, env) {
  const blockLocator = findPartInformationBlocks(page, expectedPartNumber);
  const blockCount = await blockLocator.count().catch(() => 0);

  for (let index = 0; index < blockCount; index += 1) {
    const block = blockLocator.nth(index);
    const infoButton = block
      .locator(
        'button, a, [role="button"], [title*="Part information" i], [aria-label*="Part information" i], [title*="information" i], [aria-label*="information" i]'
      )
      .first();

    if ((await infoButton.count().catch(() => 0)) < 1) {
      continue;
    }

    await infoButton.click({ timeout: env.NAV_TIMEOUT_MS }).catch(async () => {
      await infoButton.evaluate((node) => node.click()).catch(() => {});
    });
    await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});
    return true;
  }

  return false;
}

async function openSelectedResult(page, env) {
  const candidates = [
    page
      .locator('xpath=(//*[contains(normalize-space(), "Search:")]/following::*[self::button or self::a or @role="button"][1])[1]')
      .first(),
    findSearchPanel(page)
      .locator('xpath=following::*[self::button or self::a or @role="button"][1]')
      .first(),
    page.locator('[role="button"]').first(),
    page.locator("button").first()
  ];

  for (const candidate of candidates) {
    if ((await candidate.count().catch(() => 0)) < 1) {
      continue;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    await candidate.click({ timeout: env.NAV_TIMEOUT_MS }).catch(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    });
    await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
    return true;
  }

  const panelBox = await findSearchPanel(page).boundingBox().catch(() => null);
  if (panelBox) {
    await page.mouse.click(panelBox.x + panelBox.width - 4, panelBox.y + 36).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
    return true;
  }

  return false;
}

async function extractPartNumber(page) {
  const supersessionSection = page
    .locator(
      ':is(section, div, article):has(:text-matches("Supersession","i")), :is(section, div, article)[class*="supersession" i]'
    )
    .first();

  if ((await supersessionSection.count()) > 0) {
    const supersessionPart = supersessionSection
      .locator(':text("Part no."), :text-matches("Part no\\.","i")')
      .locator('xpath=following::*[self::span or self::div or self::td][normalize-space()][1]')
      .first();

    if ((await supersessionPart.count()) > 0) {
      const value = (await supersessionPart.innerText()).trim();
      if (value) {
        return { resultCode: value, supersession: true };
      }
    }
  }

  const mainPart = page
    .locator(':text("Part no."), :text-matches("Part no\\.","i")')
    .locator('xpath=following::*[self::span or self::div or self::td][normalize-space()][1]')
    .first();

  if ((await mainPart.count()) > 0) {
    const value = (await mainPart.innerText()).trim();
    if (value) {
      return { resultCode: value, supersession: false };
    }
  }

  return null;
}

function extractLabeledValue(text, label) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const matcher = new RegExp(`^${escapeRegex(label)}\\.?$`, "i");
  const index = lines.findIndex((line) => matcher.test(line));
  return index >= 0 && lines[index + 1] ? lines[index + 1] : "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXPathText(value) {
  if (!value) {
    return "";
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  if (!value.includes("'")) {
    return `'${value}'`;
  }

  return `concat("${value.split('"').join('", \'"\', "')}")`;
}

async function waitForDetailsPane(page, timeout) {
  const details = page.locator(
    'xpath=//*[contains(normalize-space(), "Part information") or contains(normalize-space(), "Illustration")]'
  ).first();
  await details.waitFor({ state: "visible", timeout });
}

async function waitForSelectionPage(page, expectedPartNumber, timeout) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const detailsVisible = await page.locator(
      'xpath=//*[contains(normalize-space(), "Part information") or contains(normalize-space(), "Illustration")]'
    ).first().isVisible().catch(() => false);
    if (detailsVisible) {
      return true;
    }

    const expectedVisible = expectedPartNumber
      ? await page.locator(`text=${expectedPartNumber}`).first().isVisible().catch(() => false)
      : false;
    if (expectedVisible && !page.url().includes("/search?q=")) {
      return true;
    }

    const loading = await findSearchPanel(page).locator('xpath=.//*[contains(normalize-space(), "Part no.")]').count().catch(() => 0);
    if (!loading && page.url().includes("/bom")) {
      await page.waitForTimeout(750).catch(() => {});
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return false;
}

module.exports = {
  extractSelectionResult,
  extractPartNumber,
  findPartInfoButton,
  findPartSearchInput,
  findVinInput,
  getResultRows,
  matchesVariant,
  openPartSearch,
  returnToHome,
  selectResultRow,
  submitPartSearch,
  waitForVinIdentification,
  shouldReturnListWithoutSelection
};
