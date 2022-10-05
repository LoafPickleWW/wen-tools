export const Footer = () => {
  return (
    <footer className="py-4 px-4 sm:px-6 bg-gray-800 text-white w-full bottom-0 fixed">
      <div className="mx-auto">
        <div className="flex justify-between items-center">
          <span>
            powered by&nbsp;
            <a
              className="font-semibold transition text-sm hover:text-pink-600"
              href="https://twitter.com/Thurstobertay"
              target="_blank"
              rel="noopener noreferrer"
            >
              Stupid Horses
            </a>
          </span>
          <span className="text-xs">
            developed by{" "}
            <a
              className="font-semibold transition text-xs hover:text-pink-600"
              href="https://twitter.com/cryptolews"
              target="_blank"
              rel="noopener noreferrer"
            >
              bykewel
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
};
