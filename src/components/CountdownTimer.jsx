import React, { useState, useEffect } from "react";

/**
 * CountdownTimer component
 *
 * Props:
 *  - nextClaimTimestamp: Unix timestamp (seconds) for countdown target
 *  - startTimestamp: Unix timestamp (seconds) for count-up mode
 *
 * Responsive: automatically adjusts size for mobile (compact inline layout)
 */
const CountdownTimer = ({ nextClaimTimestamp, startTimestamp }) => {
  const [timeData, setTimeData] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    if (!nextClaimTimestamp && !startTimestamp) return;

    const updateTimer = () => {
      const now = Date.now();
      let diff = 0;

      if (startTimestamp) {
        // Count UP mode
        diff = now - startTimestamp * 1000;
      } else if (nextClaimTimestamp) {
        // Count DOWN mode
        diff = nextClaimTimestamp * 1000 - now;
      }

      if (diff <= 0) {
        setTimeData({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      setTimeData({ days, hours, minutes, seconds });
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);
    return () => clearInterval(intervalId);
  }, [nextClaimTimestamp, startTimestamp]);

  const { days, hours, minutes, seconds } = timeData;

  if (
    !startTimestamp &&
    days === 0 &&
    hours === 0 &&
    minutes === 0 &&
    seconds === 0
  )
    return null;

  // ✅ TimeBox: smaller on mobile, larger on desktop
  const TimeBox = ({ value, label }) => (
    <div
      className="flex items-center justify-center 
                 bg-gradient-to-br from-[#1f1f1f] to-[#2b2b2b]
                 border border-[#3f3f3f] text-[#d4af37]
                 rounded-md shadow-inner font-mono font-semibold
                 px-1.5 py-0.5 sm:px-3 sm:py-1
                 min-w-[1.9rem] sm:min-w-[3.2rem]
                 text-[10px] sm:text-sm whitespace-nowrap"
    >
      {value.toString().padStart(2, "0")}
      <span className="ml-0.5 text-[9px] sm:text-xs font-bold opacity-80">
        {label}
      </span>
    </div>
  );

  return (
    <div
      className="flex items-center justify-center gap-0.5 sm:gap-2 
                 flex-nowrap whitespace-nowrap text-[10px] sm:text-sm"
    >
      {days > 0 && <TimeBox value={days} label="D" />}
      <TimeBox value={hours} label="H" />
      <TimeBox value={minutes} label="M" />
      <TimeBox value={seconds} label="S" />
    </div>
  );
};

export default CountdownTimer;
