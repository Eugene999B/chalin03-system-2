# CHALIN ONE Public Navigation Hierarchy Acceptance

**Scope:** Release B public website and Content Studio  
**Environment:** Development and isolated staging only  
**Production impact:** None

## Supported hierarchy

CHALIN ONE supports a maximum public navigation depth of four nested parent levels. The backend and public renderer use the same limit.

The backend validates the hierarchy when a navigation item is:

- created,
- versioned,
- edited as a draft, and
- published.

It rejects:

- missing parents,
- self-parenting,
- circular parent relationships,
- pre-existing cycles, and
- navigation deeper than the supported limit.

The public renderer additionally fails closed for duplicate keys, orphan children and cyclic bootstrap data.

## Public behaviour

The published website supports:

- desktop dropdown menus,
- nested desktop submenus,
- touch-friendly mobile child menus,
- nested footer links,
- active-child highlighting on the parent menu,
- independent parent links and submenu toggles,
- keyboard focus opening,
- Escape-key closing,
- outside-click closing,
- route-change closing, and
- approved external links with governed new-tab intent.

Unsafe URLs, protocol-relative URLs and credential-bearing external URLs are not rendered as navigable links.

## Staging seed

The standard staging seed command now runs two guarded, idempotent steps:

```bash
npm run seed:chalin-one:staging
```

1. `seedChalinOneStagingContent.js` creates the existing flat governed drafts.
2. `seedChalinOneStagingNavigationHierarchy.js` creates seven child-menu drafts only after their parent drafts exist.

The hierarchy seed creates:

### Header children under `header_divisions`

- Spare Parts
- Mining Operations
- Equipment Hire
- Equipment Sales
- Installment Finance

### Footer children under `footer_about`

- Leadership
- Newsroom

The dry run is:

```bash
npm run seed:chalin-one:staging:dry-run
```

It validates both manifests without opening the database or writing content.

## Governance workflow

Every hierarchy item remains a draft after seeding.

Each item must follow:

```text
Author creates or reviews draft
  → author submits exact version
  → independent reviewer approves
  → separate publisher publishes the approved exact version
```

The seed never submits, approves or publishes content automatically.

Publish a child menu only after its destination page or collection is verified and publicly appropriate.

## Automated database acceptance

The isolated MySQL acceptance suite publishes a real parent with:

- one internal child route, and
- one approved external new-tab child.

It verifies:

- exact-version review,
- independent approval,
- separate publication,
- bootstrap `parent_key`,
- sort order,
- safe URL shape,
- governed `opens_new_tab`,
- no internal IDs in the anonymous bootstrap, and
- publisher audit records.

The acceptance command remains:

```bash
npm run test:chalin-one:db
```

It may run only against a database named `chalin_one_acceptance` or `chalin_one_acceptance_<name>`.

## Final staging smoke

After the homepage, contact form, parent menus and all seven child menus are independently approved and published, enable the isolated final staging switches and run:

```bash
npm run smoke:chalin-one:staging
```

The smoke runner requires:

- five published header division children,
- two published footer children,
- the correct parent key for every child,
- the correct header or footer location,
- both expected parent items, and
- no private fields in the public bootstrap.

A missing child or wrong parent fails with:

```text
CHALIN_ONE_STAGING_NAVIGATION_HIERARCHY_FAILED
```

## Final evidence gate

Run:

```bash
npm run evidence:chalin-one:staging
```

The npm lifecycle first generates the established staging evidence and then applies the final hierarchy gate.

The final report cannot set `staging_ready: true` unless the smoke artifact contains:

```text
governed_navigation_hierarchy: true
```

and a passing `Published navigation hierarchy` check with:

- at least 7 children,
- at least 5 header children,
- at least 2 footer children,
- `header_divisions` and `footer_about` parents, and
- zero private-field findings.

A missing or incomplete hierarchy adds:

```text
published_navigation_hierarchy
```

to the final failure list.

## Browser acceptance

Test at desktop, tablet, 430px and 360px widths.

Verify:

- parent links remain clickable,
- toggles announce expanded/collapsed state,
- keyboard focus opens the correct submenu,
- Escape closes the submenu and returns focus,
- outside click closes the submenu,
- route changes close mobile navigation,
- active child routes highlight the correct parent,
- external new-tab links display their indicator,
- footer children remain readable and tappable, and
- no menu overlaps or traps content at small widths.

## Safety boundary

This work does not authorize:

- a production migration,
- enabling CHALIN ONE flags in production,
- a `chalin-one → main` merge,
- a `main → production` merge,
- a Railway or Cloudflare production deployment, or
- publishing unverified company information.
