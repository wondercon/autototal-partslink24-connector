const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const pino = require("pino");
const { createApp, parseEnv } = require("../src/index");
const { createPartslink24Service } = require("../src/partslink24");
const { buildEvidence } = require("../src/evidence");

function createLogger() {
  return pino({ enabled: false });
}

function createEnv(overrides = {}) {
  return {
    ...parseEnv({
      PARTSLINK24_COMPANY_ID: "x",
      PARTSLINK24_USERNAME: "y",
      PARTSLINK24_PASSWORD: "z",
      HEADLESS: "true",
      SCREENSHOT_DIR: "/tmp/partslink24-connector-test",
      STORAGE_STATE_PATH: "/tmp/partslink24-connector-test/state.json",
      ...overrides
    })
  };
}

async function startTestServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    url: `http://127.0.0.1:${address.port}`
  };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    json: await response.json()
  };
}

function createMockLocator(overrides = {}) {
  return {
    async click() {},
    async count() {
      return overrides.count ?? 1;
    },
    async fill() {},
    async innerText() {
      return overrides.innerText ?? "";
    },
    locator() {
      return createMockLocator(overrides.nested || {});
    },
    async press() {},
    async waitFor() {},
    first() {
      return this;
    }
  };
}

function createMockPage() {
  let currentUrl = "https://www.partslink24.com/partslink24/user/login.do";
  let currentTitle = "Part information";
  const brandLocator = createMockLocator();
  const page = {
    async goto(url) {
      currentUrl = url;
    },
    getByRole(role) {
      if (role === "link") {
        return brandLocator;
      }

      return createMockLocator({ count: 0 });
    },
    getByText() {
      return createMockLocator({ count: 0 });
    },
    locator() {
      return createMockLocator({ count: 1 });
    },
    async screenshot() {},
    async title() {
      return currentTitle;
    },
    url() {
      return currentUrl;
    },
    async waitForLoadState() {}
  };

  return { page, setTitle: (title) => { currentTitle = title; } };
}

function createBrowserApi(page) {
  return {
    async newContext() {
      return {
        context: {
          async close() {},
          async storageState() {}
        },
        page
      };
    },
    async persistStorageState() {}
  };
}

function createRow(description, rowText) {
  return {
    description,
    locator: createMockLocator(),
    rowText
  };
}

test("missing required field: vin", async () => {
  const { app } = createApp({
    env: createEnv(),
    logger: createLogger(),
    searchService: async () => assert.fail("searchService should not be called")
  });
  const server = await startTestServer(app);
  const response = await postJson(`${server.url}/search`, {
    platformName: "partslink24",
    filters: { brand: "Brand", partName: "Query" }
  });
  await server.close();

  assert.equal(response.status, 200);
  assert.equal(response.json.errorCode, "MISSING_REQUIRED_PARAM");
  assert.equal(response.json.errorMessage, "vin");
});

test("missing required field: filters.brand", async () => {
  const { app } = createApp({
    env: createEnv(),
    logger: createLogger(),
    searchService: async () => assert.fail("searchService should not be called")
  });
  const server = await startTestServer(app);
  const response = await postJson(`${server.url}/search`, {
    platformName: "partslink24",
    vin: "WBA12345678901234",
    filters: { partName: "Query" }
  });
  await server.close();

  assert.equal(response.json.errorCode, "MISSING_REQUIRED_PARAM");
  assert.equal(response.json.errorMessage, "filters.brand");
});

test("missing required field: filters.partName", async () => {
  const { app } = createApp({
    env: createEnv(),
    logger: createLogger(),
    searchService: async () => assert.fail("searchService should not be called")
  });
  const server = await startTestServer(app);
  const response = await postJson(`${server.url}/search`, {
    platformName: "partslink24",
    vin: "WBA12345678901234",
    filters: { brand: "Brand" }
  });
  await server.close();

  assert.equal(response.json.errorCode, "MISSING_REQUIRED_PARAM");
  assert.equal(response.json.errorMessage, "filters.partName");
});

test("bearer auth returns 401 when token is missing", async () => {
  const { app } = createApp({
    env: createEnv({ CONNECTOR_BEARER_TOKEN: "secret-token" }),
    logger: createLogger(),
    searchService: async () => assert.fail("searchService should not be called")
  });
  const server = await startTestServer(app);
  const response = await postJson(`${server.url}/search`, {
    platformName: "partslink24",
    vin: "WBA12345678901234",
    filters: { brand: "Brand", partName: "Query" }
  });
  await server.close();

  assert.equal(response.status, 401);
  assert.equal(response.json.errorCode, "UNAUTHORIZED");
});

test("happy path with mocked new adapter returns single part number", async () => {
  const { page } = createMockPage();
  const adapter = {
    async extractPartNumber() {
      return { resultCode: "34 11 6 850 123", supersession: false };
    },
    findPartInfoButton() {
      return createMockLocator();
    },
    findPartSearchInput() {
      return createMockLocator();
    },
    findVinInput() {
      return createMockLocator();
    },
    async getResultRows() {
      return [createRow("single description", "single description full row")];
    }
  };
  const service = createPartslink24Service({
    adapters: { new: adapter, old: adapter },
    async buildEvidence(_page, _env, _label, uiVariant) {
      return {
        pageTitle: "Part information",
        pageUrl: "https://www.partslink24.com/example",
        screenshotUrl: "file:///tmp/single.png",
        timestamp: "2026-05-20T10:00:00.000Z",
        uiVariant
      };
    },
    async detectUiVariant() {
      return "new";
    }
  });

  const result = await service({
    browserApi: createBrowserApi(page),
    env: createEnv(),
    logger: createLogger(),
    request: {
      allowAmbiguousResults: false,
      filters: { brand: "Brand", partName: "Query" },
      platformName: "partslink24",
      vin: "WBA12345678901234"
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.resultCode, "34 11 6 850 123");
  assert.equal(result.supersession, false);
  assert.equal(result.confidence, 0.7);
  assert.equal(result.evidence.uiVariant, "new");
});

test("happy path with mocked old adapter prefers supersession part number", async () => {
  const { page } = createMockPage();
  const adapter = {
    async extractPartNumber() {
      return { resultCode: "1K0 698 451 R", supersession: true };
    },
    findPartInfoButton() {
      return createMockLocator();
    },
    findPartSearchInput() {
      return createMockLocator();
    },
    findVinInput() {
      return createMockLocator();
    },
    async getResultRows() {
      return [createRow("selected description", "selected description full row")];
    }
  };
  const service = createPartslink24Service({
    adapters: { new: adapter, old: adapter },
    async buildEvidence(_page, _env, _label, uiVariant) {
      return {
        pageTitle: "Part information",
        pageUrl: "https://www.partslink24.com/example-old",
        screenshotUrl: "file:///tmp/single-old.png",
        timestamp: "2026-05-20T10:00:00.000Z",
        uiVariant
      };
    },
    async detectUiVariant() {
      return "old";
    }
  });

  const result = await service({
    browserApi: createBrowserApi(page),
    env: createEnv(),
    logger: createLogger(),
    request: {
      allowAmbiguousResults: false,
      filters: { brand: "Brand", partName: "Query" },
      platformName: "partslink24",
      vin: "WBA12345678901234"
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.resultCode, "1K0 698 451 R");
  assert.equal(result.supersession, true);
  assert.equal(result.evidence.uiVariant, "old");
});

test("ambiguous results return matches[] without resultCode", async () => {
  const { page } = createMockPage();
  const adapter = {
    async extractPartNumber() {
      assert.fail("extractPartNumber should not be called");
    },
    findPartInfoButton() {
      return createMockLocator();
    },
    findPartSearchInput() {
      return createMockLocator();
    },
    findVinInput() {
      return createMockLocator();
    },
    async getResultRows() {
      return [
        createRow("first option", "first option full row"),
        createRow("second option", "second option full row")
      ];
    }
  };
  const service = createPartslink24Service({
    adapters: { new: adapter, old: adapter },
    async buildEvidence(_page, _env, _label, uiVariant) {
      return {
        pageTitle: "Results",
        pageUrl: "https://www.partslink24.com/results",
        screenshotUrl: "file:///tmp/ambiguous.png",
        timestamp: "2026-05-20T10:00:00.000Z",
        uiVariant
      };
    },
    async detectUiVariant() {
      return "new";
    }
  });

  const result = await service({
    browserApi: createBrowserApi(page),
    env: createEnv(),
    logger: createLogger(),
    request: {
      allowAmbiguousResults: false,
      filters: { brand: "Brand", partName: "Query" },
      platformName: "partslink24",
      vin: "WBA12345678901234"
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.found, true);
  assert.ok(Array.isArray(result.matches));
  assert.equal(result.matches.length, 2);
  assert.equal("resultCode" in result, false);
});

test("new ui returns matches[] first when partSelection is omitted", async () => {
  const { page } = createMockPage();
  const adapter = {
    async extractPartNumber() {
      assert.fail("extractPartNumber should not be called");
    },
    findPartInfoButton() {
      return createMockLocator();
    },
    findPartSearchInput() {
      return createMockLocator();
    },
    findVinInput() {
      return createMockLocator();
    },
    async getResultRows() {
      return [createRow("single description", "single description full row")];
    },
    async openPartSearch() {},
    shouldReturnListWithoutSelection() {
      return true;
    }
  };
  const service = createPartslink24Service({
    adapters: { new: adapter, old: adapter },
    async buildEvidence(_page, _env, _label, uiVariant) {
      return {
        pageTitle: "Results",
        pageUrl: "https://www.partslink24.com/results",
        screenshotUrl: "file:///tmp/list-first.png",
        timestamp: "2026-05-20T10:00:00.000Z",
        uiVariant
      };
    },
    async detectUiVariant() {
      return "new";
    }
  });

  const result = await service({
    browserApi: createBrowserApi(page),
    env: createEnv(),
    logger: createLogger(),
    request: {
      allowAmbiguousResults: false,
      filters: { brand: "Brand", partName: "Query" },
      platformName: "partslink24",
      vin: "WBA12345678901234"
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.found, true);
  assert.ok(Array.isArray(result.matches));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].resultLabel, "single description");
  assert.equal("resultCode" in result, false);
});

test("new ui second-call selection returns part description from adapter-specific extraction", async () => {
  const { page } = createMockPage();
  const adapter = {
    async extractPartNumber() {
      assert.fail("extractPartNumber should not be called when extractSelectionResult succeeds");
    },
    async extractSelectionResult() {
      return {
        resultCode: "6R0 698 151 A",
        resultLabel: "6R0 698 151 A",
        resultDescription: "1 set of brake pads for disk brake",
        resultType: "part_description",
        rawText: "Part information\nPart no.\n6R0 698 151 A\nDescription\n1 set of brake pads for disk brake"
      };
    },
    findPartInfoButton() {
      return createMockLocator();
    },
    findPartSearchInput() {
      return createMockLocator();
    },
    findVinInput() {
      return createMockLocator();
    },
    async getResultRows() {
      return [{
        description: "6R0 698 151 A",
        resultDescription: "1 set of brake pads for disk brake",
        locator: createMockLocator(),
        rowText: "6R0 698 151 A\n1 set of brake pads for disk brake"
      }];
    },
    async openPartSearch() {},
    async selectResultRow() {
      return true;
    },
    shouldReturnListWithoutSelection() {
      return true;
    }
  };
  const service = createPartslink24Service({
    adapters: { new: adapter, old: adapter },
    async buildEvidence(_page, _env, _label, uiVariant) {
      return {
        pageTitle: "Volkswagen",
        pageUrl: "https://www.partslink24.com/results",
        screenshotUrl: "file:///tmp/selected-description.png",
        timestamp: "2026-05-21T13:00:00.000Z",
        uiVariant
      };
    },
    async detectUiVariant() {
      return "new";
    }
  });

  const result = await service({
    browserApi: createBrowserApi(page),
    env: createEnv(),
    logger: createLogger(),
    request: {
      allowAmbiguousResults: false,
      filters: { brand: "Brand", partName: "Query", partSelection: "6R0 698 151 A" },
      platformName: "partslink24",
      vin: "WVWZZZ6RZFY103906"
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.found, true);
  assert.equal(result.resultCode, "6R0 698 151 A");
  assert.equal(result.resultLabel, "6R0 698 151 A");
  assert.equal(result.resultDescription, "1 set of brake pads for disk brake");
  assert.equal(result.resultType, "part_description");
  assert.equal(result.evidence.uiVariant, "new");
});

test("buildEvidence names screenshots with brand vin partName and sequence", async () => {
  const screenshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "partslink24-evidence-"));
  const page = {
    async screenshot({ path: targetPath }) {
      await fs.writeFile(targetPath, "test");
    },
    async title() {
      return "Results";
    },
    url() {
      return "https://www.partslink24.com/results";
    }
  };

  const evidence = await buildEvidence(
    page,
    { NAV_TIMEOUT_MS: 1000, SCREENSHOT_DIR: screenshotDir },
    "part-list",
    "new",
    {
      vin: "WVWZZZ6RZFY103906",
      filters: {
        brand: "VOLKSWAGEN",
        partName: "brake pads"
      }
    },
    1
  );

  const fileName = path.basename(new URL(evidence.screenshotUrl).pathname);
  assert.equal(fileName, "VOLKSWAGEN_WVWZZZ6RZFY103906_brake_pads_01.png");

  const evidence2 = await buildEvidence(
    page,
    { NAV_TIMEOUT_MS: 1000, SCREENSHOT_DIR: screenshotDir },
    "single-match",
    "new",
    {
      vin: "WVWZZZ6RZFY103906",
      filters: {
        brand: "VOLKSWAGEN",
        partName: "brake pads"
      }
    },
    1
  );

  const fileName2 = path.basename(new URL(evidence2.screenshotUrl).pathname);
  assert.equal(fileName2, "VOLKSWAGEN_WVWZZZ6RZFY103906_brake_pads_02.png");
});
