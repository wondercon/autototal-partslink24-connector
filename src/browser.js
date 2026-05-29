const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

let browserPromise;
let warmSessionPromise;
let sessionLock = Promise.resolve();

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function initBrowser(env) {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: env.HEADLESS,
      timeout: env.NAV_TIMEOUT_MS
    });
  }

  return browserPromise;
}

async function readStorageState(storageStatePath) {
  try {
    await fs.access(storageStatePath);
    return storageStatePath;
  } catch {
    return undefined;
  }
}

async function newContext(env) {
  const browser = await initBrowser(env);
  const storageState = await readStorageState(env.STORAGE_STATE_PATH);
  const context = await browser.newContext({
    storageState,
    userAgent: DESKTOP_USER_AGENT,
    viewport: { width: 1400, height: 900 }
  });

  context.setDefaultTimeout(env.NAV_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(env.NAV_TIMEOUT_MS);

  const page = await context.newPage();
  page.setDefaultTimeout(env.NAV_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(env.NAV_TIMEOUT_MS);

  return { browser, context, page };
}

function isPageUsable(page) {
  return Boolean(page) && !page.isClosed();
}

async function createWarmSession(env) {
  const { browser, context, page } = await newContext(env);
  return { browser, context, page };
}

async function getWarmSession(env) {
  if (!warmSessionPromise) {
    warmSessionPromise = createWarmSession(env).catch((error) => {
      warmSessionPromise = undefined;
      throw error;
    });
  }

  const session = await warmSessionPromise;
  if (!isPageUsable(session.page)) {
    warmSessionPromise = undefined;
    return getWarmSession(env);
  }

  return session;
}

async function resetWarmSession(env) {
  if (!warmSessionPromise) {
    return getWarmSession(env);
  }

  const currentPromise = warmSessionPromise;
  warmSessionPromise = undefined;
  const current = await currentPromise.catch(() => null);
  if (current?.context) {
    await current.context.close().catch(() => {});
  }

  return getWarmSession(env);
}

async function acquireSession(env) {
  let releaseLock;
  const previousLock = sessionLock;
  sessionLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  await previousLock;

  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    releaseLock();
  };

  try {
    const session = await getWarmSession(env);
    return {
      ...session,
      release,
      reset: async () => resetWarmSession(env)
    };
  } catch (error) {
    release();
    throw error;
  }
}

async function persistStorageState(context, env) {
  const targetPath = path.resolve(env.STORAGE_STATE_PATH);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await context.storageState({ path: targetPath });
}

async function closeBrowser() {
  if (!browserPromise) {
    return;
  }

  if (warmSessionPromise) {
    const session = await warmSessionPromise.catch(() => null);
    warmSessionPromise = undefined;
    await session?.context?.close().catch(() => {});
  }

  const browser = await browserPromise;
  browserPromise = undefined;
  await browser.close();
}

module.exports = {
  acquireSession,
  closeBrowser,
  initBrowser,
  newContext,
  persistStorageState
};
