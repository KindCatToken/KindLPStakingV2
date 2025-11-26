// hooks/useContract.js
import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  formatUnits,
  parseUnits,
  BigNumber
} from "ethers";
import {
  useWeb3ModalProvider,
  useWeb3ModalAccount,
} from "@web3modal/ethers/react";
import { useCallback } from "react";
import {
  STAKING_CONTRACT_ADDRESS,
  STAKING_ABI,
} from "../contracts/contracts";

// ================== CONFIG (FILL THESE) ==================
const CUSTOM_RPC =
  "https://bsc-dataseed.bnbchain.org"; // BSC testnet RPC

// token addresses
const KIND_ADDRESS = "0x41f52A42091A6B2146561bF05b722Ad1d0e46f8b";
const HUG_ADDRESS = "0x9A02eb2B692FaE1Ea01987d4851F647CD5Ba924f";
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

// LP pair addresses (KIND/WBNB & HUG/WBNB)
const KIND_WBNB_LP = "0x628C0fe6DA9854EDf0f3E2C7657af6ecf29C740E";
const HUG_WBNB_LP = "0x4c22D5CF4f11bfCCbed5c3a6B119C140FC716a93";

// Pancake router (CHANGE if needed)
// Mainnet v2: 0x10ED43C718714eb63d5aA57B78B54704E256024E
// Testnet v2: 0x10ED43C718714eb63d5aA57B78B54704E256024E
const ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

// generic ERC20
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() view returns (uint8)",
];

// Router ABIs
const routerSwapABI = [
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
];

const routerViewABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory)",
];

const routerLiquidityABI = [
  "function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
];

// mapping of human symbols → addresses
const tokenAddresses = {
  BNB: WBNB_ADDRESS, // wrapped BNB inside path; native BNB will be sent as value
  KIND: KIND_ADDRESS,
  HUG: HUG_ADDRESS,
};

const tokenDecimals = {
  BNB: 18,
  KIND: 18,
  HUG: 18,
};

// LP by pool id (pid)
const LP_BY_PID = {
  0: KIND_WBNB_LP,
  1: HUG_WBNB_LP,
};

function useContract() {
  const { walletProvider } = useWeb3ModalProvider();
  const { address, isConnected } = useWeb3ModalAccount();

  // read-only provider
  const readProvider = new JsonRpcProvider(CUSTOM_RPC);

  const getReadStaking = () =>
    new Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI, readProvider);

  const getWriteStaking = async () => {
    if (!walletProvider) throw new Error("No wallet provider");
    const provider = new BrowserProvider(walletProvider);
    const signer = await provider.getSigner();
    return new Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI, signer);
  };

  const getSignerAndRouter = useCallback(async () => {
    if (!walletProvider) throw new Error("No wallet provider");
    const provider = new BrowserProvider(walletProvider);
    const signer = await provider.getSigner();
    const routerSwap = new Contract(ROUTER_ADDRESS, routerSwapABI, signer);
    const routerLiquidity = new Contract(
      ROUTER_ADDRESS,
      routerLiquidityABI,
      signer
    );
    return { signer, routerSwap, routerLiquidity };
  }, [walletProvider]);

  // ======================= STAKING READ =======================

  // Fetch all plans from contract
  const getPlans = useCallback(async () => {
    try {
      const staking = getReadStaking();
      const rawPlans = await staking.getPlans(); // Plan[]: {minUSD, monthlyRateBps}
      return rawPlans.map((p, idx) => ({
        id: idx,
        minUSD: Number(formatUnits(p.minUSD, 18)),
        monthlyRateBps: Number(p.monthlyRateBps),
      }));
    } catch (err) {
      console.error("getPlans error:", err);
      return [];
    }
  }, []);

  // Fetch pool stats (per pid)
  const getPoolStats = useCallback(async (pid) => {
    try {
      const staking = getReadStaking();
      const [totalStakedLP, totalStakedUSD, totalBurnedToken, totalBNBToDev] =
        await staking.poolStats(pid);

      return {
        totalStakedLP: Number(formatUnits(totalStakedLP, 18)),
        totalStakedUSD: Number(formatUnits(totalStakedUSD, 18)),
        totalBurnedToken: Number(formatUnits(totalBurnedToken, 18)),
        totalBNBToDev: Number(formatUnits(totalBNBToDev, 18)),
      };
    } catch (err) {
      console.error("getPoolStats error:", err);
      return {
        totalStakedLP: 0,
        totalStakedUSD: 0,
        totalBurnedToken: 0,
        totalBNBToDev: 0,
      };
    }
  }, []);

  // Fetch all user positions and computed totals
  const getUserPositions = useCallback(
    async (userAddress) => {
      const user = userAddress || address;
      if (!user) return { positions: [], totals: {} };

      try {
        const staking = getReadStaking();
        const ids = await staking.positionsOf(user); // uint256[]

        const plans = await getPlans();
        const positions = [];
        let totalStakeUSD = 0;
        let totalLP = 0;
        let totalClaimableReward = 0;
        let totalClaimableUSD = 0;

        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const [pos, claimableUSDRaw, claimableRewardRaw] =
            await staking.positionInfo(id);

          const pid = Number(pos.pid);
          const lpAmount = Number(formatUnits(pos.lpAmount, 18));
          const stakeUSD = Number(formatUnits(pos.stakeUSD, 18));
          const planId = Number(pos.planId);
          const plan = plans.find((p) => p.id === planId) || {
            minUSD: 0,
            monthlyRateBps: 0,
          };

          const claimableUSD = Number(formatUnits(claimableUSDRaw, 18));
          const claimableReward = Number(formatUnits(claimableRewardRaw, 18));

          totalStakeUSD += stakeUSD;
          totalLP += lpAmount;
          totalClaimableUSD += claimableUSD;
          totalClaimableReward += claimableReward;

          positions.push({
            id: Number(id),
            pid,
            lpAmount,
            stakeUSD,
            planId,
            monthlyRateBps: plan.monthlyRateBps,
            startTime: Number(pos.startTime),
            endTime: Number(pos.endTime),
            closed: pos.closed,
            lastClaimTime: Number(pos.lastClaimTime),
            endTimeAtClose: Number(pos.endTimeAtClose),
            claimableUSD,
            claimableReward,
          });
        }

        return {
          positions,
          totals: {
            totalStakeUSD,
            totalLP,
            totalClaimableUSD,
            totalClaimableReward,
          },
        };
      } catch (err) {
        console.error("getUserPositions error:", err);
        return {
          positions: [],
          totals: {
            totalStakeUSD: 0,
            totalLP: 0,
            totalClaimableUSD: 0,
            totalClaimableReward: 0,
          },
        };
      }
    },
    [address, getPlans]
  );

  // Referral earnings
  const getReferralEarnings = useCallback(
    async (userAddress) => {
      const user = userAddress || address;
      if (!user) return 0;
      try {
        const staking = getReadStaking();
        // public mapping referralEarnings(address) → uint256
        const earnings = await staking.referralEarnings(user);
        return Number(formatUnits(earnings, 18));
      } catch (err) {
        console.error("getReferralEarnings error:", err);
        return 0;
      }
    },
    [address]
  );

  // Total positions (global)
  const getPositionCounter = useCallback(async () => {
    try {
      const staking = getReadStaking();
      const counter = await staking.positionCounter();
      return Number(counter);
    } catch (err) {
      console.error("getPositionCounter error:", err);
      return 0;
    }
  }, []);

  // user LP balance for a pool (pid)
  const getUserLPBalance = useCallback(
    async (pid, userAddress) => {
      const user = userAddress || address;
      if (!user) return 0;
      try {
        const lpAddress = LP_BY_PID[pid];
        if (!lpAddress) return 0;

        const lp = new Contract(lpAddress, ERC20_ABI, readProvider);
        const bal = await lp.balanceOf(user);
        return Number(formatUnits(bal, 18));
      } catch (err) {
        console.error("getUserLPBalance error:", err);
        return 0;
      }
    },
    [address, readProvider]
  );

  // ======================= STAKING WRITE =======================

  // Stake LP (amount in human units)
  const stakeLP = useCallback(
    async (pid, amountLP, planId, referrer) => {
      if (!isConnected) throw new Error("Wallet not connected");
      const lpAddress = LP_BY_PID[pid];
      if (!lpAddress) throw new Error("Unknown LP for pid");

      const { signer } = await getSignerAndRouter();
      const staking = await getWriteStaking();
      const lpToken = new Contract(lpAddress, ERC20_ABI, signer);

      const parsedAmount = parseUnits(amountLP.toString(), 18);
      // approve
      const approveTx = await lpToken.approve(
        STAKING_CONTRACT_ADDRESS,
        parsedAmount
      );
      await approveTx.wait();

      const ref =
        referrer &&
        /^0x[a-fA-F0-9]{40}$/.test(referrer) &&
        referrer !== "0x0000000000000000000000000000000000000000"
          ? referrer
          : "0x0000000000000000000000000000000000000000";

      const stakeTx = await staking.stake(pid, parsedAmount, planId, ref);
      await stakeTx.wait();

      return stakeTx.hash;
    },
    [isConnected, getSignerAndRouter]
  );

  const claimPosition = useCallback(
    async (positionId) => {
      if (!isConnected) throw new Error("Wallet not connected");
      const staking = await getWriteStaking();
      const tx = await staking.claim(positionId);
      await tx.wait();
      return tx.hash;
    },
    [isConnected]
  );

  const unstakePosition = useCallback(
    async (positionId) => {
      if (!isConnected) throw new Error("Wallet not connected");
      const staking = await getWriteStaking();
      const tx = await staking.unstake(positionId);
      await tx.wait();
      return tx.hash;
    },
    [isConnected]
  );

  // ======================= SWAP & LIQUIDITY =======================

  // View quote
  const getAmountsOut = useCallback(
    async (tokenInSymbol, tokenOutSymbol, amountIn) => {
      try {
        if (!tokenAddresses[tokenInSymbol] || !tokenAddresses[tokenOutSymbol]) {
          throw new Error("Unsupported token symbol");
        }

        const provider = new JsonRpcProvider(CUSTOM_RPC);
        const router = new Contract(ROUTER_ADDRESS, routerViewABI, provider);

        const path = [
          tokenAddresses[tokenInSymbol],
          tokenAddresses[tokenOutSymbol],
        ];

        const inDecimals = tokenDecimals[tokenInSymbol] || 18;
        const outDecimals = tokenDecimals[tokenOutSymbol] || 18;

        const amountParsed = parseUnits(amountIn.toString(), inDecimals);
        const amounts = await router.getAmountsOut(amountParsed, path);

        return Number(formatUnits(amounts[1], outDecimals));
      } catch (err) {
        console.error("getAmountsOut error:", err);
        return 0;
      }
    },
    []
  );

  // Swap
  const swapTokens = useCallback(
    async (tokenInSymbol, tokenOutSymbol, amountIn) => {
      if (!isConnected) throw new Error("Wallet not connected");
      if (!tokenAddresses[tokenInSymbol] || !tokenAddresses[tokenOutSymbol]) {
        throw new Error("Unsupported token");
      }

      const { signer, routerSwap } = await getSignerAndRouter();

      const path = [
        tokenAddresses[tokenInSymbol],
        tokenAddresses[tokenOutSymbol],
      ];

      const inDecimals = tokenDecimals[tokenInSymbol] || 18;
      const amountParsed = parseUnits(amountIn.toString(), inDecimals);
      const amountOutMin = 0; // TODO: add slippage
      const to = address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

      if (tokenInSymbol === "BNB") {
        // BNB -> token
        // path[0] must be WBNB
        path[0] = WBNB_ADDRESS;

        const tx = await routerSwap.swapExactETHForTokens(
          amountOutMin,
          path,
          to,
          deadline,
          { value: amountParsed }
        );
        await tx.wait();
        return tx.hash;
      }

      // token → token
      const tokenIn = new Contract(
        tokenAddresses[tokenInSymbol],
        ERC20_ABI,
        signer
      );

      const approveTx = await tokenIn.approve(ROUTER_ADDRESS, amountParsed);
      await approveTx.wait();

      const tx = await routerSwap.swapExactTokensForTokens(
        amountParsed,
        amountOutMin,
        path,
        to,
        deadline
      );
      await tx.wait();
      return tx.hash;
    },
    [isConnected, address, getSignerAndRouter]
  );

const addLiquidity = useCallback(
  async (tokenSymbol, tokenAmount) => {
    if (!tokenAmount || isNaN(tokenAmount)) throw new Error("Invalid token amount");
    if (!["KIND", "HUG"].includes(tokenSymbol))
      throw new Error("Only KIND and HUG liquidity supported");

    if (!isConnected) throw new Error("Wallet not connected");

    const { signer, routerLiquidity } = await getSignerAndRouter();
    const tokenAddr = tokenAddresses[tokenSymbol];
    const decimals = tokenDecimals[tokenSymbol] || 18;

    // Helper: convert human number to smallest units string
    const parseUnitsPlain = (amount, dec) => {
      const [whole, fraction = ""] = amount.toString().split(".");
      const paddedFraction = (fraction + "0".repeat(dec)).slice(0, dec);
      return whole + paddedFraction;
    };

    const amountTokenDesiredUnits = parseUnitsPlain(tokenAmount, decimals);

    // Get LP reserves
    const pairAbi = [
      "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
      "function token0() view returns (address)",
      "function token1() view returns (address)"
    ];

    const provider = signer.provider || new JsonRpcProvider(CUSTOM_RPC);
    const lpAddress = tokenSymbol === "KIND" ? KIND_WBNB_LP : HUG_WBNB_LP;
    const pairContract = new Contract(lpAddress, pairAbi, provider);

    const [reserve0Raw, reserve1Raw] = await pairContract.getReserves();
    const t0 = await pairContract.token0();
    const t1 = await pairContract.token1();

    const reserve0 = Number(formatUnits(reserve0Raw, decimals));
    const reserve1 = Number(formatUnits(reserve1Raw, 18));

    let tokenReserve, bnbReserve;
    if (t0.toLowerCase() === tokenAddr.toLowerCase()) {
      tokenReserve = reserve0;
      bnbReserve = reserve1;
    } else {
      tokenReserve = reserve1;
      bnbReserve = reserve0;
    }

    // Exact ETH based on pool ratio
    const amountETHOptimal = (tokenAmount * bnbReserve) / tokenReserve;

    // Convert to smallest units
    const amountETHOptimalUnits = parseUnitsPlain(amountETHOptimal, 18);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    // Approve token
    const token = new Contract(tokenAddr, ERC20_ABI, signer);
    const approveTx = await token.approve(ROUTER_ADDRESS, amountTokenDesiredUnits);
    await approveTx.wait();

    // Add liquidity (exact amounts, no slippage)
    const tx = await routerLiquidity.addLiquidityETH(
      tokenAddr,
      amountTokenDesiredUnits,
      amountTokenDesiredUnits,  // EXACT amountToken
      amountETHOptimalUnits,    // EXACT amountETH
      address,
      deadline,
      { value: amountETHOptimalUnits }
    );

    await tx.wait();
    return tx.hash;
  },
  [isConnected, address, getSignerAndRouter]
);




  // ======================= MASTER REFRESH (ALL DATA) =======================

  const refreshAll = async (pid, user = address) => {
    try {
      const [plans, poolStats, userPositions, referralEarnings, lpBalance, positionCounter] =
        await Promise.all([
          getPlans(),
          getPoolStats(pid),
          getUserPositions(user),
          getReferralEarnings(user),
          getUserLPBalance(pid, user),
          getPositionCounter(),
        ]);

      return {
        plans,
        poolStats,
        userPositions,
        referralEarnings,
        lpBalance,
        positionCounter,
      };
    } catch (err) {
      console.error("refreshAll error:", err);
      return null;
    }
  };

  return {
    // staking read
    getPlans,
    getPoolStats,
    getUserPositions,
    getReferralEarnings,
    getPositionCounter,
    getUserLPBalance,

    // staking write
    stakeLP,
    claimPosition,
    unstakePosition,

    // swap + liquidity
    getAmountsOut,
    swapTokens,
    addLiquidity,

    // master fetch
    refreshAll,
  };
}

export default useContract;
