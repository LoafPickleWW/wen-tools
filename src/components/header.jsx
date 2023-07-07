import ConnectButton from "./ConnectButton";

export const Header = () => {
  return (
    <>
      <header className="flex flex-row items-center justify-between border-gray-200 px-4 md:px-8 py-3 bg-gray-800">
          <a href="/">
            <img
              src="./eviltools.png"
              className="h-12 hover:scale-95 duration-700"
              alt="eviltools"
            />
          </a>
       <div className="mx-auto">
           <div className="flex items-center gap-x-2">
            <a href="https://thurstober.com" className="flex items-center">
              <img
                className="h-16 hover:scale-95 duration-700"
                src="./cherry.png"
                alt="logo"
              />
            </a>
           </div> 
       </div>
        <ConnectButton />
      </header>
      <div className="bg-primary-green text-black flex py-1 justify-center items-center mb-2">
        <p className="text-center text-sm">
          You can read more about Infinity Mode{" "}
          <a
            href="https://loafpickle.medium.com/evil-tools-infinity-mode-1bd70ec71c2b"
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:text-green-800 transition"
          >
            🔗 here!
          </a>
        </p>
      </div>
    </>
  );
};
