import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";

import { Link } from "react-router-dom";
import ConnectButton from "./ConnectButton";
import SelectNetworkComponent from "./SelectNetworkComponent";
import { MdMenu } from "react-icons/md";
import { useState } from "react";
import DropdownMenu from "./DropdownMenu";
import DonationDialog from "./DonationDialog";
import IconButton from "@mui/material/IconButton";

export function Header() {
  const [isSidesheetOpen, setIsSidesheetOpen] = useState(false);

  const handleDrawerToggle = () => {
    setIsSidesheetOpen(!isSidesheetOpen);
  };

  return (
    <AppBar sx={{ backgroundColor: "#1A171A" }} position="sticky">
      <DropdownMenu isOpen={isSidesheetOpen} onClose={handleDrawerToggle} />

      <Toolbar  className="flex flex-row items-center justify-between w-[100%] lg:w-[90%] mx-auto py-2 px-4 gap-0 lg:gap-6">
        <div className="lg:hidden">
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
          >
            <MdMenu />
          </IconButton>
        </div>
        <Link to="/" 
        >
          <img src="/w-t-logo.png" alt="logo" className=" mr-2 p-1 w-20 lg:w-36" />
        </Link>
        <Typography
          component="div"
          sx={{
            fontFamily: "Josefin Slab",
            flexGrow: 1,
            fontWeight: 400,
            fontSize: {
              xs: ".5rem",
              sm: "1rem",
              lg: "1rem",
            },
            ":hover": {
              cursor: "pointer",
            },
            ml: { xs: 2, sm: 0 },
            visibility: { xs: "hidden", sm: "visible" },
          }}
        ></Typography>
        <List 
          className="hidden lg:flex flex-row items-center px-4 py-2 gap-2 text-xl "
        >
        <ListItemButton
          component="a"
          href="https://wallet.wen.tools"
          target="_blank"
        >
          <p>Wen Wallet</p>
        </ListItemButton>
        <ListItemButton
          component="a"
          href="https://swap.wen.tools"
          target="_blank"
          className="text-xl flex flex-row items-center gap-1"
        >
          <p>Wen Swap</p>
        </ListItemButton>
      </List>
      <ConnectButton />
      <SelectNetworkComponent />
      <div className="hidden lg:flex">
        <DonationDialog />
      </div>
      </Toolbar>
      {/* <div className="bg-secondary-orange text-black flex py-1 justify-center items-center">
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
      <div className="bg-banner-grey text-white overflow-hidden text-center">
        <p className="text-center text-sm ticker-text">
          Improve your wallet experience with the:{" "}
          <a
            href="https://wallet.wen.tools/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:text-green-800 transition"
          >
            Wen Wallet!
          </a>
        </p>
      </div> */}
    </AppBar>
  );
}
