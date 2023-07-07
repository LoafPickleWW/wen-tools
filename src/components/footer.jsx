import { FaDiscord, FaTwitter } from "react-icons/fa";

export const Footer = () => {
  return (
    <footer className="py-3 px-4 sm:px-6 bg-gray-800 text-secondary-green w-full bottom-0 fixed">
      <div className="mx-auto">
        <div className="flex justify-between items-center">
          <a href="https://thurstober.com" className="flex items-center">
            <img
              className="h-8 hover:scale-95 duration-700"
              src="./thurs_logo_white3xz.png"
              alt="logo"
            />
          </a>
          <div className="flex items-center gap-x-2">
            <a
              href="https://discord.gg/dNQZbW3bXm"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaDiscord className="w-6 h-6 text-secondary-green/80 hover:text-secondary-green transition" />
            </a>
            <a
              href="https://twitter.com/thurstobertay"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaTwitter className="w-6 h-6 text-secondary-green/80 hover:text-secondary-green transition" />
            </a>
          </div>
            <a
              className="font-semibold text-secondary-green/80 transition text-xs text-center hover:text-secondary-green"
              href="https://twitter.com/cryptolews"
              target="_blank"
              rel="noopener noreferrer"
            >
              developed 
              <br/>by bykewel
            </a>
        </div>
      </div>
    </footer>
  );
};
