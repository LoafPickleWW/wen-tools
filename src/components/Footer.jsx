import { Tooltip, Typography } from "@mui/material";

export function Footer() {
  return (
    <footer className="bg-primary-black text-nude w-screen bottom-0 fixed">
      <div className="px-4 flex w-full flex-col items-center justify-center border-t border-blue-gray-50 py-4 gap-y-1 md:flex-row md:justify-between">
        <Typography
          variant="caption"
          sx={{ fontFamily: "Josefin Slab", fontWeight: 400 }}
          className="mb-2 md:mb-0 text-center text-blue-gray-900 text-white"
        >
          &copy; {new Date().getFullYear()}{" "}
          <a
            href="https://wen.tools/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Wen.Tools
          </a>
        </Typography>
        <div className="flex flex-row items-center justify-center gap-3 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          <Tooltip title="supported by xGov">
            <a
              href="https://xgov.algorand.foundation?ref=eviltools"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src={"/af_logo.svg"}
                alt="af-logo"
                width={64}
                height={64}
                className="mb-2 md:mb-0"
              />
            </a>
          </Tooltip>
          <a
            href="https://algonode.io?ref=eviltools"
            target="_blank"
            rel="noreferrer noopener"
            className="font-normal text-primary-gray transition text-xs text-center hover:text-white"
          >
            powered by <br /> Algonode.io
          </a>
        </div>
        <div className="flex gap-4 text-blue-gray-900 sm:justify-center">
          <a
            href="https://twitter.com/loafpickle"
            target="_blank"
            className="opacity-80 transition-opacity hover:opacity-100"
            rel="noreferrer"
          >
            <svg
              className="h-5 w-5"
              fill="white"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
            </svg>
          </a>
          <a
            href="https://discord.gg/Mw2p5C6hAT"
            target="_blank"
            className="opacity-80 transition-opacity hover:opacity-100"
            rel="noreferrer"
          >
            <svg
              className="h-5 w-5"
              fill="white"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.052.052 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z" />
            </svg>
          </a>
          <a
            className="opacity-80 transition-opacity hover:opacity-100"
            href="https://github.com/LoafPickleWW/wen-tools"
            target="_blank"
            rel="noreferrer"
          >
            <svg
              className="h-5 w-5"
              fill="white"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
