import { EventEmitter } from "events";
import {
  ConcordiumHdWallet,
  ConcordiumGRPCWebClient,
  createIdentityRequestWithKeys,
  createIdentityRecoveryRequestWithKeys,
  createCredentialTransaction,
  signCredentialTransaction,
  getCredentialDeploymentTransactionHash,
  getAccountAddress,
  signTransaction,
  buildBasicAccountSigner,
  TransactionExpiry,
  CcdAmount,
  AccountTransactionType,
  serializeCredentialDeploymentPayload,
  AccountAddress,
  TransactionHash,
  AttributesKeys,
} from '@concordium/web-sdk';
import ObservableStore from 'obs-store';
import bip39 from 'bip39';
import { NETWORKS } from "./constants.js";

// Helper function to initialize state.
function initializeState(opts = {}) {
    const network = opts.network || "Testnet";
    const networkConfig = NETWORKS[network];
    return {
      mnemonic: opts.mnemonic,
      network,
      identityIndex: opts.identityIndex || 0,
      ipInfo: opts.ipInfo || null,
      ipMetadata: opts.ipMetadata || null,
      arsInfos: opts.arsInfos || null,
      credCounter: opts.credCounter || 0,
      accounts: opts.accounts || [],
      idObject: opts.idObject || null,
      ...networkConfig,
    };
}

class VaultConcordiumController extends EventEmitter {

  constructor(opts = {}) {
    super();
    const initialState = initializeState(opts);
    this.store = new ObservableStore(initialState);
    this._initializeClient();
  }

  // ============================================================
  // NETWORK MANAGEMENT & INITIALIZATION
  // ============================================================
  async _initializeClient() {
    try {
      const { nodeAddress, nodePort, timeout, maxRetries } = this.store.getState();
      this.client = new ConcordiumGRPCWebClient(nodeAddress, nodePort, { timeout, maxRetries });
      await this.client.getConsensusStatus();
      this.emit("update", this.store.getState());
    } catch (error) {
      throw new Error(`Failed to initialize client: ${error.message}`);
    }
  }

  async setNetwork(network) {
    if (!NETWORKS[network]) {
      throw new Error(`Invalid network: ${network}`);
    }
    try {
      const networkConfig = NETWORKS[network];
      this.store.updateState({
        network,
        ...networkConfig,
      });
      await this._initializeClient();
    } catch (error) {
      throw new Error(`Failed to change network: ${error.message}`);
    }
  }

  getNetworkConfig() {
    const { network } = this.store.getState();
    return NETWORKS[network];
  }
}