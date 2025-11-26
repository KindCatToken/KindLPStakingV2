import React, { useEffect } from "react";
import RoutesFile from "./RoutesFile";
import { createWeb3Modal, defaultConfig, useWeb3Modal } from "@web3modal/ethers/react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import "./App.css";

// 1. Get projectId
const projectId = "";

const BscNetwork = {
  chainId: 56,
  name: "Binance Smart Chain",
  currency: "BNB",
  explorerUrl: "https://bscscan.com/",
  rpcUrl: "",
};


const BscTestNetwork = {
  chainId: 97,
  name: "Binance Smart Chain",
  currency: "BNB",
  explorerUrl: "https://testnet.bscscan.com/",
  rpcUrl: "",
};

// 3. Create a metadata object
const metadata = {
  name: "KindCat Liquidity Staking",
  description: "Welcome to KindCat Liquidity. Stake KIND/BNB HUG/BNB & earn $HUG!",
  url: "http://www.kindwealthengine.xyz/", // origin must match your domain & subdomain
  icons: ["http://www.kindwealthengine.xyz/kindlogo.png"],
};

// 4. Create Ethers config
const ethersConfig = defaultConfig({
  metadata,
});

// 5. Create a Web3Modal instance
createWeb3Modal({
  ethersConfig,
  chains: [BscNetwork],
  projectId,
  enableAnalytics: true,
  // Let Web3Modal restore the last session on refresh:
  // use ONE of these depending on your version:
  // enableAutoConnect: true,
  enableReconnect: true
});


function App() {
  const { isConnected, disconnect } = useWeb3Modal();

  useEffect(() => {
    if (isConnected) {
      // Auto disconnect after 10 minutes (600000 ms)
      const timer = setTimeout(() => {
        disconnect()
          .then(() => {
            toast.info("Wallet disconnected automatically after inactivity.");
          })
          .catch((error) => {
            toast.error(`Error disconnecting wallet: ${error.message}`);
          });
      }, 100000);

      return () => clearTimeout(timer);
    }
  }, [isConnected, disconnect]);

  return (
    <>
      <RoutesFile />
      <ToastContainer />
    </>
  );
}

export default App;
