#!/usr/bin/env node

const expected = "/api/collectiq";
const configured = process.env.NEXT_PUBLIC_COLLECTIQ_BFF_PATH?.trim();

if (configured && configured.replace(/\/$/, "") !== expected) {
  console.error(
    `BFF prefix lock failed: NEXT_PUBLIC_COLLECTIQ_BFF_PATH="${configured}" is not allowed. Expected "${expected}".`,
  );
  process.exit(1);
}

console.log("check-bff-prefix-lock: OK");
