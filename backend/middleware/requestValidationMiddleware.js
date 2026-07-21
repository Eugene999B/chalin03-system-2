function validateRequest(validator) {
  if (typeof validator !== "function") {
    throw new TypeError("A request validator function is required.");
  }

  return function requestValidationMiddleware(req, res, next) {
    const result = validator({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!result || result.ok !== true) {
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      const firstMessage = errors[0]?.message || "The request contains invalid data.";

      return res.status(400).json({
        status: "error",
        code: "REQUEST_VALIDATION_FAILED",
        message: firstMessage,
        validation_errors: errors,
      });
    }

    req.validated = {
      ...(req.validated || {}),
      ...(result.value || {}),
    };

    return next();
  };
}

module.exports = {
  validateRequest,
};
