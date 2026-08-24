"use strict";

const express = require("express");
const independentRoutes = require("../routes/equipmentFinanceIndependentRoutes");
const candidateRoutes = require("../routes/equipmentFinanceOpeningDepositCandidateCompatibilityRoutes");

if (!independentRoutes.__chalin03ParentCandidateInstalled) {
  const candidateLayer = candidateRoutes.stack.find(
    (layer) => layer?.route?.path === "/deposit-reservations/candidates"
  );

  if (candidateLayer) {
    const existing = independentRoutes.stack.some(
      (layer) => layer === candidateLayer || layer?.route?.path === "/deposit-reservations/candidates"
    );
    if (!existing) {
      independentRoutes.stack.unshift(candidateLayer);
    }
  } else {
    throw new Error(
      "Opening Deposit candidate route was not available while installing the Finance parent candidate boundary."
    );
  }

  Object.defineProperty(independentRoutes, "__chalin03ParentCandidateInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
