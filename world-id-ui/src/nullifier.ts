/**
 * Computes the externalNullifier value to pass to SpectreRegistry constructor.
 *
 * World ID SDK derives it as:
 *   hashToField(keccak256(app_id || action))
 * where hashToField reduces mod the BN254 scalar field.
 */
import { keccak256, encodePacked } from "viem";

const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const appId = process.env.VITE_WLD_APP_ID ?? "";
const action = "spectre-recovery";

if (!appId) {
  console.error("Set VITE_WLD_APP_ID env var");
  process.exit(1);
}

const hash = keccak256(encodePacked(["string", "string"], [appId, action]));
const nullifier = BigInt(hash) % BN254_SCALAR_FIELD;

console.log("app_id:             ", appId);
console.log("action:             ", action);
console.log("externalNullifier:  ", nullifier.toString());
console.log("\nSet in .env:");
console.log(`WORLD_ID_EXTERNAL_NULLIFIER=${nullifier}`);
