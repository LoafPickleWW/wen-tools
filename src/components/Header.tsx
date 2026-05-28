import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

import { Link } from "react-router-dom";
import ConnectButton from "./ConnectButton";
import SelectNetworkComponent from "./SelectNetworkComponent";
import DonationDialog from "./DonationDialog";

export function Header() {
  return (
    <AppBar sx={{ backgroundColor: "#1A171A" }} position="sticky">
      <Toolbar  className="flex flex-row items-center justify-between w-[100%] lg:w-[90%] mx-auto py-2 px-4 gap-0 lg:gap-6">
        <Link to="/" aria-label="wen.tools Home">
          <img src="/w-t-logo.png" alt="wen.tools - Algorand Developer Utility Suite" className=" mr-2 p-1 w-20 lg:w-36" />
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
            display: { xs: "none", sm: "block" },
          }}
        ></Typography>
      <ConnectButton />
      <SelectNetworkComponent />
      <div className="hidden lg:flex">
        <DonationDialog />
      </div>
      </Toolbar>
    </AppBar>
  );
}
