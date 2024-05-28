// ** React Imports
import { useEffect, useState } from "react";

// ** MUI Imports
import { Icon, IconButton } from "@mui/material";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Tooltip from "@mui/material/Tooltip";

import { FaCopy, FaWallet } from "react-icons/fa";
import { toast } from "react-toastify";

// ** Wallet Imports
import { DeflyWalletConnect } from "@blockshake/defly-connect";
import { DaffiWalletConnect } from "@daffiwallet/connect";
import { PeraWalletConnect } from "@perawallet/connect";

export default function ConnectButton() {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  // wallet
  const peraWallet = new PeraWalletConnect();
  const deflyWallet = new DeflyWalletConnect();
  const daffiWallet = new DaffiWalletConnect();
  const [walletAddress, setWalletAddress] = useState("");

  // handlers
  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const shortenAddress = (address) => {
    return (
      address.substring(0, 4) + "..." + address.substring(address.length - 4)
    );
  };

  const connectToPera = async () => {
    handleClose();
    try {
      const accounts = await peraWallet.connect();
      localStorage.setItem("wallet", accounts[0]);
      setWalletAddress(accounts[0]);
      toast.success("Connected!");
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const connectToDefly = async () => {
    handleClose();
    try {
      const accounts = await deflyWallet.connect();
      localStorage.setItem("wallet", accounts[0]);
      setWalletAddress(accounts[0]);
      toast.success("Connected!");
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const connectToDaffi = async () => {
    handleClose();
    try {
      const accounts = await daffiWallet.connect();
      localStorage.setItem("wallet", accounts[0]);
      setWalletAddress(accounts[0]);
      toast.success("Connected!");
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const disconnect = async () => {
    try {
      peraWallet.disconnect();
    } catch (error) {}
    try {
      deflyWallet.disconnect();
    } catch (error) {}
    const networkType = localStorage.getItem("networkType");
    localStorage.clear();
    localStorage.setItem("networkType", networkType);
    toast.success("Disconnected!");
    setWalletAddress("");
    window.location.reload();
  };

  useEffect(() => {
    const userAddressLocal = localStorage.getItem("wallet");
    if (userAddressLocal) {
      setWalletAddress(userAddressLocal);
    }
  }, []);

  return (
    <div className="flex flex-row justify-center items-center">
      {!walletAddress ? (
        <Button
          id="connect-button"
          aria-controls={open ? "connect-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={open ? "true" : undefined}
          onClick={handleClick}
          color="success"
          className="hover:bg-primary-green hover:text-white transition"
        >
          <span className="font-sans">Connect</span>
        </Button>
      ) : (
        <Tooltip title="Account" placement="bottom-start">
          <IconButton
            id="connect-button"
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            sx={{ fontFamily: "sans", fontWeight: "bold", color: "white" }}
          >
            <FaWallet height={50} width={50} />
          </IconButton>
        </Tooltip>
      )}
      <Menu
        id="connect-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "connect-button",
        }}
        sx={{ mt: "1px", "& .MuiMenu-paper": { backgroundColor: "#010002" } }}
      >
        {!walletAddress ? (
          <MenuList sx={{ p: "0px" }}>
            <MenuItem
              sx={{
                backgroundColor: "#ffee55",
                color: "black",
                fontWeight: "bold",
                borderTopLeftRadius: "4px",
                borderTopRightRadius: "4px",
                ":hover": { backgroundColor: "#ffee55", opacity: "0.8" },
              }}
              onClick={connectToPera}
            >
              Pera
            </MenuItem>
            <MenuItem
              sx={{
                backgroundColor: "#131313",
                color: "white",
                fontWeight: "bold",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
                ":hover": { backgroundColor: "#131313", opacity: "0.8" },
              }}
              onClick={connectToDefly}
            >
              Defly
            </MenuItem>
            <MenuItem
              sx={{
                backgroundColor: "#00BAA4",
                color: "black",
                fontWeight: "bold",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
                ":hover": { backgroundColor: "#00BAA4", opacity: "0.8" },
              }}
              onClick={connectToDaffi}
            >
              Daffi
            </MenuItem>
          </MenuList>
        ) : (
          <MenuList sx={{ p: "0px" }}>
            <MenuItem
              sx={{
                color: "white",
                fontWeight: "bold",
              }}
              onClick={() => {
                navigator.clipboard.writeText(walletAddress);
                toast.success("Copied!");
              }}
            >
              <div className="flex flex-row items-center">
                <span>{shortenAddress(walletAddress)}</span>
                <Icon className="ml-2" style={{ fontSize: "1rem" }}>
                  <FaCopy />
                </Icon>
              </div>
            </MenuItem>
            <MenuItem
              sx={{
                textAlign: "start",
                color: "white",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
              }}
              onClick={handleClose}
            >
            </MenuItem>
            <MenuItem
              sx={{
                backgroundColor: "red",
                color: "white",
                ":hover": { backgroundColor: "red", opacity: "0.8" },
                fontWeight: "bold",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
              }}
              onClick={disconnect}
            >
              Disconnect
            </MenuItem>
          </MenuList>
        )}
      </Menu>
    </div>
  );
}
