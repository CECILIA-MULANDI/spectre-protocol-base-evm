export const REGISTRY_ABI = [
  // ── Registration ─────────────────────────────────────────────────────────
  {
    type: "function",
    name: "register",
    inputs: [{ name: "emailHash", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerWithCustomTimelock",
    inputs: [
      { name: "emailHash", type: "bytes32" },
      { name: "timelockBlocks", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── EmailWorldID recovery ─────────────────────────────────────────────────
  {
    type: "function",
    name: "initiateRecovery",
    inputs: [
      { name: "agentOwner", type: "address" },
      { name: "newOwner", type: "address" },
      { name: "emailProof", type: "bytes" },
      { name: "emailPublicInputs", type: "bytes32[]" },
      { name: "worldIdRoot", type: "uint256" },
      { name: "worldIdNullifier", type: "uint256" },
      { name: "worldIdProof", type: "uint256[8]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Backup wallet recovery ────────────────────────────────────────────────
  {
    type: "function",
    name: "setBackupWallet",
    inputs: [{ name: "backupWallet", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "initiateBackupRecovery",
    inputs: [
      { name: "agentOwner", type: "address" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Social / guardian recovery ────────────────────────────────────────────
  {
    type: "function",
    name: "setGuardians",
    inputs: [
      { name: "newGuardians", type: "address[]" },
      { name: "threshold", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approveGuardianRecovery",
    inputs: [
      { name: "agentOwner", type: "address" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── Shared cancel / execute ───────────────────────────────────────────────
  {
    type: "function",
    name: "cancelRecovery",
    inputs: [{ name: "agentOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeRecovery",
    inputs: [{ name: "agentOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },

  // ── View helpers ──────────────────────────────────────────────────────────
  {
    type: "function",
    name: "getRecord",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "emailHash", type: "bytes32" },
          { name: "owner", type: "address" },
          { name: "pendingOwner", type: "address" },
          { name: "timelockBlocks", type: "uint64" },
          { name: "recoveryInitBlock", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "backupWallet", type: "address" },
          { name: "guardianThreshold", type: "uint8" },
          { name: "guardianCount", type: "uint8" },
          { name: "pendingRecoveryMode", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recoveryStatus",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "pending", type: "bool" },
      { name: "pendingOwner", type: "address" },
      { name: "executeAfterBlock", type: "uint64" },
      { name: "mode", type: "uint8" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getGuardians",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getApprovalCount",
    inputs: [
      { name: "agentOwner", type: "address" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },

  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "emailHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RecoveryInitiated",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
      { name: "executeAfterBlock", type: "uint64", indexed: false },
      { name: "mode", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RecoveryCancelled",
    inputs: [{ name: "owner", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "RecoveryExecuted",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "BackupWalletSet",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "backupWallet", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "GuardiansSet",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "guardians", type: "address[]", indexed: false },
      { name: "threshold", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GuardianApproved",
    inputs: [
      { name: "agentOwner", type: "address", indexed: true },
      { name: "guardian", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
      { name: "approvalCount", type: "uint8", indexed: false },
    ],
  },
] as const;
