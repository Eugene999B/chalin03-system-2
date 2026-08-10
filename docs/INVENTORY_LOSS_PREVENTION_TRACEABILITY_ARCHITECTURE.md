# CHALIN 03 Inventory Loss Prevention & Traceability

Status: feature-branch design and implementation only. Do not promote to `main` or `production` until the owner selects a pilot/release date.

Branch: `feature/inventory-loss-prevention-traceability`

## Purpose

The goal is not merely to attach codes to products. The goal is to make unexplained inventory loss harder to hide and much easier to investigate by giving high-risk physical units a durable identity and chain of custody.

For a serialized product, CHALIN 03 should be able to answer:

- Which exact physical units should exist?
- Where should each unit be now?
- Who received, labelled, activated, moved, sold, returned, counted or adjusted it?
- Which business document caused the movement?
- When was the unit last physically verified?
- If a unit is missing, what was its last known valid state and custody window?

The system must produce investigation evidence. It must never automatically accuse an employee of theft.

## Three tracking levels

Every Spare Parts product has one of three tracking modes.

1. `quantity` — ordinary quantity control for low-value/bulk items.
2. `batch` — stock is controlled by receiving/label batch without requiring one identity per physical unit.
3. `serialized` — every physical unit has its own CHALIN 03 unit identity and lifecycle.

Existing products default to `quantity`, so this project is backward-compatible and can be piloted product-by-product.

## Product identity and unit identity

A product-type code is short and human recognizable, for example `SO4L` for Star Oil 4L.

A physical unit code combines that type code with a cryptographically random, non-sequential token, for example:

`SO4L-K7M4Q9XD`

Sequential serials such as `SO4L-001` are intentionally avoided because workers should not be able to predict valid future IDs.

The printed QR payload is separately signed with a dedicated inventory-label signing secret. A copied label is still the same unit identity, not a second valid unit; duplicate use is rejected by lifecycle state.

## Product traceability states

Tracking mode and enforcement state are different concepts.

- `off` — ordinary quantity behavior.
- `setup` — a product is being labelled/reconciled. Identity records can be prepared, but normal serialized enforcement is not yet active.
- `enforced` — serialized/batch rules are mandatory for the configured product.

This prevents an unfinished label rollout from accidentally blocking the live store.

## Unit lifecycle

Initial serialized lifecycle states:

- `label_pending`
- `active`
- `reserved_sale`
- `in_transit`
- `sold`
- `returned_quarantine`
- `damaged`
- `missing`
- `written_off`
- `voided`

Important rules:

- A generated/printed label is not stock by itself.
- `label_pending` units cannot be sold.
- Only physically attached and confirmed labels become `active`.
- `sold` units cannot be sold again.
- Returned serialized units enter `returned_quarantine` before they can become sellable again.
- Missing/damaged/written-off states require audit evidence and later approval policy.
- `voided` label identities can never become active later.

## Label batches

Labels are created in controlled batches. A batch records:

- product and store;
- source (opening reconciliation, purchase, restock, transfer receipt, return reactivation, etc.);
- expected/generated/activated/voided quantities;
- who created, printed, verified and activated it;
- print format;
- timestamps and notes.

A batch can be printed as sticker/thermal/A4 in later phases, but printing alone never activates stock.

If the physical quantity does not match the expected quantity, the operator can void unused unit IDs before activation. The quantity discrepancy itself must be reconciled through the stock-control workflow; activation must not silently rewrite `products.quantity`.

## Unit movement ledger

`inventory_units` stores each unit's current state for fast lookup.

`inventory_unit_events` is append-only application evidence. Every event has a per-unit sequence number and SHA-256 hash chained to the previous event hash. The application will expose no edit/delete operation for historical unit events.

Examples of event types:

- label generated / label voided
- unit activated
- physical verification
- sale reserved / sale completed / sale reservation released
- transfer dispatched / transfer received / transfer shortage
- customer return received / quarantine released
- damaged / missing / found / written off
- label reprint requested / approved / printed
- count variance opened / resolved

The hash chain is tamper-evident application evidence; it is not a substitute for database backups, privileged audit logs or physical CCTV/access control.

## Exact operational model

### Receiving

For serialized stock, a purchase/restock may create quantity evidence first, but the product must remain in setup/identity-pending control until the required physical labels are attached and confirmed. Final enforcement will prevent unlabelled serialized quantity from being sold.

### Sale

The cashier can either scan the QR using a phone camera or manually enter the unit code. Both paths call the same server validation. The server, not the browser, decides whether the unit exists, belongs to that product/store and is currently sellable.

A sale reserves the exact unit IDs before financial completion. After the sale commits, the same unit records become `sold`. Failed/cancelled sale transactions release reservations.

### Transfer

The sending store dispatches exact serialized IDs. Units become `in_transit`. The destination scans the received units. Any expected unit not received becomes a transfer exception instead of silently disappearing from a quantity total.

### Return

A serialized return must identify the exact unit originally sold on the receipt. A successful return moves it to `returned_quarantine`. Inspection later decides whether it returns to `active`, becomes `damaged`, or is written off.

### Counts

Blind cycle counts will scan physical unit identities without revealing expected quantity first. Missing expected IDs and unexpected/duplicate scans create an investigation, not an automatic stock overwrite.

## Anti-theft controls beyond serialization

The completed program should also include:

- blind and surprise cycle counts;
- high-risk product scoring;
- no silent stock decreases;
- controlled label reprints;
- transfer shortage evidence;
- shift/custody handover for high-risk areas;
- missing-unit investigations;
- exception analytics for unusual returns, voids, discounts, adjustments, reprints and after-hours activity;
- owner/manager alerts for critical shrinkage events;
- protected high-value storage, access/key controls and CCTV as physical complements to the software.

## Security invariants

1. Unit codes are random, not sequential.
2. QR payloads use a dedicated inventory signing secret.
3. Branch/store isolation is enforced server-side.
4. Product tracking configuration is privileged.
5. A serialized unit has one current state and an append-only history.
6. A `sold`, `voided` or `written_off` unit cannot silently return to `active`.
7. Label reprints never create another inventory unit.
8. Quantity changes and identity changes must eventually reconcile; neither silently overwrites the other.
9. Scanning is convenience only. Every scan/manual entry is validated by the backend.
10. The system produces evidence and risk signals; it does not declare a worker guilty of theft.

## Planned phases

### Phase 1 — Identity Foundation

- additive schema;
- tracking/risk configuration per product;
- secure unit-code and QR-signature primitives;
- lifecycle transition rules;
- label-batch/unit/event tables;
- `Where is this item?` backend lookup;
- migration verifier and regression contracts.

### Phase 2 — Receiving & Label Control

- create label batches from opening reconciliation, purchase/restock and transfer receipt;
- sticker/thermal/A4 printing;
- physical attachment confirmation;
- void damaged/unused labels;
- activate confirmed units only;
- label reprint governance.

### Phase 3 — Sales & Scanning

- phone camera scan and manual unit entry;
- multi-scan cart;
- exact unit reservation and sale completion;
- cannot bypass serialization for enforced products.

### Phase 4 — Full Movement Chain

- transfers;
- returns/quarantine;
- damage/write-off;
- stock adjustments;
- supplier returns;
- exact serialized movement evidence.

### Phase 5 — Loss Detection

- blind counts;
- random cycle counts;
- missing-unit investigations;
- custody/shift handover;
- shrinkage and exception analytics;
- Loss Prevention dashboard.

### Phase 6 — Pilot & Hardening

- choose a small set of high-risk products in one store;
- reconcile physical stock;
- label and activate pilot stock;
- simulate sale, transfer, return, missing unit, damaged label, reprint and count variance;
- train operators;
- select release date only after pilot evidence is accepted.
