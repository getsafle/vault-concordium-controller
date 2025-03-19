# vault-concordium-controller

[![npm version](https://badge.fury.io/js/%40getsafle%2Fvault-concordium-controller.svg)](https://badge.fury.io/js/%40getsafle%2Fvault-concordium-controller)
[![Discussion](https://img.shields.io/badge/discussion-on%20github-brightgreen)](https://github.com/getsafle/vault-concordium-controller/discussions)

Concordium controller for Safle Vault - A module written in JavaScript for managing Concordium accounts, identity operations, and transactions in Safle Vault.

## Installation

```
npm install --save @getsafle/vault-concordium-controller
```

## Initialize the Concordium Controller class

```javascript
const { KeyringController, NETWORKS } = require('@getsafle/vault-concordium-controller');

const concordiumController = new KeyringController({
  // Optional configuration
  mnemonic: 'your mnemonic here', // Optional, will generate new if not provided
  network: 'Testnet', // Default is 'Testnet', can be 'Mainnet'
  identityIndex: 0, // Default identity index
  encryptor: {
    // An optional object for defining encryption schemes
    encrypt(password, object) {
      return new Promise('encrypted!');
    },
    decrypt(password, encryptedString) {
      return new Promise({ foo: 'bar' });
    },
  },
});
```

## Methods

### Set Network

```javascript
// Change between Testnet and Mainnet
await concordiumController.setNetwork('Mainnet');
```

### Get Network Configuration

```javascript
// Get current network configuration
const networkConfig = concordiumController.getNetworkConfig();
```

### Identity Management

#### Get Identity Providers

```javascript
// Fetch list of available identity providers
const providers = await concordiumController.getIdentityProviders();
```

#### Set Identity Provider

```javascript
// Set the identity provider to use
await concordiumController.setIdentityProvider(provider);
```

#### Create Identity Request

```javascript
// Create a new identity request
const identityRequest = await concordiumController.createIdentityRequest();
```

#### Send Identity Request

```javascript
// Send identity request to the provider
const redirectUrl = await concordiumController.sendIdentityRequest(identityRequest, 'your-redirect-uri');
```

#### Retrieve Identity

```javascript
// Retrieve the identity object after user completes verification
const identity = await concordiumController.retrieveIdentity(redirectUrl);
```

#### Initialize Identity

```javascript
// Initialize identity for account creation
await concordiumController.initializeIdentity(identity);
```

#### Clear Identity Flow

```javascript
// Clear current identity flow data
concordiumController.clearIdentityFlow();
```

### Account Management

#### Add Account

```javascript
// Create a new account
const account = await concordiumController.addAccount();
// Returns: { address: 'account-address' }
```

#### Get Accounts

```javascript
// Get all accounts
const addresses = await concordiumController.getAccounts();
```

#### Get Balance

```javascript
// Get balance for an account
const { balance } = await concordiumController.getBalance('account-address');
```

### Transaction Operations

#### Create Transfer Transaction

```javascript
// Create a transfer transaction
const transaction = await concordiumController.createTransferTransaction(
  'receiver-address',
  10, // Amount in CCD
  'sender-address'
);
```

#### Sign Transaction

```javascript
// Sign a transaction
const signature = await concordiumController.signTransaction(transaction);
```

#### Send Transaction

```javascript
// Send a signed transaction
const { transactionDetails } = await concordiumController.sendTransaction(transaction, signature);
```

### Recovery Operations

#### Restore Identity

```javascript
// Restore identity using seed phrase
const identity = await concordiumController.restoreIdentityDynamic();
```

#### Restore Accounts

```javascript
// Restore accounts from network
const accounts = await concordiumController.restoreAccounts();
```

## License

MIT
