# Equipment Hire and Installment Finance Context Separation

## Release purpose

This release removes the Equipment Hire active-location selector from Equipment Installment Finance without changing existing production records or database columns.

## Equipment Hire Operations

Equipment Hire remains location-scoped. Hire staff must continue selecting an authorised active Hire location before creating or changing Hire enquiries, contracts, dispatches, job cards, invoices, returns, workers or administration records.

## Equipment Installment Finance

Installment Finance now operates as a company-wide Finance portfolio. Finance staff do not choose an Equipment Hire location.

Existing `hire_location_id` values on Finance records are retained only as internal equipment-origin and historical-reference values. The backend derives that reference from the selected quotation, credit application, agreement or machine. It is not used as a Finance staff operating context.

## Shared-machine safety

The two divisions share machine identity only. Before Finance reserves, delivers or transfers ownership of a machine, the system still checks whether that machine is assigned, dispatched or active on a Hire contract. An active Hire assignment blocks the Finance action.

This safety check does not grant Finance staff access to Hire contracts or require them to select a Hire location.

## SMS policy

Automatic installment SMS remains disabled. This release does not enable, schedule or send automatic Finance reminders.

## Database impact

No database migration is required. Existing records, foreign keys, audit evidence and production data are preserved.
