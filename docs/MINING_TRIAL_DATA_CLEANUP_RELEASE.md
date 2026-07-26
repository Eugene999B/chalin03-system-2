# Mining Trial Data Cleanup Release

This is a one-time, System Administrator-authorized production cleanup for Mining trial data only.

## Protected data

The cleanup takes before-and-after row-count sentinels for Spare Parts, Equipment Hire, users, business locations and shared fleet records. Any change to those sentinels rolls back the entire transaction and prevents the backend from starting.

## Mining scope

The runner dynamically discovers every `mining_%` base table, reads the live foreign-key graph, clears explicitly Mining-scoped shared rows, deletes child tables before parents, and verifies all Mining tables are empty before committing.

It does not disable foreign keys, truncate tables, drop schema objects, delete business locations, delete users, or delete shared fleet assets.

## One-time evidence

A `schema_migrations` marker named `20260726_mining_trial_data_cleanup` prevents a second execution. After production verification, the temporary startup hook and runner are removed in a separate cleanup release.
