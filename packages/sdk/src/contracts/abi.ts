import abiJson from "./SpectreRegistry.abi.json" with { type: "json" }
import type { Abi } from "viem"

export const REGISTRY_ABI = abiJson as Abi
