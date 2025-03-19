const assert = require("assert");
const bip39 = require("bip39");
const { KeyringController } = require("../src");
const { describe, it, before } = require("mocha");
const readline = require("readline");

/**
 * Function to prompt user input and wait for a response.
 */
function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const TEST_MNEMONIC = bip39.generateMnemonic(256);
console.log("Generated Mnemonic:", TEST_MNEMONIC);

let controller;
let storedIdentity;
let accountAddresses;

describe("VaultConcordiumController Tests", function () {
  before(async function () {
    // Assuming KeyringController is renamed to VaultConcordiumController in your index.js
    controller = new KeyringController({
      mnemonic: TEST_MNEMONIC,
      network: "Mainnet",
    });
  });

  it("should initialize VaultConcordiumController", function () {
    assert.notStrictEqual(controller, null, "Controller is not initialized");
    assert.strictEqual(
      controller.store.getState().network,
      "Mainnet",
      "Network is incorrect"
    );
  });

  it("should validate mnemonic", function () {
    assert.strictEqual(
      bip39.validateMnemonic(TEST_MNEMONIC),
      true,
      "Mnemonic validation failed"
    );
  });

  it("should get network configuration", function () {
    const config = controller.getNetworkConfig();
    assert.notStrictEqual(config, null, "Failed to get network configuration");
  });

  it("should change the network", async function () {
    this.timeout(30000);
    await controller.setNetwork("Testnet");
    assert.strictEqual(
      controller.store.getState().network,
      "Testnet",
      "Network change failed"
    );
  });

  it("should reinitialize client after network change", async function () {
    await controller.setNetwork("Testnet");
    assert.strictEqual(
      controller.store.getState().network,
      "Testnet",
      "Failed to reinitialize client after network change"
    );
  });

  it("should fetch identity providers", async function () {
    const providers = await controller.getIdentityProviders();
    assert.notStrictEqual(providers.length, 0, "No identity providers found");
  });

  it("should set identity provider", async function () {
    const providers = await controller.getIdentityProviders();
    await controller.setIdentityProvider(providers[0]);
    assert.notStrictEqual(
      controller.store.getState().ipInfo,
      null,
      "Identity provider was not set correctly"
    );
  });

  // it("should create and send an identity request, then wait for user input", async function () {
  //   this.timeout(120000);
  //   const identityRequest = await controller.createIdentityRequest();
  //   assert.notStrictEqual(
  //     identityRequest,
  //     null,
  //     "Failed to create identity request"
  //   );

  //   const redirectUri = "http://localhost:4173/confirm-identity";
  //   const identityVerificationUrl = await controller.sendIdentityRequest(
  //     identityRequest,
  //     redirectUri
  //   );

  //   console.log("\n🔗 Visit this URL to complete identity verification:");
  //   console.log(identityVerificationUrl);
  //   console.log(
  //     "\n📌 After completing verification, paste the **redirect URL** from your browser below."
  //   );

  //   const userRedirectUrl = await askQuestion("\n✍️ Enter the redirect URL: ");

  //   storedIdentity = await controller.retrieveIdentity(userRedirectUrl);
  //   assert.notStrictEqual(storedIdentity, null, "Failed to retrieve identity");

  //   await controller.initializeIdentity(storedIdentity);
  //   assert.notStrictEqual(
  //     controller.store.getState().idObject,
  //     null,
  //     "Failed to initialize identity"
  //   );
  // });

  // describe("Account Management Tests", function () {
  //   this.timeout(100000);
  //   it("should create an account", async function () {
  //     const account = await controller.addAccount();
  //     assert.ok(
  //       account.address && account.address.length > 0,
  //       "Failed to create account"
  //     );
  //   });

  //   it("should fetch accounts", async function () {
  //     accountAddresses = await controller.getAccounts();
  //     assert.notStrictEqual(accountAddresses.length, 0, "No accounts in store");
  //   });

  //   it("should get account balance", async function () {
  //     const balance = await controller.getBalance(accountAddresses[0]);
  //     assert.ok(
  //       balance.balance !== undefined,
  //       "Failed to retrieve account balance"
  //     );
  //   });
  // });

  // describe("Recovery Flow Tests", function () {
  //   it("should recover identity and match the created identity", async function () {
  //     const recoveredIdentity = await controller.restoreIdentityDynamic();
  //     assert.deepStrictEqual(
  //       recoveredIdentity,
  //       storedIdentity,
  //       "Recovered identity does not match the created identity"
  //     );
  //   });

  //   it("should restore accounts and match created accounts", async function () {
  //     const restoredAccountObjects = await controller.restoreAccounts();
  //     const restoredAccountAddresses = restoredAccountObjects.map(
  //       (acc) => acc.address
  //     );

  //     assert.deepStrictEqual(
  //       new Set(restoredAccountAddresses),
  //       new Set(accountAddresses),
  //       "Restored account addresses do not match created account addresses"
  //     );
  //   });
  // });

  // describe("Transfer Transaction Tests", function () {
  //   this.timeout(1000000);
  //   it("should create, sign and send a transfer transaction", async function () {
  //     let userDecision;
  //     do {
  //       userDecision = await askQuestion(
  //         'Have you funded your wallet? Type "yes" to continue or "no" to wait: '
  //       );
  //     } while (userDecision.toLowerCase() !== "yes");

  //     console.log("Proceeding with the transfer transaction...");

  //     const accounts = await controller.getAccounts();
  //     const receiver = "4QkqdUnrjShrUrHpE96odLM6J77nWzEryifzqNnwNk4FYNge8a";
  //     const sender = accounts[0];
  //     const transaction = await controller.createTransferTransaction(
  //       receiver,
  //       10,
  //       sender
  //     );
  //     assert.notStrictEqual(transaction, null, "Failed to create transaction");

  //     const signature = await controller.signTransaction(transaction);
  //     assert.notStrictEqual(signature, null, "Failed to sign transaction");

  //     const { transactionDetails } = await controller.sendTransaction(
  //       transaction,
  //       signature
  //     );
  //     assert.notStrictEqual(
  //       transactionDetails,
  //       null,
  //       "Failed to send transaction"
  //     );
  //   });
  // });
});
