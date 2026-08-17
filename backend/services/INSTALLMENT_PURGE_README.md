# Installment complete purge

`clearEverythingInInstallment()` is the single purge function used by the Installment reset executor. It collects Installment agreement/application ownership, removes Installment child records, then removes only unreferenced customer/equipment master rows associated with those records. Shared rows remain protected so other modules are not damaged.
