"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  getPublicBootstrap,
  getPublicDivisionBySlug,
  getPublicEquipmentBySlug,
  getPublicFormBySlug,
  getPublicNewsBySlug,
  getPublicPageBySlug,
  getPublicProjectBySlug,
  getPublicTenderBySlug,
  getPublicVacancyBySlug,
  listPublicDivisions,
  listPublicEquipment,
  listPublicFaqs,
  listPublicLeadership,
  listPublicLocations,
  listPublicNews,
  listPublicProjects,
  listPublicTenders,
  listPublicVacancies,
} = require("../services/publicContentService");
const {
  getPublicHomepage,
} = require("../services/publicHomepageService");
const {
  PublicSubmissionValidationError,
  createPublicFormSubmission,
} = require("../services/publicFormSubmissionService");
const {
  listPublicTestimonials,
} = require("../services/publicTestimonialService");

const router = express.Router();

const PUBLIC_READ_RATE_LIMIT_MAX = Math.max(
  60,
  Number(process.env.PUBLIC_CONTENT_READ_RATE_LIMIT_MAX) || 600
);
const PUBLIC_SUBMISSION_RATE_LIMIT_MAX = Math.max(
  2,
  Number(process.env.PUBLIC_FORM_SUBMISSION_RATE_LIMIT_MAX) || 12
);

const publicReadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: PUBLIC_READ_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PUBLIC_CONTENT_RATE_LIMITED",
    message: "Too many website requests. Please wait briefly and try again.",
  },
});

const publicSubmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PUBLIC_SUBMISSION_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    status: "error",
    code: "PUBLIC_FORM_RATE_LIMITED",
    message: "Too many form submissions. Please wait before trying again.",
  },
});

function applyPublicReadLimiter(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") {
    return publicReadLimiter(req, res, next);
  }

  return next();
}

function setPublicCache(res, seconds = 60) {
  const safeSeconds = Math.max(0, Math.min(Number(seconds) || 0, 600));
  res.set(
    "Cache-Control",
    `public, max-age=${safeSeconds}, stale-while-revalidate=300`
  );
}

function setPrivateNoStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
}

function success(res, req, data, options = {}) {
  if (options.cacheSeconds !== undefined) {
    setPublicCache(res, options.cacheSeconds);
  }

  return res.status(options.statusCode || 200).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

function notFound(res, req, resourceName) {
  setPrivateNoStore(res);
  return res.status(404).json({
    status: "error",
    code: "PUBLIC_CONTENT_NOT_FOUND",
    message: `${resourceName} was not found or is not currently published.`,
    request_id: req.requestId || null,
  });
}

function sendPublicError(res, req, error) {
  setPrivateNoStore(res);

  if (error instanceof PublicSubmissionValidationError) {
    return res.status(400).json({
      status: "error",
      code: error.code,
      message: error.message,
      details: error.details || [],
      request_id: req.requestId || null,
    });
  }

  if (
    error?.code === "PUBLIC_CONTENT_SCHEMA_NOT_READY" ||
    error?.code === "PUBLIC_FORM_SECURITY_NOT_CONFIGURED"
  ) {
    return res.status(Number(error.statusCode) || 503).json({
      status: "error",
      code: error.code,
      message: error.message,
      request_id: req.requestId || null,
    });
  }

  console.error("Public content route error:", {
    requestId: req.requestId || null,
    path: req.originalUrl,
    code: error?.code || null,
    message: error?.message || "Unknown error",
  });

  return res.status(500).json({
    status: "error",
    code: "PUBLIC_CONTENT_REQUEST_FAILED",
    message: "The website information could not be loaded safely.",
    request_id: req.requestId || null,
  });
}

router.use(applyPublicReadLimiter);

router.get("/bootstrap", async (req, res) => {
  try {
    return success(res, req, await getPublicBootstrap(), {
      cacheSeconds: 60,
    });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/homepage", async (req, res) => {
  try {
    const page = await getPublicHomepage();
    if (!page) return notFound(res, req, "Homepage");
    return success(res, req, page, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/pages/:slug", async (req, res) => {
  try {
    const page = await getPublicPageBySlug(req.params.slug);
    if (!page) return notFound(res, req, "Page");
    return success(res, req, page, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/news", async (req, res) => {
  try {
    const result = await listPublicNews({
      limit: req.query.limit,
      offset: req.query.offset,
      categorySlug: req.query.category,
    });
    return success(res, req, result, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/news/:slug", async (req, res) => {
  try {
    const article = await getPublicNewsBySlug(req.params.slug);
    if (!article) return notFound(res, req, "News article");
    return success(res, req, article, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/divisions", async (req, res) => {
  try {
    return success(res, req, await listPublicDivisions(), {
      cacheSeconds: 120,
    });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/divisions/:slug", async (req, res) => {
  try {
    const division = await getPublicDivisionBySlug(req.params.slug);
    if (!division) return notFound(res, req, "Business division");
    return success(res, req, division, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/leadership", async (req, res) => {
  try {
    return success(res, req, await listPublicLeadership(), {
      cacheSeconds: 120,
    });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/testimonials", async (req, res) => {
  try {
    return success(
      res,
      req,
      await listPublicTestimonials({ limit: req.query.limit }),
      { cacheSeconds: 120 }
    );
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/projects", async (req, res) => {
  try {
    const result = await listPublicProjects({
      limit: req.query.limit,
      offset: req.query.offset,
      divisionSlug: req.query.division,
      status: req.query.status,
    });
    return success(res, req, result, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/projects/:slug", async (req, res) => {
  try {
    const project = await getPublicProjectBySlug(req.params.slug);
    if (!project) return notFound(res, req, "Project");
    return success(res, req, project, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/equipment", async (req, res) => {
  try {
    const result = await listPublicEquipment({
      limit: req.query.limit,
      offset: req.query.offset,
      divisionSlug: req.query.division,
      availability: req.query.availability,
      hireAvailable: req.query.hire_available,
      financeAvailable: req.query.finance_available,
      search: req.query.search,
    });
    return success(res, req, result, { cacheSeconds: 45 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/equipment/:slug", async (req, res) => {
  try {
    const equipment = await getPublicEquipmentBySlug(req.params.slug);
    if (!equipment) return notFound(res, req, "Equipment");
    return success(res, req, equipment, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/locations", async (req, res) => {
  try {
    const locations = await listPublicLocations({
      divisionSlug: req.query.division,
    });
    return success(res, req, locations, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/faqs", async (req, res) => {
  try {
    const faqs = await listPublicFaqs({ category: req.query.category });
    return success(res, req, faqs, { cacheSeconds: 120 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/vacancies", async (req, res) => {
  try {
    const result = await listPublicVacancies({
      limit: req.query.limit,
      offset: req.query.offset,
      divisionSlug: req.query.division,
    });
    return success(res, req, result, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/vacancies/:slug", async (req, res) => {
  try {
    const vacancy = await getPublicVacancyBySlug(req.params.slug);
    if (!vacancy) return notFound(res, req, "Vacancy");
    return success(res, req, vacancy, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/tenders", async (req, res) => {
  try {
    const result = await listPublicTenders({
      limit: req.query.limit,
      offset: req.query.offset,
      divisionSlug: req.query.division,
    });
    return success(res, req, result, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/tenders/:slug", async (req, res) => {
  try {
    const tender = await getPublicTenderBySlug(req.params.slug);
    if (!tender) return notFound(res, req, "Tender");
    return success(res, req, tender, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.get("/forms/:slug", async (req, res) => {
  try {
    const form = await getPublicFormBySlug(req.params.slug);
    if (!form) return notFound(res, req, "Form");
    return success(res, req, form, { cacheSeconds: 60 });
  } catch (error) {
    return sendPublicError(res, req, error);
  }
});

router.post(
  "/forms/:slug/submissions",
  publicSubmissionLimiter,
  async (req, res) => {
    setPrivateNoStore(res);

    try {
      const result = await createPublicFormSubmission({
        formSlug: req.params.slug,
        payload: req.body,
        requestContext: {
          ip: req.ip,
          userAgent: req.get("user-agent"),
          requestId: req.requestId || null,
        },
      });

      if (!result) return notFound(res, req, "Form");
      return success(res, req, result, { statusCode: 202 });
    } catch (error) {
      return sendPublicError(res, req, error);
    }
  }
);

router.PUBLIC_READ_RATE_LIMIT_MAX = PUBLIC_READ_RATE_LIMIT_MAX;
router.PUBLIC_SUBMISSION_RATE_LIMIT_MAX = PUBLIC_SUBMISSION_RATE_LIMIT_MAX;
router.applyPublicReadLimiter = applyPublicReadLimiter;
router.publicReadLimiter = publicReadLimiter;
router.publicSubmissionLimiter = publicSubmissionLimiter;
router.sendPublicError = sendPublicError;
router.setPublicCache = setPublicCache;

module.exports = router;
