import { Tooltip } from "@mui/material";
import { trackEvent } from "../utils";

export function Footer() {
  return (
    <footer className="bg-primary-black text-white">
      <div className="px-4 flex w-full flex-col items-center justify-center  py-2 gap-y-2 md:flex-row md:justify-between">
        <span className=" mb-2 font-sans font-normal text-center text-md">
          {new Date().getFullYear()}{" "} &copy;
          <a
            href="https://wen.tools/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-normal text-white transition hover:text-primary-gray pl-1 text-md"
            onClick={() => trackEvent("footer_click", "nav", "Wen Tools Home")}
          >
            Wen.Tools
          </a>
        </span>
        <div className="flex flex-row items-center justify-center gap-3 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          <Tooltip title="supported by xGov">
            <a
              href="https://xgov.algorand.foundation?ref=eviltools"
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* <img
                src={"/af_logo.svg"}
                alt="af-logo"
                width={64}
                height={64}
                className="mb-2 md:mb-0"
              /> */}
            </a>
          </Tooltip>
          <a
            href="https://algonode.io?ref=eviltools"
            target="_blank"
            rel="noreferrer noopener"
            className="font-normal text-md text-center font-sans hover:text-primary-gray transition text-white mb-3 md:mb-0"
            onClick={() => trackEvent("footer_click", "nav", "Algonode")}
          >
            powered by Algonode.io
          </a>
          <a
            href="/encyclopedia"
            className="font-normal text-md text-center font-sans hover:text-primary-gray transition text-white mb-3 md:mb-0 ml-4 hidden md:block"
            onClick={() => trackEvent("footer_click", "nav", "Encyclopedia")}
          >
            Encyclopedia
          </a>
        </div>
        <div className="flex gap-4 text-white sm:justify-center flex-row items-center">
          <a
            href="https://twitter.com/wendottools"
            target="_blank"
            className="opacity-100 transition-opacity hover:opacity-80"
            rel="noreferrer"
            onClick={() => trackEvent("footer_click", "social", "Twitter")}
            aria-label="Follow wen.tools on X (Twitter)"
          >
            <img src="/x-icon.png" alt="X (formerly Twitter) Icon" className=" w-7 h-7" />
          </a>
          <a
            href="https://discord.gg/Mw2p5C6hAT"
            target="_blank"
            className="opacity-100 transition-opacity hover:opacity-80"
            rel="noreferrer"
            onClick={() => trackEvent("footer_click", "social", "Discord")}
            aria-label="Join the wen.tools Discord community"
          >
            <img src="/discord-icon.webp" alt="Discord Icon" className=" w-8 h-8" />
          </a>
          <a
            className="opacity-100 transition-opacity hover:opacity-80"
            href="https://github.com/LoafPickleWW/wen-tools"
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("footer_click", "social", "GitHub")}
            aria-label="View wen.tools source code on GitHub"
          >
            <img src="/github-icon.png" alt="GitHub Icon" className=" w-9 h-9" />
          </a>
        </div>
      </div>
    </footer>
  );
}
