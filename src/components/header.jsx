import ConnectButton from "./ConnectButton";

export const Header = () => {
  return (
    <header className="flex flex-row items-center justify-between border-gray-200 px-4 md:px-8 py-2 mb-1 bg-gray-800">
      <a href="/">
        <img
          src="./eviltools.png"
          className="h-12 hover:scale-95 duration-700"
          alt="eviltools"
        />
      </a>
      <ConnectButton />
    </header>
  );
};
