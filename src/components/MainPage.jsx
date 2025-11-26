import React, { useEffect, useState } from "react";
import { format } from "mathjs";
import styled from "styled-components";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import useContract from "../hooks/useContract";
import { useWeb3ModalAccount } from "@web3modal/ethers/react";
import { useWeb3Modal } from "@web3modal/ethers/react";
import ClipLoader from "react-spinners/ClipLoader";
import { FaTelegramPlane, FaYoutube } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { PRESALE_CONTRACT_ADDRESS } from "../contracts/contracts";
import { JsonRpcProvider, Contract, formatUnits } from "ethers";
import dayjs from 'dayjs';

import { TOKEN_CONTRACT_ADDRESS,TOKEN_ABI } from "../contracts/contracts";


import StakingHAI from "./StakingKINDLP";
import Footer from "./Footer";
import { ethers } from "ethers";

// import { FaTelegramPlane } from "react-icons/fa";
// import { FaDiscord } from "react-icons/fa";
// import { FaTwitter } from "react-icons/fa";
// import Iconslink from "../assets/Linktree-Emblem-removebg-preview.png";
// import Roadmap from "../assets/RMupdate.jpg";
// import AutoSlider from "./AutoSlider.js";

const override = {
  display: "block",
  margin: "0 auto",
  borderColor: "red",
};




const MainPage = () => {

    const { open } = useWeb3Modal();
    const { isConnected, address } = useWeb3ModalAccount();

  

  

  

  
  

  
  
  
  
  
  
  
  

  
  
  
  
  
  
  
  

  
    


  
  
  
  
  
  
  













    


  


  
  





  

  













  
  

  


  




















 
  



















































   const [showStaking, setShowStaking] = useState(false);


  return (
    <>
  



<div className="main-content">
     <header className="w-full  text-white px-4 py-3 flex items-center justify-between">
       {/* Logo Left */}
     <Link to="/" className="flex items-center space-x-2">
  <img src="/kindlogo.png" alt="Logo" className="h-12 sm:h-20" /> {/* smaller on mobile */}
  <span className="text-xl sm:text-3xl font-bold text-[#b8860b]">KindCat</span> {/* smaller on mobile */}
</Link>

 
       {/* Wallet Button Right */}
<button
  className="px-4 py-2 bg-gradient-to-br from-[#ffd166] via-[#ff9f1c] to-[#5c3b00] rounded-md font-semibold hover:brightness-110 transition"
  style={{ color: "#fff8e8" }}
  onClick={isConnected ? () => open("Account") : () => open("Connect")}
>
  {isConnected
    ? `${address?.substring(0, 4)}...${address?.slice(-4)}`
    : "Connect Wallet"}
</button>


     </header>

  <StakingHAI onBuyClick={() => setShowStaking(false)} />
  <Footer />
</div>



    </>

    
    
  );
};

export default MainPage;
