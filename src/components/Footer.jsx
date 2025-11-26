"use client";
import * as React from "react";
import { FaTelegramPlane, FaGlobe, FaTwitter, FaFacebookF , FaGithub } from "react-icons/fa";

function Footer() {
  return (
    <footer className="flex flex-col items-center w-full py-6">
      {/* Logo / Header */}
      <div className="flex items-center gap-2 mb-4">
        {/* Logo Image */}
        <img
          src="/kindlogo.png" // Replace with your logo path
          alt="Kind Cat Logo"
          className="w-10 h-10 object-contain"
        />
        {/* Text */}
        <div className="text-2xl font-bold text-[#d4af37]">Kind</div>
        <div className="text-2xl font-bold text-[#d4af37]">Cat Token</div>
      </div>

      {/* Social Icons */}
      <div className="flex gap-4 mb-4">
        <a
          href="https://t.me/KindCatToken"
          target="_blank"
          rel="noopener noreferrer"
          className="w-10 h-10 flex justify-center items-center rounded border border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37] hover:text-black transition-colors"
        >
          <FaTelegramPlane size={20} />
        </a>

        <a
          href="https://kindcattoken.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="w-10 h-10 flex justify-center items-center rounded border border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37] hover:text-black transition-colors"
        >
          <FaGlobe size={20} />
        </a>

        <a
          href="https://x.com/KindCatToken"
          target="_blank"
          rel="noopener noreferrer"
          className="w-10 h-10 flex justify-center items-center rounded border border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37] hover:text-black transition-colors"
        >
          <FaTwitter size={20} />
        </a>

        <a
          href="https://www.facebook.com/share/17huuHJAwJ/"
          target="_blank"
          rel="noopener noreferrer"
          className="w-10 h-10 flex justify-center items-center rounded border border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37] hover:text-black transition-colors"
        >
          <FaFacebookF size={20} />
        </a>

          {/* GitHub Icon */}
  <a
    href="https://github.com/" // Replace with your GitHub URL
    target="_blank"
    rel="noopener noreferrer"
    className="w-10 h-10 flex justify-center items-center rounded border border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37] hover:text-black transition-colors"
  >
    <FaGithub size={20} />
  </a>
      </div>

      {/* All Rights Reserved */}
      <p className="text-sm text-[#d4af37]">
        © 2025 Kind Cat Token. All rights reserved.
      </p>
    </footer>
  );
}

export default Footer;
