import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { Link } from "react-router-dom";
import ConnectButton from "./ConnectButton";
import SelectNetworkComponent from "./SelectNetworkComponent";
import { useState } from 'react';
import * as React from 'react';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';


export function Header() {
  const [anchorElUser, setAnchorElUser] = useState(null);

  const handleOpenSettingsMenu = (event) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseSettingsMenu = () => {
    setAnchorElUser(null);
  };
  return (
    <AppBar sx={{ backgroundColor: "#1A171A" }} position="sticky" id="site-header">
      <Toolbar>
        <Link to="/">
          <img src="/TL_large_white.png" alt="logo" className="mr-2 h-12 p-1" />
        </Link>

        <Box sx={{ flexGrow: 0 }}>
          <Tooltip title="Other Tools">
            <Button variant="outlined" fontSize="inherit" sx={{ borderColor: '#f57b14', color: '#f57b14' }} onClick={handleOpenSettingsMenu}>Other Tools</Button>
          </Tooltip>
          <Menu
            sx={{ mt: '55px' }}
            id="menu-appbar"
            anchorEl={anchorElUser}
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            open={Boolean(anchorElUser)}
            onClose={handleCloseSettingsMenu}
          >
            <MenuItem component={"a"} href="https://wallet.wen.tools/" >
              <Typography textAlign="center">wen.wallet</Typography>
            </MenuItem>
            <MenuItem component={"a"} href="https://swap.wen.tools/" >
              <Typography textAlign="center">wen.swap</Typography>
            </MenuItem>
          </Menu>
        </Box>
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
        <SelectNetworkComponent />
        <ConnectButton />
      </Toolbar>
      <div className="bg-secondary-orange text-black flex py-1 justify-center items-center">
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
            href="https://wallet.wen.tools/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:text-green-800 transition"
          >
            Wen Wallet!
          </a>
        </p>
      </div>
    </AppBar>
  );
}
