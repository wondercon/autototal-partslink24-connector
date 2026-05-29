async function matchesVariant(page) {
  const probes = [
    "frame",
    "frameset",
    "table table",
    'input[name*="vin" i]',
    'form table input[type="text"]'
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
      'input[name*="vin" i], input[id*="vin" i], td input[type="text"][maxlength], form input[type="text"]'
    )
    .first();
}

function findPartSearchInput(page) {
  return findSearchDialog(page)
    .locator('input:not([type]), input[type="text"]')
    .first();
}

function findSearchDialog(page) {
  return page
    .locator(
      'xpath=(//*[contains(normalize-space(), "partslink24 - Search")]/ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ui-dialog ")][1])[last()]'
    )
    .first();
}

async function openPartSearch(page, env) {
  const searchAction = page
    .locator('a:has-text("Search"), button:has-text("Search"), input[value="Search"], [title="Search"]')
    .first();

  if ((await searchAction.count().catch(() => 0)) < 1) {
    return;
  }

  await searchAction.click({ timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
}

async function returnToHome(page, env) {
  const portalLink = page
    .locator('a:has-text("Portal"), button:has-text("Portal"), input[value="Portal"], [title="Portal"]')
    .first();

  if ((await portalLink.count().catch(() => 0)) < 1) {
    return false;
  }

  await portalLink.click({ timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  return true;
}

async function submitPartSearch(page, _partInput, env) {
  const goButton = findSearchDialog(page)
    .locator('input[value="GO"], button:has-text("GO")')
    .first();
  const initialTimeoutMs = Math.min(env.NAV_TIMEOUT_MS, 1500);
  const fallbackTimeoutMs = Math.min(env.NAV_TIMEOUT_MS, 3000);

  // Volvo's legacy search popup updates in-place; try keyboard submit first,
  // then a direct DOM/button click if the result table did not appear.
  await _partInput.press("Enter", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  if (await waitForResultTable(page, initialTimeoutMs).catch(() => false)) {
    return {
      handled: true,
      action: "enter",
      resultsDetected: true
    };
  }

  if ((await goButton.count().catch(() => 0)) > 0) {
    await goButton.evaluate((node) => node.click()).catch(async () => {
      await goButton.click({ timeout: env.NAV_TIMEOUT_MS, force: true }).catch(() => {});
    });
    const resultsDetected = await waitForResultTable(page, fallbackTimeoutMs).catch(() => false);
    return {
      handled: true,
      action: "go_click",
      resultsDetected
    };
  }

  return {
    handled: false,
    action: "none",
    resultsDetected: false
  };
}

function shouldReturnListWithoutSelection() {
  return true;
}

async function getResultRows(page) {
  const searchDialog = findSearchDialog(page);
  const rowLocator = searchDialog.locator("tr");
  const count = await rowLocator.count();
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const locator = rowLocator.nth(index);
    const cells = locator.locator("td");
    const cellCount = await cells.count().catch(() => 0);
    if (cellCount < 2) {
      continue;
    }

    const partNumber = ((await cells.nth(0).innerText().catch(() => "")) || "").trim();
    if (!/^\d{5,}$/.test(partNumber)) {
      continue;
    }

    const rowText = (await locator.innerText().catch(() => "")).trim();
    if (!rowText) {
      continue;
    }

    rows.push({ description: partNumber, rowText, locator });
  }

  if (rows.length > 0) {
    return rows;
  }

  const dialogText = (await searchDialog.innerText().catch(() => "")).trim();
  if (!dialogText) {
    return rows;
  }

  return parseRowsFromDialogText(dialogText, searchDialog);
}

function parseRowsFromDialogText(dialogText, searchDialog) {
  const lines = dialogText.split("\n").map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /PART\s*NUMBER/i.test(line) && /DESCRIPTION/i.test(line));
  if (headerIndex < 0) {
    return [];
  }

  const rows = [];
  const partNumberSeen = new Map();

  for (let index = headerIndex + 1; index + 3 < lines.length; index += 4) {
    const partNumber = lines[index];
    const description = lines[index + 1];
    const illustration = lines[index + 2];
    const rel = lines[index + 3];

    if (!/^\d{5,}$/.test(partNumber)) {
      break;
    }

    const occurrence = partNumberSeen.get(partNumber) || 0;
    partNumberSeen.set(partNumber, occurrence + 1);

    rows.push({
      description: partNumber,
      rowText: `${partNumber}\t${description}\t${illustration}\t${rel}`,
      locator: searchDialog.locator(`xpath=.//*[normalize-space()="${partNumber}"]`).nth(occurrence)
    });
  }

  return rows;
}

function findPartInfoButton(_row, page) {
  return (page || _row)
    .locator(
      'button:has-text("Part information"), a:has-text("Part information"), input[value*="Part information" i], [title*="Part information" i]'
    )
    .first();
}

async function selectResultRow(selectedRow, page, env) {
  const row = selectedRow?.locator || selectedRow;
  const clickable = row
    .locator('a, input[type="button"], input[type="submit"], button, td')
    .first();

  if ((await clickable.count().catch(() => 0)) > 0) {
    await clickable.click({ timeout: env.NAV_TIMEOUT_MS }).catch(async () => {
      await row.click({ timeout: env.NAV_TIMEOUT_MS });
    });
  } else {
    await row.click({ timeout: env.NAV_TIMEOUT_MS });
  }

  await page.waitForLoadState("domcontentloaded", { timeout: env.NAV_TIMEOUT_MS }).catch(() => {});
  return false;
}

async function extractPartNumber(page) {
  try {
    const currentUrl = new URL(page.url());
    const partno = (currentUrl.searchParams.get("partno") || "").trim();
    if (/^\d{5,}$/.test(partno)) {
      return { resultCode: partno, supersession: false };
    }
  } catch {}

  const supersessionBlock = page
    .locator(
      ':is(table, div, td):has(:text-matches("Supersession","i")), :is(table, div, td)[class*="supersession" i]'
    )
    .first();

  if ((await supersessionBlock.count()) > 0) {
    const supersessionValue = locatePartNumberValue(supersessionBlock);

    if ((await supersessionValue.count()) > 0) {
      const value = (await supersessionValue.innerText()).trim();
      if (value) {
        return { resultCode: value, supersession: true };
      }
    }
  }

  const mainValue = locatePartNumberValue(page);

  if ((await mainValue.count()) > 0) {
    const value = (await mainValue.innerText()).trim();
    if (value) {
      return { resultCode: value, supersession: false };
    }
  }

  return null;
}

function locatePartNumberValue(scope) {
  return scope
    .locator(':text("Part no."), :text-matches("Part no\\.","i"), :text("PART NUMBER"), :text-matches("PART NUMBER","i")')
    .locator("xpath=following::td[normalize-space()][1]")
    .first();
}

async function waitForResultTable(page, timeout) {
  const startedAt = Date.now();
  const searchDialog = findSearchDialog(page);

  while (Date.now() - startedAt < timeout) {
    const rows = await getResultRows(page).catch(() => []);
    if (rows.length > 0) {
      return true;
    }

    const dialogText = (await searchDialog.innerText().catch(() => "")).trim();
    if (parseRowsFromDialogText(dialogText, searchDialog).length > 0) {
      return true;
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return false;
}

module.exports = {
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
  shouldReturnListWithoutSelection
};
