import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const css = fs.readFileSync(
  path.join(root, "src/styles/groupOperationsLogin.css"),
  "utf8"
);

for (const marker of [
  "group-operations-map__node.is-parts > span::before",
  "group-operations-map__node.is-mining > span::before",
  "group-operations-map__node.is-hire > span::before",
  "data:image/svg+xml",
]) {
  if (!css.includes(marker)) {
    throw new Error(`Login artwork regression: missing ${marker}`);
  }
}

if (css.includes("content: \"P\"") || css.includes("content: \"M\"") || css.includes("content: \"H\"")) {
  throw new Error("Login artwork regression: letter-only business markers are still present.");
}

console.log("Chalin 03 login artwork regression contract passed.");
