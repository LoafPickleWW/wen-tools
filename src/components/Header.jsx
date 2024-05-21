import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { Link } from "react-router-dom";
import ConnectButton from "./ConnectButton";

export function Header() {
  return (
    <AppBar sx={{ backgroundColor: "#030003" }} position="sticky">
      <Toolbar>
        <Link to="/">
          <img
            src="/TL_large_white.png"
            alt="logo"
            className="mr-2 h-12 p-1 "
          />
        </Link>
        <div className="ml-2">
          <a
            href="https://thurstober.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center"
          >
            <img
              className="h-[70px] hover:scale-95 duration-700"
              src="./cherry.png"
              alt="logo"
            />
          </a>
        </div>
        <Typography
          component="div"
          sx={{
            fontFamily: "Josefin Slab",
            flexGrow: 1,
            fontWeight: 400,
            fontSize: {
              xs: "1rem",
              sm: "1.25rem",
              md: "1.5rem",
              lg: "1.75rem",
            },
            ":hover": {
              cursor: "pointer",
            },
            ml: { xs: 2, sm: 0 },
            visibility: { xs: "hidden", sm: "visible" },
          }}
        ></Typography>
        <ConnectButton />
      </Toolbar>
      <div className="bg-secondary-green text-black flex py-1 justify-center items-center">
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
      <div className="bg-banner-grey text-white flex py-1 justify-center items-center">
        <p className="text-center text-sm ticker-text">
          Improve your wallet experience with the:{" "}
          <a
            href="https://we.thurstober.com/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:text-green-800 transition"
          >
            Wallet Enhancer!
          </a>
        </p>
      </div>
    </AppBar>
  );
}
