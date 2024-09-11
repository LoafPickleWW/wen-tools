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
import axios from "axios";
import algosdk from "algosdk";
// ** Wallet Imports
import { DeflyWalletConnect } from "@blockshake/defly-connect";
import { DaffiWalletConnect } from "@daffiwallet/connect";
import { PeraWalletConnect } from "@perawallet/connect";
import LuteConnect from "lute-connect";
import { getNodeURL } from "../utils";
import { signLoginAlgorandForCrustIpfsEndpoint } from "../crust-auth";

export default function ConnectButton() {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  // wallet
  const peraWallet = new PeraWalletConnect();
  const deflyWallet = new DeflyWalletConnect();
  const daffiWallet = new DaffiWalletConnect();
  const luteWallet = new LuteConnect("The Laboratory");
  const [walletAddress, setWalletAddress] = useState("");
  const [accountData, setAccountData] = useState();

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

      const authBasic = await signLoginAlgorandForCrustIpfsEndpoint(accounts[0]);

      // continue when connect & signLoginAlgorandForCrustIpfsEndpoint sucess

      setWalletAddress(accounts[0]);

      localStorage.setItem("wallet", accounts[0]);
      localStorage.setItem("authBasic", authBasic);

      console.log("------------crust auth success: ", authBasic);

      toast.success("Connected!");
    } catch (err) {
      toast.error("Failed to connect!");
      disconnect(); // clear when crust auth fail
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

  const connectToLute = async () => {
    handleClose();
    try {
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      const genesis = await algodClient.genesis().do();
      const genesisID = `${genesis.network}-${genesis.id}`;
      const accounts = await luteWallet.connect(genesisID);
      localStorage.setItem("wallet", accounts[0]);
      localStorage.setItem("LuteWallet.Wallet", true);
      setWalletAddress(accounts[0]);
      toast.success("Connected!");
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const algoLogo = (
    <svg
      className="fill-text-color me-1 mb-1 ml-1"
      version="1.1"
      id="Layer_1"
      xmlns="http://www.w3.org/2000/svg"
      x="0px"
      y="0px"
      viewBox="0 0 200 200"
      style={{ height: "1.5rem", width: "16px" }}
    >
      <path
        style={{ fill: "white" }}
        d="M170.7,28.8C151.1,9.6,127.5,0,99.9,0C72.1,0,48.4,9.6,28.8,28.8C9.6,48.4,0,72.1,0,99.9 c0,27.6,9.6,51.2,28.8,70.7C48.4,190.2,72.1,200,99.9,200c27.6,0,51.2-9.7,70.7-29.2c19.5-19.6,29.2-43.3,29.2-70.9 C199.9,72.1,190.1,48.4,170.7,28.8 M106.2,41.9H123l7.2,27h17.1l-11.7,20.7l16.6,61.6H135l-11.2-41.4l-23.9,41.4H81l36.9-63.9 l-6.3-22.5l-49.5,86.4H42.8L106.2,41.9z"
      ></path>
      <path
        style={{ fill: "#FFFFF", fillOpacity: "0" }}
        d="M123,41.9h-16.7L42.8,151.3h19.3l49.5-86.4l6.3,22.5L81,151.3h18.9l23.9-41.4l11.3,41.4 c33.7-1.3-5.5-51.1,12.2-82.3h-17.1L123,41.9z"
      ></path>
    </svg>
  );

  const disconnect = async () => {
    try {
      peraWallet.disconnect();
    } catch (error) { }
    try {
      deflyWallet.disconnect();
    } catch (error) { }
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

  async function getAccountData(walletAddress) {
    const response = await axios.get(
      getNodeURL() + `/v2/accounts/${walletAddress}?exclude=all`
    );
    return response.data;
  }

  useEffect(() => {
    if (walletAddress) {
      getAccountData(walletAddress).then((data) => {
        setAccountData(data);
      });
    }
  }, [walletAddress]);

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
          className="hover:bg-primary-orange hover:text-white transition"
        >
          <span className="font-sans text-secondary-orange">Connect</span>
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
                ":hover": { backgroundColor: "#00BAA4", opacity: "0.8" },
              }}
              onClick={connectToDaffi}
            >
              Daffi
            </MenuItem>{" "}
            <MenuItem
              sx={{
                backgroundColor: "#AB47BC",
                color: "black",
                fontWeight: "bold",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
                ":hover": { backgroundColor: "#AB47BC", opacity: "0.8" },
              }}
              onClick={connectToLute}
            >
              Lute
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
              <div className="flex flex-col justify-start">
                <span className="text-sm font-medium">
                  <div className="flex flex-row items-center">
                    Balance: {((accountData?.amount || 0) / 10 ** 6).toFixed(2)}
                    {algoLogo}
                  </div>
                </span>
                <span className="text-sm font-medium">
                  <div className="flex flex-row items-center">
                    Min Balance:{" "}
                    {((accountData?.["min-balance"] || 0) / 10 ** 6).toFixed(2)}
                    {algoLogo}
                  </div>
                </span>
                <span className="text-sm font-medium">
                  Asset Count: {accountData?.["total-assets-opted-in"]}
                </span>
              </div>
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
