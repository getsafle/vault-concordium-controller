const NETWORKS = {
  Testnet: {
    nodeAddress: "https://grpc.testnet.concordium.com",
    nodePort: 20000,
    walletProxyUrl: "https://wallet-proxy.testnet.concordium.com",
    timeout: 30000,
    maxRetries: 3,
  },
  Mainnet: {
    nodeAddress: "https://grpc.mainnet.concordium.software",
    nodePort: 20001,
    walletProxyUrl: "https://wallet-proxy.mainnet.concordium.software",
    timeout: 30000,
    maxRetries: 3,
  },
};

module.exports = { NETWORKS };
