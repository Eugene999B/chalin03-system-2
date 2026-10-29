# Railway redeploy trigger

This file intentionally contains no runtime configuration or application logic.

It exists as a harmless production deployment trigger so the connected Railway service receives a fresh production commit after Finance schedule/date fixes.

Release target: Equipment Installment Finance schedule-truth repair
Database migration required: Yes — handled by the existing Railway preDeployCommand.
Application behaviour changed by this file: No.
