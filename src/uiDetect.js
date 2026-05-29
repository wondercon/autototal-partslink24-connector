const newUi = require("./ui/new");
const oldUi = require("./ui/old");

async function detectUiVariant(page) {
  if (await newUi.matchesVariant(page)) {
    return "new";
  }

  if (await oldUi.matchesVariant(page)) {
    return "old";
  }

  return null;
}

module.exports = { detectUiVariant };
