import { Tooltip } from "@mui/material";
import { trackEvent } from "../utils";

export function Footer() {
  return (
    <footer className="bg-primary-black text-white py-6 md:py-4">
      <div className="px-4 flex flex-col items-center gap-y-6 md:flex-row md:justify-between w-full max-w-7xl mx-auto">
        <div className="font-sans font-normal text-center text-sm md:flex-1 md:text-left">
          {new Date().getFullYear()}{" "} &copy;
          <a
            href="https://loafpickle.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-normal text-white transition hover:text-primary-gray pl-1"
            onClick={() => trackEvent("footer_click", "nav", "LoafPickle Worldwide")}
          >
            LoafPickle Worldwide LLC
          </a>
        </div>
        
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 md:flex-1">
          <Tooltip title="supported by xGov">
            <a
              href="https://xgov.algorand.foundation?ref=eviltools"
              target="_blank"
              rel="noopener noreferrer"
            ></a>
          </Tooltip>
          <a
            href="https://algonode.io?ref=eviltools"
            target="_blank"
            rel="noreferrer noopener"
            className="font-normal text-sm text-center font-sans hover:text-primary-gray transition text-neutral-400"
            onClick={() => trackEvent("footer_click", "nav", "Algonode")}
          >
            powered by Algonode.io
          </a>
          <a
            href="/encyclopedia"
            className="font-normal text-sm text-center font-sans hover:text-primary-gray transition text-neutral-400"
            onClick={() => trackEvent("footer_click", "nav", "Encyclopedia")}
          >
            Encyclopedia
          </a>
          <a href="/terms" className="font-normal text-sm text-center font-sans hover:text-primary-gray transition text-neutral-400">Terms</a>
          <a href="/privacy" className="font-normal text-sm text-center font-sans hover:text-primary-gray transition text-neutral-400">Privacy</a>
        </div>

        <div className="flex gap-4 text-white justify-center flex-row items-center md:flex-1 md:justify-end">
          <a
            href="https://twitter.com/wendottools"
            target="_blank"
            className="opacity-100 transition-opacity hover:opacity-80"
            rel="noreferrer"
            onClick={() => trackEvent("footer_click", "social", "Twitter")}
            aria-label="Follow wen.tools on X (Twitter)"
          >
            <img src="/x-icon.png" alt="X (formerly Twitter) Icon" className=" w-5 h-5" />
          </a>
          <a
            href="https://discord.gg/Mw2p5C6hAT"
            target="_blank"
            className="opacity-100 transition-opacity hover:opacity-80"
            rel="noreferrer"
            onClick={() => trackEvent("footer_click", "social", "Discord")}
            aria-label="Join the wen.tools Discord community"
          >
            <img src="/discord-icon.webp" alt="Discord Icon" className=" w-6 h-6" />
          </a>
          <a
            className="opacity-100 transition-opacity hover:opacity-80"
            href="https://github.com/LoafPickleWW/wen-tools"
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("footer_click", "social", "GitHub")}
            aria-label="View wen.tools source code on GitHub"
          >
            <img src="/github-icon.png" alt="GitHub Icon" className=" w-7 h-7" />
          </a>
        </div>
      </div>
    </footer>
  );
}
