import { FaDiscord, FaTwitter } from "react-icons/fa";

export const Footer = () => {
  return (
    <footer className="py-3 px-4 sm:px-6 bg-gray-800 text-red-200 w-full bottom-0 fixed">
      <div className="mx-auto">
        <div className="flex justify-between items-center">
          <a href="https://thurstober.com" className="flex items-center">
            <img
              className="h-8 hover:scale-95 duration-700"
              src="./logo.png"
              alt="logo"
            />
          </a>
          <div className="flex items-center gap-x-2">
            <a
              href="https://discord.gg/dNQZbW3bXm"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaDiscord className="w-6 h-6 text-red-1000 hover:text-red-500 transition" />
            </a>
            <a
              href="https://twitter.com/thurstobertay"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaTwitter className="w-6 h-6 text-red-1000 hover:text-red-500 transition" />
            </a>
          </div>
            <a
              className="font-semibold transition text-xs hover:text-pink-600"
              href="https://twitter.com/cryptolews"
              target="_blank"
              rel="noopener noreferrer"
            >
              developer
            </a>
        </div>
      </div>
    </footer>
  );
};
