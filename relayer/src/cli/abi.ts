export const REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "emailHash", type: "bytes32" },
      { name: "timelockBlocks", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
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
    ],
    stateMutability: "view",
  },
] as const;
