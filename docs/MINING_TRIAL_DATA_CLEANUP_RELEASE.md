# Mining Trial Data Cleanup Release

## Completion

The one-time, System Administrator-authorized Mining trial-data cleanup was executed by production commit `1165c031f62850f1de86b44ae3848217c9b99632`.

Railway accepted the deployment only after the cleanup transaction completed successfully and the normal backend started. The transaction verified that protected Spare Parts, Equipment Hire, user, business-location and shared-fleet row-count sentinels did not change.

## Removed Mining scope

The release dynamically discovered every `mining_%` base table, read the live foreign-key graph, cleared Mining-scoped access, workers, notifications, audit and shared-control rows, deleted child tables before parents, and verified all Mining tables were empty before commit.

## Protected data

The cleanup did not disable foreign keys, truncate tables, alter schema objects, delete users, delete business locations, delete shared fleet assets, or modify protected Spare Parts and Equipment Hire row counts.

## Durable evidence

The production database retains the `schema_migrations` marker `20260726_mining_trial_data_cleanup`, preventing repeat execution. The temporary runner and startup hook were removed immediately after successful production verification.
