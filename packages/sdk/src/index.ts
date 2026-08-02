export { SpectreClient } from "./client.js";
export { NotifyClient } from "./notify.js";
export {
  computeSignal,
  encodeBindCustomData,
  encodeProofData,
  toPersonhoodNullifier,
  bindFieldsForRecovery,
  renderZKPassportSnippet,
} from "./personhood.js";
export type { ZKPassportProofVerificationParams } from "./personhood.js";
export type {
  Address,
  AgentRecord,
  RecoveryStatus,
  RecoveryMode,
  ProofResult,
  ProverConfig,
  SpectreClientConfig,
  TxResult,
  RecoveryInitiatedEvent,
  RecoveryCancelledEvent,
  RecoveryExecutedEvent,
  WatchRecoveryOptions,
  Unwatch,
  WebhookSubscription,
} from "./types.js";
