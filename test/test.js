import assert from 'assert';
import bip39 from 'bip39';
import { VaultConcordiumController } from '../src/index.js';
import { describe, it, before } from 'mocha';

const TEST_MNEMONIC = bip39.generateMnemonic(256);
console.log('Generated Mnemonic:', TEST_MNEMONIC);

let controller;
let storedIdentity;
let accountAddresses;

describe('VaultConcordiumController Tests', function () {
  this.timeout(10000);
  before(async function () {
    controller = new VaultConcordiumController({
      mnemonic: TEST_MNEMONIC,
      network: 'Testnet',
    });
  });

  it('should initialize VaultConcordiumController', function () {
    assert.notStrictEqual(controller, null, 'Controller is not initialized');
    assert.strictEqual(controller.store.getState().network, 'Testnet', 'Network is incorrect');
  });

  it('should validate mnemonic', function () {
    assert.strictEqual(bip39.validateMnemonic(TEST_MNEMONIC), true, 'Mnemonic validation failed');
  });

  it('should get network configuration', function () {
    const config = controller.getNetworkConfig();
    assert.notStrictEqual(config, null, 'Failed to get network configuration');
  });

  it('should change the network', async function () {
    this.timeout(20000);
    await controller.setNetwork('Mainnet');
    assert.strictEqual(controller.store.getState().network, 'Mainnet', 'Network change failed');
  });

  it('should reinitialize client after network change', async function () {
    await controller.setNetwork('Testnet');
    assert.strictEqual(controller.store.getState().network, 'Testnet', 'Failed to reinitialize client after network change');
  });

  it('should fetch identity providers', async function () {
    const providers = await controller.getIdentityProviders();
    assert.notStrictEqual(providers.length, 0, 'No identity providers found');
  });

  it('should set identity provider', async function () {
    const providers = await controller.getIdentityProviders();
    await controller.setIdentityProvider(providers[0]);
    assert.notStrictEqual(controller.store.getState().ipInfo, null, 'Identity provider was not set correctly');
  });

  it('should create and send an identity request, then wait for user input', async function () {
    const identityRequest = await controller.createIdentityRequest();
    assert.notStrictEqual(identityRequest, null, 'Failed to create identity request');

    const redirectUri = 'http://localhost:4173/confirm-identity';
    const identityVerificationUrl = await controller.sendIdentityRequest(identityRequest, redirectUri);
    console.log('Visit this URL to complete identity verification:', identityVerificationUrl);
    
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const askQuestion = (query) => new Promise(resolve => rl.question(query, ans => resolve(ans)));
    
    const userRedirectUrl = await askQuestion('Enter the redirect URL after completing verification: ');
    rl.close();
    
    storedIdentity = await controller.retrieveIdentity(userRedirectUrl);
    assert.notStrictEqual(storedIdentity, null, 'Failed to retrieve identity');

    await controller.initializeIdentity(storedIdentity);
    assert.notStrictEqual(controller.store.getState().idObject, null, 'Failed to initialize identity');
  });

  describe('Account Management Tests', function () {
    it('should create an account', async function () {
      const account = await controller.addAccount();
      assert.ok(account.address && account.address.length > 0, 'Failed to create account');
    });

    it('should fetch accounts', async function () {
      accountAddresses = await controller.getAccounts();
      assert.notStrictEqual(accountAddresses.length, 0, 'No accounts retrieved');
    });

    it('should get account balance', async function () {
      const balance = await controller.getBalance(accountAddresses[0]);
      assert.ok(balance.balance !== undefined, 'Failed to retrieve account balance');
    });
  });

  it('should recover identity and match the created identity', async function () {
    const recoveredIdentity = await controller.restoreIdentityDynamic();
    assert.deepStrictEqual(recoveredIdentity, storedIdentity, 'Recovered identity does not match the created identity');
  });

  it('should restore accounts and match created accounts', async function () {
    const restoredAccountObjects = await controller.restoreAccounts();
    const restoredAccountAddresses = restoredAccountObjects.map(acc => acc.address);
    assert.deepStrictEqual(restoredAccountAddresses, accountAddresses, 'Restored account addresses do not match created account addresses');
  });

  it('should prompt user before creating and signing a transfer transaction', async function () {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const askQuestion = (query) => new Promise(resolve => rl.question(query, ans => resolve(ans)));
    
    let userDecision;
    do {
      userDecision = await askQuestion('Have you funded your wallet? Type "yes" to continue or "no" to wait: ');
    } while (userDecision.toLowerCase() !== 'yes');
    rl.close();
    
    console.log('Proceeding with the transfer transaction...');
    
    const accounts = await controller.getAccounts();
    const receiver = '4QkqdUnrjShrUrHpE96odLM6J77nWzEryifzqNnwNk4FYNge8a';
    const sender = accounts[0];
    const transaction = await controller.createTransferTransaction(receiver, 10, sender);
    assert.notStrictEqual(transaction, null, 'Failed to create transaction');

    const signature = await controller.signTransaction(transaction);
    assert.notStrictEqual(signature, null, 'Failed to sign transaction');
  });
});
