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
import { NETWORKS } from "./constants";

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

  // ============================================================
  // TRANSACTION MANAGEMENT
  // ============================================================
  async createTransferTransaction(receiver, amountCCD, senderAddress) {
    const sender = AccountAddress.fromBase58(senderAddress);
    const toAddress = AccountAddress.fromBase58(receiver);
    const amount = CcdAmount.fromCcd(amountCCD);
    const expiry = TransactionExpiry.fromDate(new Date(Date.now() + 1000000));
    const nonce = (await this.client.getNextAccountNonce(sender)).nonce;
    const header = { sender, nonce, expiry };
    const payload = { amount, toAddress };
    const transaction = {
      type: AccountTransactionType.Transfer,
      header: header,
      payload: payload,
    };
    return transaction;
  }

  async signTransaction(transaction) {
    const state = this.store.getState();
    const address = transaction.header.sender.address;
    const accountObj = state.accounts.find((acc) => acc.address === address);
    if (!accountObj) {
      throw new Error("Account not found");
    }
    const credIndex = accountObj.credentialIndex;
    try {
      const wallet = ConcordiumHdWallet.fromSeedPhrase(state.mnemonic, state.network);
      const signingKey = wallet.getAccountSigningKey(state.ipInfo.ipIdentity, state.identityIndex, credIndex);
      const signer = buildBasicAccountSigner(signingKey.toString('hex'));
      const signature = await signTransaction(transaction, signer);
      return signature;
    } catch (error) {
      throw new Error(`Failed to sign transaction: ${error.message}`);
    }
  }

  async sendTransaction(transaction, signature) {
    try {
      const { nodeAddress, nodePort, timeout, maxRetries } = this.store.getState();
      const client = new ConcordiumGRPCWebClient(nodeAddress, nodePort, { timeout, maxRetries });
      await client.getConsensusStatus();
      const txHash = await client.sendAccountTransaction(transaction, signature);
      const blockStatus = await client.waitForTransactionFinalization(txHash);
      const status = blockStatus.summary.transfer.tag;
      const txHashHex = Buffer.from(txHash.buffer).toString('hex');
      return { transactionDetails: blockStatus };
    } catch (error) {
      throw new Error(`Transaction failed: ${error}`);
    }
  }

  async waitForTransactionFinalization(txHash) {
    const { nodeAddress } = this.store.getState();
    let host = nodeAddress;
    try {
      const parsedUrl = new URL(nodeAddress);
      host = parsedUrl.hostname;
    } catch (e) {
      throw new Error(`Failed to parse nodeAddress: ${e.message}`);
    }
    const transactionHash = typeof txHash === 'string'
      ? TransactionHash.fromHexString(txHash)
      : txHash;
    let finalStatus = null;
    while (true) {
      try {
        const blockItemStatus = await this.client.getBlockItemStatus(transactionHash);
        if (blockItemStatus.status === 'finalized') {
          const summary = blockItemStatus.outcome.summary;
          if (summary && summary.transactionType === "failed") {
            throw new Error(`Transaction failed: ${JSON.stringify(summary)}`);
          }
          finalStatus = blockItemStatus;
          break;
        }
      } catch (error) {
        if (
          error.message.includes("Connection dropped") ||
          error.message.includes("ECONNRESET") ||
          error.message.includes("read ECONNRESET")
        ) {
          console.warn("Connection issue detected, retrying polling after delay...");
        } else {
          console.error("Error polling transaction status:", error.message);
          throw new Error(`Error in waitForTransactionFinalization: ${error.message}`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return finalStatus;
  }

  // ============================================================
  // RECOVERY
  // ============================================================
  async restoreIdentityDynamic() {
    const state = this.store.getState();
    if (!state.mnemonic) {
      throw new Error("Mnemonic is missing from state");
    }
    const providers = await this.getIdentityProviders();
    if (!providers || providers.length === 0) {
      throw new Error("No identity providers available for recovery");
    }
    for (let i = 0; i < providers.length; i++) {
      try {
        const provider = providers[i];
        await this.setIdentityProvider(provider);
        const wallet = ConcordiumHdWallet.fromSeedPhrase(state.mnemonic, state.network);
        const globalContext = await this.client.getCryptographicParameters();
        if (!globalContext) {
          throw new Error("Failed to fetch global cryptographic parameters");
        }
        const idCredSec = wallet.getIdCredSec(provider.ipInfo.ipIdentity, state.identityIndex).toString('hex');
        const recoveryRequestInput = {
          idCredSec,
          ipInfo: provider.ipInfo,
          globalContext,
          timestamp: Math.floor(Date.now() / 1000),
        };
        const recoveryRequest = createIdentityRecoveryRequestWithKeys(recoveryRequestInput);
        const searchParams = new URLSearchParams({
          state: JSON.stringify({ idRecoveryRequest: recoveryRequest }),
        });
        const recoveryUrl = `${provider.metadata.recoveryStart}?${searchParams.toString()}`;
        const response = await fetch(recoveryUrl);

        if (!response.ok) {
          const errorDetails = await response.text();
          throw new Error(`Recovery request failed: ${errorDetails}`);
        }
        const identity = await response.json();
        this.store.updateState({ idObject: identity });
        return identity;
      } catch (error) {
        console.error(`Recovery attempt with provider index ${i} failed: ${error.message}`);
      }
    }
    throw new Error("Failed to recover identity using all available providers");
  }

  async restoreAccounts() {
    const state = this.store.getState();
    if (!state.mnemonic || !state.ipInfo) {
      throw new Error("Missing required mnemonic or identity provider information");
    }
    const wallet = ConcordiumHdWallet.fromSeedPhrase(state.mnemonic, state.network);
    const globalContext = await this.client.getCryptographicParameters();
    if (!globalContext) {
      throw new Error("Failed to fetch global cryptographic parameters");
    }
    const recoveredAccounts = [];
    const maxAccounts = 200;
    let lastIndex = 0;
    for (let i = 0; i < maxAccounts; i++) {
      lastIndex = i;
      try {
        const credId = wallet.getCredentialId(
          state.ipInfo.ipIdentity,
          state.identityIndex,
          i,
          globalContext
        );
        if (!credId) {
          throw new Error(`Credential id missing for index ${i}`);
        }
        const accountAddress = getAccountAddress(credId);
        let accountInfo;
        try {
          accountInfo = await this.client.getAccountInfo(accountAddress);
        } catch (error) {
          if (error.message.includes("account%20or%20block%20not%20found.")) {
            break;
          }
        }
        if (accountInfo && accountInfo.accountAddress) {
          recoveredAccounts.push({
            address: accountAddress.address,
            credentialIndex: i,
          });
        } else {
          console.warn(`No account info found for index ${i}`);
        }
      } catch (err) {
        console.error(`Error recovering account at index ${i}: ${err.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    this.store.updateState({ accounts: recoveredAccounts });
    this.store.updateState({ credCounter: lastIndex });
    return recoveredAccounts;
  }  

}

export { VaultConcordiumController, NETWORKS };