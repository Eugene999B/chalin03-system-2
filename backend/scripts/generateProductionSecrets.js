const crypto = require("node:crypto");

const secretNames = [
  "JWT_SECRET",
  "ACCOUNT_RECOVERY_OTP_SECRET",
  "CLOUDFLARE_ORIGIN_SECRET",
];

console.log(
  "# Generated securely. Store these values only in Railway and Cloudflare secret settings."
);

for (const name of secretNames) {
  console.log(`${name}=${crypto.randomBytes(64).toString("hex")}`);
}
