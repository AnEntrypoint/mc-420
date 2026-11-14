const fs = require("fs");
const p = process.argv[2];
const s = fs.readFileSync(p, "utf8");
const checks = [
  ["NETBOOT_PIN", s.includes("NETBOOT_PIN")],
  ["--pin argument", s.includes("'--pin'")],
  ["pin source selected", s.includes("PIN_SOURCE")],
  ["sha file pin", s.includes("SHA_FILE")],
  ["pin resolved to full sha", s.includes("resolvePinSha")],
  ["head_sha query", s.includes("head_sha=")],
  ["auto-advance disabled", s.includes("auto-advance to newer green main DISABLED")],
  ["refuse newest main on bad pin", s.includes("refusing to serve the newest main build")],
  ["head_sha mismatch guard", s.includes("run head_sha mismatch")]
];
const failed = checks.filter((x) => !x[1]).map((x) => x[0]);
console.log(JSON.stringify({ checks: checks.length, failed, pass: failed.length === 0, file: p }));
if (failed.length) process.exitCode = 1;
