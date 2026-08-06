"use strict";

const schema = require("./contentStudioPortfolioSchema");
const store = require("./contentStudioPortfolioStore");
const draftWorkflow = require("./contentStudioPortfolioDraftWorkflow");
const reviewWorkflow = require("./contentStudioPortfolioReviewWorkflow");
const publishWorkflow = require("./contentStudioPortfolioPublishWorkflow");

module.exports = {
  ...schema,
  ...store,
  ...draftWorkflow,
  ...reviewWorkflow,
  ...publishWorkflow,
};
