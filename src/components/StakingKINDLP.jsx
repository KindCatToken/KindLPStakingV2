import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { ethers } from "ethers";
import { useWeb3ModalAccount } from "@web3modal/ethers/react";
import useContract from "../hooks/useContract";
import CountdownTimer from "./CountdownTimer";
import axios from "axios";

// ---- BSC TESTNET RPC + TEST TOKENS / PAIRS ----
const CUSTOM_RPC =
  "https://bsc-dataseed.bnbchain.org";
const KIND_ADDRESS = "0x41f52A42091A6B2146561bF05b722Ad1d0e46f8b";
const HUG_ADDRESS = "0x9A02eb2B692FaE1Ea01987d4851F647CD5Ba924f";
const KIND_WBNB_LP = "0x628C0fe6DA9854EDf0f3E2C7657af6ecf29C740E";
const HUG_WBNB_LP = "0x4c22D5CF4f11bfCCbed5c3a6B119C140FC716a93";

const pairAbi = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const lpMeta = {
  0: {
    label: "KIND / BNB Pool",
    tokenSymbol: "KIND",
    tokenAddress: KIND_ADDRESS,
    lpAddress: KIND_WBNB_LP,
  },
  1: {
    label: "HUG / BNB Pool",
    tokenSymbol: "HUG",
    tokenAddress: HUG_ADDRESS,
    lpAddress: HUG_WBNB_LP,
  },
};

// 4 default plans (Bronze / Silver / Gold / Diamond)
const DEFAULT_PLANS = [
  { id: 0, minUSD: 50, monthlyRateBps: 1000 }, // 10% / 30 days
  { id: 1, minUSD: 300, monthlyRateBps: 1500 }, // 15% / 30 days
  { id: 2, minUSD: 1500, monthlyRateBps: 2000 }, // 20% / 30 days
  { id: 3, minUSD: 10000, monthlyRateBps: 2700 }, // 27% / 30 days
];


const planNames = {
  1: "Bronze",
  2: "Silver",
  3: "Gold",
  4: "Platinum",
  5: "Diamond",
};


const KindLpStaking = () => {
  const { isConnected, address } = useWeb3ModalAccount();

  const {
    // staking
    getPlans,
    getPoolStats,
    getUserPositions,
    getReferralEarnings,
    stakeLP,
    claimPosition,
    unstakePosition,
    getPositionCounter,
    getUserLPBalance,
    // swap & liquidity
    getAmountsOut,
    swapTokens,
    addLiquidity,
  } = useContract();

  /* -------------------- REFERRER (URL ?ref=) -------------------- */
  const [referrer, setReferrer] = useState(
    "0x0000000000000000000000000000000000000000"
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    const zero = "0x0000000000000000000000000000000000000000";
    if (ref && /^0x[a-fA-F0-9]{40}$/.test(ref) && ref !== zero) {
      setReferrer(ref);
    } else {
      setReferrer(zero);
    }
  }, []);

  /* -------------------- PLANS (ALWAYS 4) -------------------- */
  const [plans, setPlans] = useState(DEFAULT_PLANS);

  useEffect(() => {
    let interval;

    const fetchPlans = async () => {
      try {
        const onchain = await getPlans(); // [{id,minUSD,monthlyRateBps},...]
        if (onchain && onchain.length >= 4) {
          const mapped = onchain.slice(0, 4).map((p, idx) => ({
            id: idx,
            minUSD: p.minUSD,
            monthlyRateBps: p.monthlyRateBps,
          }));
          setPlans(mapped);
        } else {
          setPlans(DEFAULT_PLANS);
        }
      } catch (e) {
        console.error("getPlans error:", e);
        setPlans(DEFAULT_PLANS);
      }
    };

    // initial load
    fetchPlans();
    // refresh every 30s
    interval = setInterval(fetchPlans, 30000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [getPlans]);

  /* -------------------- POOL SELECTION -------------------- */
  const [selectedPid, setSelectedPid] = useState(0); // default KIND/BNB

  /* -------------------- STATS & POSITIONS -------------------- */
  const [poolStats, setPoolStats] = useState({
    totalStakedLP: 0,
    totalStakedUSD: 0,
    totalBurnedToken: 0,
    totalBNBToDev: 0,
  });

  const [positions, setPositions] = useState([]);
  const [positionCounter, setPositionCounter] = useState(0);
  const [referralEarnings, setReferralEarnings] = useState(0);
  const [lpBalance, setLpBalance] = useState(0);

  // Only stats + positions + referral
  const refreshStats = useCallback(
    async () => {
      if (!address || !isConnected) return;

      // Skip if already running
      if (window.__refreshLock) return;
      window.__refreshLock = true;

      try {
        const stats = await getPoolStats(selectedPid);
        setPoolStats(stats);

        const counter = await getPositionCounter();
        setPositionCounter(counter);

        const { positions: allPos } = await getUserPositions(address);
        setPositions(allPos.filter((p) => p.pid === selectedPid));

        const refEarnings = await getReferralEarnings(address);
        setReferralEarnings(refEarnings);
      } catch (e) {
        console.log("refresh blocked:", e.message);
      }

      setTimeout(() => (window.__refreshLock = false), 5000); // only once per 5s
    },
    [selectedPid, address, isConnected, getPoolStats, getPositionCounter, getUserPositions, getReferralEarnings]
  );

  // LP balance – updated only when we explicitly call it
  const updateLpBalance = useCallback(
    async () => {
      try {
        if (!isConnected || !address) {
          setLpBalance(0);
          return;
        }
        const bal = await getUserLPBalance(selectedPid, address);
        setLpBalance(bal);
      } catch (err) {
        console.error("updateLpBalance error:", err);
      }
    },
    [isConnected, address, selectedPid, getUserLPBalance]
  );

  // Initial load + refresh stats + LP balance every 30s
  useEffect(() => {
    const run = () => {
      refreshStats();
      updateLpBalance();
    };

    run();
    const interval = setInterval(run, 30000);

    return () => clearInterval(interval);
  }, [refreshStats, updateLpBalance]);

  /* -------------------- LP PRICE IN USD (from pool stats) -------------------- */
  const lpPriceUSD = useMemo(() => {
    const totalLP = Number(poolStats.totalStakedLP || 0);
    const totalUSD = Number(poolStats.totalStakedUSD || 0);
    if (!totalLP || totalLP <= 0) return 0;
    const price = totalUSD / totalLP;
    if (!isFinite(price) || Number.isNaN(price)) return 0;
    return price;
  }, [poolStats.totalStakedLP, poolStats.totalStakedUSD]);

  /* Helper: compute stake USD for a position using live lpPriceUSD when available */
  const computeStakeUSD = useCallback(
    (pos) => {
      const lpAmt = Number(pos.lpAmount || 0);
      if (lpPriceUSD > 0 && lpAmt > 0) {
        const v = lpAmt * lpPriceUSD;
        return Number.isFinite(v) ? v : Number(pos.stakeUSD || 0);
      }
      // fallback to whatever backend reported
      return Number(pos.stakeUSD || 0);
    },
    [lpPriceUSD]
  );

  /* -------------------- USER TOTALS (THIS POOL) -------------------- */
  const userTotals = useMemo(() => {
    let totalLP = 0;
    let totalUSD = 0;
    let totalClaimableHUG = 0;
    let totalClaimableUSD = 0;

    positions.forEach((p) => {
      if (!p.closed) {
        totalLP += Number(p.lpAmount || 0);
        totalUSD += computeStakeUSD(p);
      }
      totalClaimableHUG += p.claimableReward || p.claimableHUG || 0;
      // keep claimableUSD from backend if present (HUG price source may differ)
      totalClaimableUSD += p.claimableUSD || 0;
    });

    return {
      totalLP,
      totalUSD,
      totalClaimableHUG,
      totalClaimableUSD,
    };
  }, [positions, computeStakeUSD]);

  /* -------------------- SWAP (BUY KIND / HUG) -------------------- */
  const [swapFrom, setSwapFrom] = useState("BNB");
  const [swapTo, setSwapTo] = useState("HUG");
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapEstimatedOut, setSwapEstimatedOut] = useState(0);
  const [swapLoading, setSwapLoading] = useState(false);

  // token list & prevent same token pair
  const tokenList = ["BNB", "KIND", "HUG"];

  const handleSwapFromChange = (value) => {
    if (value === swapTo) {
      setSwapTo(tokenList.find((t) => t !== value) || "KIND");
    }
    setSwapFrom(value);
    setSwapAmountIn("");
    setSwapEstimatedOut(0);
  };

  const handleSwapToChange = (value) => {
    if (value === swapFrom) {
      setSwapFrom(tokenList.find((t) => t !== value) || "BNB");
    }
    setSwapTo(value);
    setSwapAmountIn("");
    setSwapEstimatedOut(0);
  };

  // recalc estimate when input or pair changes
  useEffect(() => {
    const run = async () => {
      if (!swapAmountIn || Number(swapAmountIn) <= 0) {
        setSwapEstimatedOut(0);
        return;
      }
      try {
        const out = await getAmountsOut(swapFrom, swapTo, Number(swapAmountIn));
        setSwapEstimatedOut(out);
      } catch (e) {
        console.error("getAmountsOut error:", e);
        setSwapEstimatedOut(0);
      }
    };
    run();
  }, [swapAmountIn, swapFrom, swapTo, getAmountsOut]);

  const handleSwap = async () => {
    if (!isConnected) {
      toast.error("Please connect your wallet.");
      return;
    }
    if (!swapAmountIn || Number(swapAmountIn) <= 0) return;

    setSwapLoading(true);
    try {
      await swapTokens(swapFrom, swapTo, Number(swapAmountIn));
      toast.success("Swap successful!");
      setSwapAmountIn("");
      setSwapEstimatedOut(0);
    } catch (err) {
      console.error(err);
      toast.error("Swap failed");
    }
    setSwapLoading(false);
  };

  /* -------------------- ADD LIQUIDITY (AUTO OTHER SIDE) -------------------- */

  const currentLpMeta = lpMeta[selectedPid];
  const [liqTokenAmount, setLiqTokenAmount] = useState("");
  const [liqBnbAmount, setLiqBnbAmount] = useState("");
  const [liqLoading, setLiqLoading] = useState(false);

  // price ratios token <-> BNB for current pair
  const [ratioTokenPerBNB, setRatioTokenPerBNB] = useState(0); // token for 1 BNB
  const [ratioBNBPerToken, setRatioBNBPerToken] = useState(0); // BNB for 1 token

  const fetchPairRatio = useCallback(
    async () => {
      try {
        const provider = new ethers.JsonRpcProvider(CUSTOM_RPC);
        const pairContract = new ethers.Contract(
          currentLpMeta.lpAddress,
          pairAbi,
          provider
        );
        const [r0, r1] = await pairContract.getReserves();
        const t0 = await pairContract.token0();
        const t1 = await pairContract.token1();

        let tokenReserve, bnbReserve;
        if (t0.toLowerCase() === currentLpMeta.tokenAddress.toLowerCase()) {
          tokenReserve = Number(ethers.formatUnits(r0, 18));
          bnbReserve = Number(ethers.formatUnits(r1, 18));
        } else {
          tokenReserve = Number(ethers.formatUnits(r1, 18));
          bnbReserve = Number(ethers.formatUnits(r0, 18));
        }

        if (tokenReserve > 0 && bnbReserve > 0) {
          setRatioTokenPerBNB(tokenReserve / bnbReserve);
          setRatioBNBPerToken(bnbReserve / tokenReserve);
        } else {
          setRatioTokenPerBNB(0);
          setRatioBNBPerToken(0);
        }
      } catch (err) {
        console.error("fetchPairRatio error:", err);
        setRatioTokenPerBNB(0);
        setRatioBNBPerToken(0);
      }
    },
    [currentLpMeta.lpAddress, currentLpMeta.tokenAddress]
  );

  useEffect(() => {
    // reset inputs when switching pool
    setLiqTokenAmount("");
    setLiqBnbAmount("");

    const run = () => {
      fetchPairRatio();
    };

    // initial ratio
    run();
    // refresh ratio every 30s
    const interval = setInterval(run, 30000);

    return () => clearInterval(interval);
  }, [selectedPid, fetchPairRatio]);


  useEffect(() => {
  if (!liqTokenAmount && liqBnbAmount && ratioTokenPerBNB > 0) {
    setLiqTokenAmount((Number(liqBnbAmount) * ratioTokenPerBNB).toFixed(6));
  }
  if (!liqBnbAmount && liqTokenAmount && ratioBNBPerToken > 0) {
    setLiqBnbAmount((Number(liqTokenAmount) * ratioBNBPerToken).toFixed(6));
  }
}, [ratioTokenPerBNB, ratioBNBPerToken]);

 const handleLiqTokenChange = (val) => {
  setLiqTokenAmount(val);
  const num = Number(val);
  if (!isNaN(num) && num > 0 && ratioBNBPerToken > 0) {
    setLiqBnbAmount((num * ratioBNBPerToken).toFixed(6));
  } else {
    setLiqBnbAmount("");
  }
};

const handleLiqBnbChange = (val) => {
  setLiqBnbAmount(val);
  const num = Number(val);
  if (!isNaN(num) && num > 0 && ratioTokenPerBNB > 0) {
    setLiqTokenAmount((num * ratioTokenPerBNB).toFixed(6));
  } else {
    setLiqTokenAmount("");
  }
};

  const handleAddLiquidity = async () => {
    if (!isConnected) {
      toast.error("Please connect your wallet.");
      return;
    }
    if (!liqTokenAmount || !liqBnbAmount) {
      toast.error("Enter both token and BNB amounts");
      return;
    }
    setLiqLoading(true);
    try {
      await addLiquidity(
        currentLpMeta.tokenSymbol,
        Number(liqTokenAmount),
        Number(liqBnbAmount)
      );
      toast.success("Liquidity added! You received LP tokens.");
      setLiqTokenAmount("");
      setLiqBnbAmount("");
      await updateLpBalance(); // LP balance changed
    } catch (err) {
      console.error(err);
      toast.error("Add liquidity failed");
    }
    setLiqLoading(false);
  };

  /* -------------------- STAKE LP -------------------- */
  const [stakeAmount, setStakeAmount] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState(0);
  const [stakeLoading, setStakeLoading] = useState(false);

  const handleStake = async () => {
    if (!isConnected) {
      toast.error("Please connect your wallet.");
      return;
    }
    if (!stakeAmount || Number(stakeAmount) <= 0) return;

    setStakeLoading(true);
    try {
      await stakeLP(selectedPid, Number(stakeAmount), selectedPlanId, referrer);
      toast.success("LP staked successfully!");
      setStakeAmount("");
      await updateLpBalance(); // LP moved to contract
      await refreshStats(); // positions + stats changed
    } catch (err) {
      console.error(err);
      toast.error("Stake failed");
    }
    setStakeLoading(false);
  };

  /* -------------------- CLAIM / UNSTAKE -------------------- */
  const [claimLoading, setClaimLoading] = useState({});
  const [unstakeLoading, setUnstakeLoading] = useState({});
  const [showEarlyPopup, setShowEarlyPopup] = useState(false);
  const [earlyPositionId, setEarlyPositionId] = useState(null);

  const doClaim = async (positionId) => {
    setClaimLoading((prev) => ({ ...prev, [positionId]: true }));
    try {
      await claimPosition(positionId);
      toast.success("Claim successful!");
      await refreshStats(); // claimables + totals changed
    } catch (err) {
      console.error(err);
      toast.error("Claim failed");
    }
    setClaimLoading((prev) => ({ ...prev, [positionId]: false }));
  };

  const doUnstake = async (positionId) => {
    setUnstakeLoading((prev) => ({ ...prev, [positionId]: true }));
    try {
      await unstakePosition(positionId);
      toast.success("Unstake successful!");
      await updateLpBalance(); // LP back to wallet
      await refreshStats(); // positions + stats changed
    } catch (err) {
      console.error(err);
      toast.error("Unstake failed");
    }
    setUnstakeLoading((prev) => ({ ...prev, [positionId]: false }));
  };

  const handleUnstakeClick = (pos) => {
    const now = Math.floor(Date.now() / 1000);
    const isEarly = now < pos.endTime;
    if (isEarly) {
      setEarlyPositionId(pos.id);
      setShowEarlyPopup(true);
    } else {
      doUnstake(pos.id);
    }
  };

  /* -------------------- FORMATTER -------------------- */
  const fmt = (num, decimals = 4) => {
    const n = Number(num || 0);
    if (!isFinite(n)) return "0";
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  };



  const planNames = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];



const CUSTOM_RPC = "https://bsc-dataseed.bnbchain.org";

const pairAbi = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];






// ---- RPC & pair ABI already defined ----
const getTokenPriceFromLP = async (tokenAddress, lpAddress, bnbPriceUSD) => {
  if (!bnbPriceUSD || bnbPriceUSD <= 0) return 0;

  const provider = new ethers.JsonRpcProvider(CUSTOM_RPC);
  const pairContract = new ethers.Contract(lpAddress, pairAbi, provider);

  const [reserves, token0, token1] = await Promise.all([
    pairContract.getReserves(),
    pairContract.token0(),
    pairContract.token1(),
  ]);

  let tokenReserve, bnbReserve;

  if (token0.toLowerCase() === tokenAddress.toLowerCase()) {
    tokenReserve = Number(ethers.formatUnits(reserves[0], 18));
    bnbReserve = Number(ethers.formatUnits(reserves[1], 18));
  } else {
    tokenReserve = Number(ethers.formatUnits(reserves[1], 18));
    bnbReserve = Number(ethers.formatUnits(reserves[0], 18));
  }

  if (tokenReserve <= 0 || bnbReserve <= 0) return 0;

  const priceInBNB = bnbReserve / tokenReserve;
  return priceInBNB * bnbPriceUSD; // token price in USD
};

const getUserTokenBalanceUSD = async (tokenAddress, userAddress, tokenPriceUSD) => {
  const provider = new ethers.JsonRpcProvider(CUSTOM_RPC);
  const tokenContract = new ethers.Contract(tokenAddress, [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ], provider);

  const [balance, decimals] = await Promise.all([
    tokenContract.balanceOf(userAddress),
    tokenContract.decimals(),
  ]);

  const bal = Number(ethers.formatUnits(balance, decimals));
  return {
    balance: bal,
    balanceUSD: bal * tokenPriceUSD
  };
};


const [bnbPriceUSD, setBnbPriceUSD] = useState(0);
const [tokenPriceUSD, setTokenPriceUSD] = useState(0);
const [userTokenBalance, setUserTokenBalance] = useState(0);
const [userTokenBalanceUSD, setUserTokenBalanceUSD] = useState(0);

// 1️⃣ Fetch BNB price
const fetchBnbPrice = useCallback(async () => {
  try {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd"
    );
    setBnbPriceUSD(res.data.binancecoin.usd || 0);
  } catch (err) {
    console.error("Failed to fetch BNB price", err);
    setBnbPriceUSD(0);
  }
}, []);

useEffect(() => { fetchBnbPrice(); }, [fetchBnbPrice]);

// 2️⃣ Fetch token price using LP
const fetchTokenPrice = useCallback(async () => {
  if (!bnbPriceUSD || bnbPriceUSD <= 0) return;
  try {
    const price = await getTokenPriceFromLP(currentLpMeta.tokenAddress, currentLpMeta.lpAddress, bnbPriceUSD);
    setTokenPriceUSD(price);
  } catch (err) {
    console.error("Failed to fetch token price", err);
    setTokenPriceUSD(0);
  }
}, [bnbPriceUSD, currentLpMeta.tokenAddress, currentLpMeta.lpAddress]);

useEffect(() => { fetchTokenPrice(); }, [fetchTokenPrice]);

// 3️⃣ Fetch user token balance and USD value
const fetchUserBalanceUSD = useCallback(async () => {
  if (!isConnected || !address || tokenPriceUSD <= 0) return;
  try {
    const { balance, balanceUSD } = await getUserTokenBalanceUSD(currentLpMeta.tokenAddress, address, tokenPriceUSD);
    setUserTokenBalance(balance);
    setUserTokenBalanceUSD(balanceUSD);
  } catch (err) {
    console.error("Failed to fetch user token balance", err);
    setUserTokenBalance(0);
    setUserTokenBalanceUSD(0);
  }
}, [isConnected, address, currentLpMeta.tokenAddress, tokenPriceUSD]);

useEffect(() => { fetchUserBalanceUSD(); }, [fetchUserBalanceUSD]);



  
  /* =========================== RENDER =========================== */

  return (
    <div className="min-h-screen text-white font-sans px-2 sm:px-4 py-10">
      <div className="max-w-[1200px] mx-auto space-y-6">
        {/* Header line */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
           
            <p className="text-sm text-gray-300 mt-1">
              Provide KIND/BNB or HUG/BNB liquidity, stake your LP tokens and
              earn daily rewards in HUG.
            </p>
          </div>
          <div className="text-xs sm:text-sm text-gray-300">
            Total Staking Positions:&nbsp;
            <span className="text-[#ffd166] font-semibold">
              {positionCounter}
            </span>
          </div>
        </div>

        {/* BUY + ADD LIQUIDITY (2 columns, no background) */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* BUY KIND / HUG */}
          <div className="border border-[#ffd16655] rounded-xl p-4 flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-[#ffd166]">
              Buy KIND / HUG
            </h2>

            {/* FROM / TO */}
            <div className="flex items-center gap-3">
              {/* FROM */}
              <div className="flex-1">
                <label className="text-[11px] text-gray-400">From</label>
                <select
                  value={swapFrom}
                  onChange={(e) => handleSwapFromChange(e.target.value)}
                  className="
                    w-full bg-black border border-[#ffd16655] rounded px-3 py-2 text-sm cursor-pointer
                    focus:outline-none focus:border-[#ffd166]
                    hover:border-[#ffd166] transition-all duration-200
                  "
                >
                  <option value="BNB">BNB</option>
                  <option value="KIND">KIND</option>
                  <option value="HUG">HUG</option>
                </select>
              </div>

              {/* Arrow */}
              <div className="mt-6 text-[#ffd166] font-bold text-lg">⇄</div>

              {/* TO */}
              <div className="flex-1">
                <label className="text-[11px] text-gray-400">To</label>
                <select
                  value={swapTo}
                  onChange={(e) => handleSwapToChange(e.target.value)}
                  className="
                    w-full bg-black border border-[#ffd16655] rounded px-3 py-2 text-sm cursor-pointer
                    focus:outline-none focus:border-[#ffd166]
                    hover:border-[#ffd166] transition-all duration-200
                  "
                >
                  <option value="KIND">KIND</option>
                  <option value="HUG">HUG</option>
                </select>
              </div>
            </div>

            {/* INPUT AMOUNT */}
            <div>
              <label className="text-[11px] text-gray-400">Amount</label>
              <input
                type="number"
                min="0"
                value={swapAmountIn}
                onChange={(e) => setSwapAmountIn(e.target.value)}
                placeholder={`Enter ${swapFrom} amount`}
                className="
                  w-full bg-black border border-[#ffd16655] rounded px-3 py-2 text-sm
                  focus:outline-none focus:border-[#ffd166]
                  hover:border-[#ffd166] transition-all duration-200
                "
              />
            </div>

            {/* ESTIMATED OUTPUT BOX */}
            <div
              className="
                bg-black border border-[#ffd16655] rounded-lg px-3 py-2 text-sm
                text-gray-200 mt-1
              "
            >
              <div className="text-[11px] text-gray-400">
                You will receive
              </div>
              <div className="text-lg font-semibold text-[#ffd166]">
                {swapEstimatedOut > 0
                  ? fmt(swapEstimatedOut, 6)
                  : "0.000000"}{" "}
                {swapTo}
              </div>
            </div>

            {/* BUTTON */}
            <button
              onClick={handleSwap}
              disabled={swapLoading}
              className="
                mt-2 w-full rounded-full
                bg-gradient-to-r from-[#ffd166] via-[#ff9f1c] to-[#5c3b00]
                text-black font-semibold py-2 text-sm
                hover:brightness-110 disabled:opacity-60 transition-all
              "
            >
              {swapLoading ? "Processing..." : `Swap ${swapFrom} → ${swapTo}`}
            </button>
          </div>

          {/* ADD LIQUIDITY */}
          <div className="border border-[#ffd16655] rounded-xl p-4 flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-[#ffd166]">
              Add Liquidity
            </h2>

            {/* Pair toggle */}
            <div className="flex gap-2 text-xs">
              {Object.entries(lpMeta).map(([pid, meta]) => (
                <button
                  key={pid}
                  onClick={() => setSelectedPid(Number(pid))}
                  className={`flex-1 rounded-full px-2 py-1 border ${
                    selectedPid === Number(pid)
                      ? "bg-[#ffd166] text-black border-[#ffd166]"
                      : "bg-transparent border-[#ffd16655] text-gray-200"
                  }`}
                >
                  {meta.tokenSymbol} / BNB
                </button>
              ))}
            </div>

            <div className="text-xs text-gray-300">
              Provide {currentLpMeta.tokenSymbol}/BNB liquidity to receive LP
              tokens.
            </div>

            {/* Token amount */}
       {/* Token amount */}
<div className="flex flex-col gap-1">
  <label className="text-xs text-gray-400 flex justify-between items-center">
    {currentLpMeta.tokenSymbol} Amount
    <span className="text-[11px] text-gray-400">
      Your Balance:{" "}
      <span className="text-[#ffd166] font-semibold">
        {fmt(userTokenBalance, 6)} ({fmt(userTokenBalanceUSD, 2)} USD)
      </span>
    </span>
  </label>

 <div className="relative w-full">
  <input
    type="number"
    min="0"
    value={liqTokenAmount}
    onChange={(e) => handleLiqTokenChange(e.target.value)}
    placeholder={`Amount of ${currentLpMeta.tokenSymbol}`}
    className="w-full bg-transparent border border-[#ffd16655] rounded px-3 py-2 pr-12 text-sm"
  />
  <button
    type="button"
    onClick={() => handleLiqTokenChange(userTokenBalance.toString())} // call handler
    className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-[#ffd166] text-black text-xs font-semibold hover:brightness-110"
  >
    Max
  </button>
</div>

</div>



            {/* BNB amount */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">BNB Amount</label>
              <input
                type="number"
                min="0"
                value={liqBnbAmount}
                onChange={(e) => handleLiqBnbChange(e.target.value)}
                placeholder="Amount of BNB"
                className="w-full bg-transparent border border-[#ffd16655] rounded px-3 py-2 text-sm"
              />
              <span className="text-[11px] text-gray-500">
                Amounts auto-match current pool ratio.
              </span>
            </div>

            <button
              onClick={handleAddLiquidity}
              disabled={liqLoading}
              className="mt-1 w-full rounded-full bg-gradient-to-r from-[#ffd166] via-[#ff9f1c] to-[#5c3b00] text-black font-semibold py-2 text-sm hover:brightness-110 disabled:opacity-60"
            >
              {liqLoading
                ? "Adding Liquidity..."
                : `Add ${currentLpMeta.tokenSymbol}/BNB Liquidity`}
            </button>
          </div>
        </div>

        {/* STAKE + REFERRAL ROW */}
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {/* Stake LP */}
          <div className="border border-[#ffd16655] rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#ffd166]">
                Stake LP ({currentLpMeta.tokenSymbol}/BNB)
              </h2>
<div className="text-xs text-gray-400 flex gap-1 items-center">
  <span>LP Balance:</span>

  <span className="text-[#ffd166] font-semibold">
    {fmt(lpBalance, 6)} LP
  </span>

  <span
    className={`text-[11px] ${
      lpPriceUSD > 0 ? "text-[#ffd166]" : "text-gray-500"
    }`}
  >
    (~${fmt(Number(lpBalance || 0) * lpPriceUSD, 2)})
  </span>
</div>


            </div>

            <div className="text-[11px] text-gray-400">
              Plans have a fixed 90-day lock. Early unstake penalty:
              <span className="text-[#ffd166]"> 15%</span>.
            </div>

            <div className="relative">
              <input
                type="number"
                min="0"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="LP amount to stake"
                className="w-full bg-transparent border border-[#ffd16655] rounded px-3 py-2 text-sm pr-16"
              />
              <button
                type="button"
                onClick={() => setStakeAmount(lpBalance.toString())}
                className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 rounded bg-[#ffd166] text-black text-xs font-semibold"
              >
                Max
              </button>
            </div>

            {lpPriceUSD > 0 &&
              stakeAmount &&
              Number(stakeAmount) > 0 && (
                <div className="mt-1 text-[11px] text-gray-400">
                  ≈ $
                  {fmt(Number(stakeAmount || 0) * lpPriceUSD, 2)} USD
                </div>
              )}

            {/* 4 Plans */}
            <div className="grid sm:grid-cols-4 gap-2 mt-2 text-xs">
         {plans.map((p) => (
  <button
    key={p.id}
    onClick={() => setSelectedPlanId(p.id)}
    className={`border rounded-lg p-2 text-left transition-all ${
      selectedPlanId === p.id
        ? "border-[#ffd166] bg-[#ffd16622]"
        : "border-[#ffd16655]"
    }`}
  >
    <div className="font-semibold text-[#ffd166]">
      {planNames[p.id]}
    </div>

    <div className="mt-1 text-[11px] text-gray-300">
      Min: ${fmt(p.minUSD, 2)}
    </div>

    <div className="mt-1 text-[11px] text-gray-300">
      {(p.monthlyRateBps / 100).toFixed(1)}% / 30 days
    </div>
  </button>
))}
            </div>

            <button
              onClick={handleStake}
              disabled={stakeLoading}
              className="mt-3 w-full rounded-full bg-gradient-to-r from-[#ffd166] via-[#ff9f1c] to-[#5c3b00] text-black font-semibold py-2 text-sm hover:brightness-110 disabled:opacity-60"
            >
              {stakeLoading ? "Staking..." : "Stake LP Now"}
            </button>
          </div>

          {/* Referral */}
          <div className="border border-[#ffd16655] rounded-xl p-4 flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-[#ffd166]">Referral</h2>
            <p className="text-[11px] text-gray-300">
              Earn <span className="text-[#ffd166]">5%</span> in HUG on your
              referral&apos;s first stake and{" "}
              <span className="text-[#ffd166]">2%</span> on all of their
              claims.
            </p>

            <div className="border border-[#ffd16633] rounded-lg p-3 text-sm">
              <div className="text-xs text-gray-400">Your Referral Earnings</div>
              <div className="mt-1 text-xl font-bold">
                {fmt(referralEarnings, 4)} HUG
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                (USD value depends on HUG price)
              </div>
            </div>

            <div className="text-xs text-gray-400 mt-2">Your referral link</div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={
                  isConnected
                    ? `${window.location.origin}?ref=${address}`
                    : "Connect wallet to get your link"
                }
                className="flex-1 bg-transparent border border-[#ffd16655] rounded px-3 py-2 text-xs"
              />
              {isConnected && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${window.location.origin}?ref=${address}`
                      );
                      toast.success("Referral link copied!");
                    } catch {
                      toast.error("Failed to copy link");
                    }
                  }}
                  className="px-3 py-2 rounded bg-[#ffd166] text-black text-xs font-semibold hover:brightness-110"
                >
                  Copy
                </button>
              )}
            </div>
          </div>
        </div>

        {/* YOUR TOTALS */}
        <div className="border border-[#ffd16655] rounded-xl p-4 flex flex-col gap-3 mt-2">
          <h2 className="text-lg font-semibold text-[#ffd166]">
            Your Totals ({currentLpMeta.tokenSymbol}/BNB)
          </h2>
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div className="border border-[#ffd16633] rounded-lg p-3">
              <div className="text-xs text-gray-400">Total LP Staked</div>
              <div className="mt-1 text-xl font-bold">
                {fmt(userTotals.totalLP, 6)} LP
                {userTotals.totalUSD > 0 && (
                  <span className="text-[11px] text-gray-400">
                    {" "}
                    (${fmt(userTotals.totalUSD, 2)})
                  </span>
                )}
              </div>
            </div>
            <div className="border border-[#ffd16633] rounded-lg p-3">
              <div className="text-xs text-gray-400">Total Stake Value</div>
              <div className="mt-1 text-xl font-bold">
                ${fmt(userTotals.totalUSD, 2)} USD
              </div>
            </div>
            <div className="border border-[#ffd16633] rounded-lg p-3">
              <div className="text-xs text-gray-400">
                Claimable HUG (from this pool)
              </div>
              <div className="mt-1 text-xl font-bold">
                {fmt(userTotals.totalClaimableHUG, 4)} HUG
              </div>
              <div className="text-[11px] text-gray-500">
                ≈ ${fmt(userTotals.totalClaimableUSD, 2)} USD
              </div>
            </div>
          </div>
        </div>

        {/* POOL STATS */}
        <div className="border border-[#ffd16655] rounded-xl p-4 flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-[#ffd166]">
            Pool Stats ({currentLpMeta.tokenSymbol}/BNB)
          </h2>
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div className="border border-[#ffd16633] rounded-lg p-3">
              <div className="text-xs text-gray-400">Total LP Staked</div>
              <div className="mt-1 text-lg font-bold">
                {fmt(poolStats.totalStakedLP, 6)} LP
                {poolStats.totalStakedUSD > 0 && (
                  <span className="text-[11px] text-gray-400">
                    {" "}
                    (${fmt(poolStats.totalStakedUSD, 2)})
                  </span>
                )}
              </div>
            </div>
            <div className="border border-[#ffd16633] rounded-lg p-3">
              <div className="text-xs text-gray-400">Total Stake Value</div>
              <div className="mt-1 text-lg font-bold">
                ${fmt(poolStats.totalStakedUSD, 2)} USD
              </div>
            </div>
            <div className="border border-[#ffd16633] rounded-lg p-3">
              <div className="text-xs text-gray-400">
                Total Token Burned 
              </div>
              <div className="mt-1 text-lg font-bold">
                {fmt(poolStats.totalBurnedToken, 4)}
              </div>
            </div>
           
          </div>
        </div>

        {/* POSITIONS TABLE */}
       <div className="border border-[#ffd16655] rounded-xl p-4 mt-2 relative">
  <h2 className="text-lg font-semibold text-[#ffd166] mb-3">
    Staking Positions ({currentLpMeta.tokenSymbol}/BNB)
  </h2>

  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs sm:text-sm border-collapse">
      <thead>
        <tr className="border-b border-[#ffd16633]">
          <th className="p-2">LP Amount</th>
          <th className="p-2">Stake Value</th>
          <th className="p-2">Plan</th>
          <th className="p-2">Start</th>
          <th className="p-2">End</th>
          <th className="p-2">Claimable</th>
          <th className="p-2">Status</th>
          <th className="p-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {positions.length === 0 && (
          <tr>
            <td colSpan={8} className="text-center p-4 text-gray-400 text-xs">
              No positions found for this pool.
            </td>
          </tr>
        )}

        {positions.map((pos) => {
          const now = Math.floor(Date.now() / 1000);
          const isEarly = now < pos.endTime;
          const status = !pos.closed
            ? "Active"
            : pos.claimableReward > 0 || pos.claimableHUG > 0
            ? "Closed (Claimable)"
            : "Closed";

          const stakeUsdComputed = computeStakeUSD(pos);

          return (
            <tr key={pos.id} className="border-b border-[#ffd16622] align-top">
              <td className="p-2">
                {fmt(pos.lpAmount, 6)} LP
                {stakeUsdComputed > 0 && (
                  <span className="text-[11px] text-gray-400">
                    {" "}(${fmt(stakeUsdComputed, 2)})
                  </span>
                )}
              </td>
              <td className="p-2">${fmt(stakeUsdComputed, 2)} USD</td>
              <td className="p-2">
                {["🥉 Bronze","🥈 Silver","🥇 Gold","💎 Diamond"][pos.planId] || `Plan #${pos.planId + 1}`}
                <br />
                <span className="text-[11px] text-gray-400">
                  {(Number(pos.monthlyRateBps || 0) / 100).toFixed(1)}% / 30 days
                </span>
              </td>
              <td className="p-2 text-[11px] text-gray-300">
                {pos.startTime ? new Date(pos.startTime * 1000).toLocaleString() : "-"}
              </td>
              <td className="p-2 text-[11px] text-gray-300">
                {pos.endTime ? new Date(pos.endTime * 1000).toLocaleString() : "-"}
                {isEarly && !pos.closed && (
                  <div className="mt-1">
                    <CountdownTimer nextClaimTimestamp={pos.endTime} />
                  </div>
                )}
              </td>
              <td className="p-2 text-[11px]">
                {fmt(pos.claimableReward || pos.claimableHUG || 0, 4)} HUG
                <br />
                <span className="text-gray-400">
                  ≈ ${fmt(pos.claimableUSD || 0, 2)}
                </span>
              </td>
              <td className="p-2 text-[11px] flex items-center gap-1">
                {status === "Active" && (
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                )}
                {(status === "Closed" || status === "Closed (Claimable)") && (
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                )}
                {status}
              </td>
              <td className="p-2">
                <div className="flex flex-col gap-1">
                  {/* CLAIM */}
                  <button
                    onClick={() => doClaim(pos.id)}
                    disabled={(pos.claimableReward || pos.claimableHUG || 0) <= 0 || claimLoading[pos.id]}
                    className="px-2 py-1 rounded-full bg-gradient-to-r from-[#ffd166] via-[#ff9f1c] to-[#5c3b00] text-black text-[11px] font-semibold hover:brightness-110 disabled:opacity-50"
                  >
                    {claimLoading[pos.id] ? "Claiming..." : "Claim"}
                  </button>

                  {/* UNSTAKE */}
                  <button
                    onClick={() => handleUnstakeClick(pos)}
                    disabled={unstakeLoading[pos.id] || pos.closed || !isEarly}
                    className="px-2 py-1 rounded-full border border-[#ffd16655] text-[#ffd166] text-[11px] font-semibold hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {unstakeLoading[pos.id] ? "Unstaking..." : "Unstake"}
                    {isEarly && !pos.closed && (
                      <span className="text-xs text-yellow-400">⚠</span>
                    )}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>

  {/* Early Unstake Popup */}
  {showEarlyPopup && earlyPositionId != null && positions.find(p => p.id === earlyPositionId && !p.closed) && (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-10">
      <div className="border border-[#ffd166] rounded-xl p-5 max-w-sm text-center bg-black">
        <h3 className="text-lg font-semibold text-[#ffd166] mb-2">
          Early Unstake Warning
        </h3>
        <p className="text-sm text-gray-200 mb-4">
          Unstaking before the 90-day lock ends will incur a{" "}
          <span className="font-bold text-[#ffd166]">15% LP fee</span>{" "}
          which is used for burns and development. Are you sure?
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => {
              setShowEarlyPopup(false);
              setEarlyPositionId(null);
            }}
            className="px-4 py-2 rounded-lg border border-[#ffd166] text-[#ffd166] text-sm font-semibold hover:brightness-110 bg-transparent"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (earlyPositionId != null) doUnstake(earlyPositionId);
              setShowEarlyPopup(false);
              setEarlyPositionId(null);
            }}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#ffd166] via-[#ff9f1c] to-[#5c3b00] text-black text-sm font-semibold hover:brightness-110"
          >
            Confirm Unstake
          </button>
        </div>
      </div>
    </div>
  )}
</div>

      </div>
    </div>
  );
};

export default KindLpStaking;
