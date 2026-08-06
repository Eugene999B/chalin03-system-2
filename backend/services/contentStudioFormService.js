"use strict";

module.exports = {
  ...require("./contentStudioFormSchema"),
  ...require("./contentStudioFormStore"),
  ...require("./contentStudioFormDraftWorkflow"),
  ...require("./contentStudioFormReviewWorkflow"),
  ...require("./contentStudioFormPublishWorkflow"),
};
