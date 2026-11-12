# Chalin03 Runtime Cost Control

This change set keeps application business logic intact while reducing unnecessary resident backend polling.

- Finance boss activity polling has a hard 30-second minimum regardless of environment configuration. The previous default was 2 seconds.
- Financial transactions, payment allocation, customer reminders, delivery status handling, and database schema are not changed.
- Further scheduler changes require separate measurement because they can affect customer-facing automation.
