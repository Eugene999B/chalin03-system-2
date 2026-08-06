"use strict";

module.exports = {
  ...require("./contentStudioNewsroomSchema"),
  ...require("./contentStudioNewsroomStore"),
  ...require("./contentStudioNewsroomDraftWorkflow"),
  ...require("./contentStudioNewsroomReviewWorkflow"),
  ...require("./contentStudioNewsroomPublishWorkflow"),
  ...require("./contentStudioNewsCategoryService"),
};
