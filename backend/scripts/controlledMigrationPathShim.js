"use strict";

const fs = require("fs");
const path = require("path");

const missingRepositoryMigrationDir = path.resolve(
  path.parse(__dirname).root,
  "database",
  "migrations"
);
const bundledMigrationDir = path.resolve(__dirname, "..", "database", "migrations");

function remapMigrationPath(filePath) {
  if (typeof filePath !== "string") return filePath;
  if (
    filePath === missingRepositoryMigrationDir ||
    filePath.startsWith(`${missingRepositoryMigrationDir}${path.sep}`)
  ) {
    return path.join(
      bundledMigrationDir,
      path.relative(missingRepositoryMigrationDir, filePath)
    );
  }
  return filePath;
}

const originalReadFileSync = fs.readFileSync.bind(fs);
const originalExistsSync = fs.existsSync.bind(fs);

fs.readFileSync = (filePath, ...args) =>
  originalReadFileSync(remapMigrationPath(filePath), ...args);
fs.existsSync = (filePath) => originalExistsSync(remapMigrationPath(filePath));

module.exports = {
  bundledMigrationDir,
  missingRepositoryMigrationDir,
  remapMigrationPath,
};
