# Equipment Sales Routing Architecture

## Purpose

Equipment Sales is intentionally exposed as a protected sub-router of the shared Equipment Catalogue API. The absence of a direct `server.js` import for `equipmentSalesRoutes.js` does **not** mean the router is dead code.

## Live request chain

```text
EquipmentSalesWorkspacePage / EquipmentSalesReportsPage
        ↓
/api/equipment-catalogue/sales/...
        ↓
server.js
  /api/equipment-catalogue
  requireAuth
  hireBoundary
  enforceEquipmentCatalogueWriteIntegrity
  equipmentCatalogueRoutes
        ↓
equipmentCatalogueIntegrityMiddleware.js
  detects /^\/sales/
  verifies Equipment Sales schema readiness
  removes the /sales prefix
  dispatches equipmentSalesRoutes.js
        ↓
equipmentSalesSchemaService.js
  attaches equipmentSalesFinalizationRoutes.js once
```

## Why the indirection exists

- Equipment Sales and Hire share one protected equipment catalogue.
- The catalogue middleware coordinates sale and Hire integrity before ordinary catalogue writes.
- Sales requests reuse the authenticated Equipment Sales & Hire workspace and location boundary.
- Finalization, document and management-report endpoints extend the core sales router without creating a second public mount.

## Maintenance rules

1. Do not delete `equipmentSalesRoutes.js` or `equipmentSalesFinalizationRoutes.js` merely because `server.js` does not import them directly.
2. Do not add a second direct mount without a complete route-conflict, authentication, permission and location-scope review.
3. Preserve the `/api/equipment-catalogue/sales` frontend contract.
4. Preserve read-only schema readiness and fail-closed behaviour.
5. Run `backend/tests/equipmentSalesReachabilityContract.test.js` and the complete backend suite after routing changes.
6. Register a physical machine once in the shared catalogue; sale and Hire controls must continue to coordinate through the same asset record.

## Canonical files

- `backend/server.js`
- `backend/middleware/equipmentCatalogueIntegrityMiddleware.js`
- `backend/services/equipmentSalesSchemaService.js`
- `backend/routes/equipmentSalesRoutes.js`
- `backend/routes/equipmentSalesFinalizationRoutes.js`
- `frontend/src/pages/EquipmentSalesWorkspacePage.jsx`
- `frontend/src/pages/EquipmentSalesReportsPage.jsx`
