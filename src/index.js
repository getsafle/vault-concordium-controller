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

  // ============================================================
  // IDENTITY PROVIDER MANAGEMENT
  // ============================================================
  async setIdentityProvider(identityProvider) {
    if (!identityProvider || !identityProvider.ipInfo || !identityProvider.metadata || !identityProvider.arsInfos) {
      throw new Error("Invalid identity provider provided");
    }
    try {
      this.store.updateState({
        ipInfo: identityProvider.ipInfo,
        ipMetadata: identityProvider.metadata,
        arsInfos: identityProvider.arsInfos,
      });
      this.emit("update", this.store.getState());
      console.log("Identity provider configuration updated.");
    } catch (error) {
      throw new Error(`Failed to update identity provider: ${error.message}`);
    }
  }

  clearIdentityFlow() {
    try {
      this.store.updateState({
        ipInfo: null,
        ipMetadata: null,
        arsInfos: null,
        idObject: null,
      });
      this.emit("update", this.store.getState());
      console.log("Identity flow state cleared.");
    } catch (error) {
      throw new Error(`Failed to clear identity flow: ${error.message}`);
    }
  }

  async getIdentityProviders() {
    try {
      const { walletProxyUrl } = this.store.getState();
      const response = await fetch(`${walletProxyUrl}/v1/ip_info`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`Failed to fetch identity providers: ${error.message}`);
    }
  }

  // ============================================================
  // IDENTITY REQUEST HANDELLING
  // ============================================================
  async createIdentityRequest() {
    const state = this.store.getState();
    if (!state.ipInfo || !state.ipMetadata || !state.arsInfos) {
      throw new Error("Identity provider configuration is missing. Call setIdentityProvider() first.");
    }
    try {
      const wallet = ConcordiumHdWallet.fromSeedPhrase(state.mnemonic, state.network);
      const cryptographicParameters = await this.client.getCryptographicParameters();
      const keys = {
        idCredSec: wallet.getIdCredSec(state.ipInfo.ipIdentity, state.identityIndex).toString('hex'),
        prfKey: wallet.getPrfKey(state.ipInfo.ipIdentity, state.identityIndex).toString('hex'),
        blindingRandomness: wallet.getSignatureBlindingRandomness(state.ipInfo.ipIdentity, state.identityIndex).toString('hex'),
      };
      const input = {
        arsInfos: state.arsInfos,
        arThreshold: Math.min(Object.keys(state.arsInfos).length - 1, 255),
        ipInfo: state.ipInfo,
        globalContext: cryptographicParameters,
        ...keys,
      };
      const generatedIdentityRequest = createIdentityRequestWithKeys(input);
      return generatedIdentityRequest;
    } catch (error) {
      throw new Error(`Failed to create identity request: ${error.message}`);
    }
  }

  async sendIdentityRequest(identityRequestPayload, redirectUri) {
    const state = this.store.getState();
    if (!state.ipMetadata?.issuanceStart) {
      throw new Error("Identity provider metadata is missing a valid issuanceStart URL.");
    }
    try {
      const identityIssuanceStartUrl = state.ipMetadata.issuanceStart;
      const params = {
        scope: 'identity',
        response_type: 'code',
        redirect_uri: redirectUri,
        state: JSON.stringify({ idObjectRequest: identityRequestPayload }),
      };
      const searchParams = new URLSearchParams(params);
      const url = `${identityIssuanceStartUrl}?${searchParams.toString()}`;
      const response = await fetch(url);
      if (!response.redirected) {
        let errorDetails = "";
        try {
          errorDetails = await response.text();
        } catch (e) {
          errorDetails = "Unable to parse error details.";
        }
        throw new Error(`Provider did not redirect as expected: ${errorDetails}`);
      }
      return response.url;
    } catch (error) {
      throw new Error(`Failed to send identity request: ${error.message}`);
    }
  }

  async retrieveIdentity(redirectUrl) {
    const parts = redirectUrl.split('#code_uri=');
    if (parts.length < 2) {
      throw new Error("Redirect URL does not contain a code_uri fragment.");
    }
    const identityUrl = parts[1];
    try {
      const response = await fetch(identityUrl);
      if (!response.ok) {
        throw new Error(`Failed to retrieve identity. HTTP status: ${response.status}`);
      }
      const identityTokenContainer = await response.json();

      if (identityTokenContainer.status === "done") {
        return identityTokenContainer.token.identityObject;
      } else if (identityTokenContainer.status === "error") {
        throw new Error(`Identity retrieval error: ${identityTokenContainer.detail}`);
      } else if (identityTokenContainer.status === "pending") {
        throw new Error("Identity is still pending. Please retry later.");
      } else {
        throw new Error("Unexpected status in identity token container.");
      }
    } catch (error) {
      throw new Error(`Failed to retrieve identity: ${error.message}`);
    }
  }

  async initializeIdentity(identityObj) {
    if (!identityObj) {
      throw new Error("Required identity object missing.");
    }
    try {
      this.store.updateState({ idObject: identityObj });
      this.emit("update", this.store.getState());
    } catch (error) {
      throw new Error(`Failed to initialize identity: ${error.message}`);
    }
  }

  // ============================================================
  // ACCOUNT MANAGEMENT
  // ============================================================
  async addAccount() {
    const state = this.store.getState();
    if (!state.idObject) {
      throw new Error("Identity not initialized");
    }
    try {
      const seedBuffer = bip39.mnemonicToSeedSync(state.mnemonic);
      const seedAsHex = seedBuffer.toString('hex');
      const net = state.network;
      const globalContext = await this.client.getCryptographicParameters();
      if (!globalContext) {
        throw new Error('Cryptographic parameters not found on a finalized block.');
      }
      const revealedAttributes = [];
      const identityObject = state.idObject.value;
      const identityIndex = state.identityIndex;
      const credNumber = state.credCounter;
      const wallet = ConcordiumHdWallet.fromSeedPhrase(state.mnemonic, net);
      const publicKey = wallet
        .getAccountPublicKey(state.ipInfo.ipIdentity, identityIndex, credNumber)
        .toString('hex');
      const credentialPublicKeys = {
        keys: {
          0: { schemeId: 'Ed25519', verifyKey: publicKey },
        },
        threshold: 1,
      };
      const attributeRandomness = {};
      const attributeKeys = Object.keys(AttributesKeys).filter((v) => isNaN(Number(v)));
      attributeKeys.forEach((attrKey) => {
        const rand = wallet.getAttributeCommitmentRandomness(
          state.ipInfo.ipIdentity,
          identityIndex,
          credNumber,
          AttributesKeys[attrKey]
        );
        if (!rand) {
          throw new Error(`Randomness for attribute "${attrKey}" is missing.`);
        }
        attributeRandomness[attrKey] = rand.toString('hex');
      });
      const inputs = {
        ipInfo: state.ipInfo,
        globalContext,
        arsInfos: state.arsInfos,
        idObject: identityObject,
        revealedAttributes,
        seedAsHex,
        net,
        identityIndex,
        credNumber,
        credentialPublicKeys,
        attributeRandomness,
      };
      const expiry = TransactionExpiry.fromDate(new Date(Date.now() + 3600000));
      const credentialTx = createCredentialTransaction(inputs, expiry);
      const signingKey = ConcordiumHdWallet.fromHex(seedAsHex, net)
        .getAccountSigningKey(state.ipInfo.ipIdentity, identityIndex, credNumber);
      const signatures = [await signCredentialTransaction(credentialTx, signingKey)];
      const payload = serializeCredentialDeploymentPayload(signatures, credentialTx);
      const success = await this.client.sendCredentialDeploymentTransaction(payload, expiry);
      if (!success) {
        throw new Error("Credential deployment transaction was rejected by the node.");
      }
      const transactionHash = getCredentialDeploymentTransactionHash(credentialTx, signatures);
      await this.waitForTransactionFinalization(transactionHash);
      const accountAddress = getAccountAddress(credentialTx.unsignedCdi.credId);
      const newAccount = {
        address: accountAddress.address,
        credentialIndex: credNumber,
      };
      const updatedCredCounter = state.credCounter + 1;
      const updatedAccounts = [...state.accounts, newAccount];
      this.store.updateState({
        credCounter: updatedCredCounter,
        accounts: updatedAccounts,
      });
      this.emit("update", this.store.getState());
      return { address: accountAddress.address};
    } catch (error) {
      throw new Error(`Failed to create account: ${error.message}`);
    }
  }

  async getAccounts() {
    const accounts = this.store.getState().accounts;
    let addresses = [];
    accounts.forEach((acc) => {
      addresses.push(acc.address);
    });
    return addresses;
  }

  async getBalance(address) {
    try {
      // Convert the string address to an AccountAddress instance.
      const accountAddr = AccountAddress.fromBase58(address);
      const accountInfo = await this.client.getAccountInfo(accountAddr);
      if (!accountInfo || !accountInfo.accountAvailableBalance) {
        throw new Error("Account not found or balance unavailable.");
      }
      const balance = accountInfo.accountAvailableBalance.toString();
      return { balance };
    } catch (error) {
      console.error(`Failed to fetch balance for ${address}:`, error.message);
      throw new Error("Failed to retrieve account balance.");
    }
  }
}