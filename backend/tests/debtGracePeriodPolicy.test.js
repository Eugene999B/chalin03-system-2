"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {calculateDebtDueDate,resetDueDate}=require("../services/debtGracePeriodService");
test("30 days means exactly 30 calendar days, not a variable calendar month",()=>{assert.equal(calculateDebtDueDate("2026-11-25"),"2026-12-25");assert.equal(calculateDebtDueDate("2026-01-31",30),"2026-03-02");assert.equal(calculateDebtDueDate("2026-11-25",45),"2027-01-09");});
test("old overdue accounts get a new grace period without shortening later dates",()=>{const resetDate="2026-11-25";assert.equal(resetDueDate({saleDate:"2026-07-10",oldDueDate:"2026-07-17",resetDate}),"2026-12-25");assert.equal(resetDueDate({saleDate:"2026-11-20",oldDueDate:"2026-11-27",resetDate}),"2026-12-20");assert.equal(resetDueDate({saleDate:"2026-11-20",oldDueDate:"2027-01-01",resetDate}),"2027-01-01");});
