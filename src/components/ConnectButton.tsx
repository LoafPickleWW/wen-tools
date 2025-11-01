// ** React Imports
import { useEffect, useState } from "react";

// ** MUI Imports
import { Icon, IconButton } from "@mui/material";
import Button, { ButtonProps } from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Tooltip from "@mui/material/Tooltip";
import { styled } from '@mui/material/styles';
import { useWallet, WalletId } from "@txnlab/use-wallet-react";

// ** Wallet Imports
import { PeraWalletConnect } from "@perawallet/connect";
import { isCrustAuth, isCrustAuthFail, signLoginAlgorandForCrustIpfsEndpoint } from "../crust-auth";

import { FaCopy, FaWallet } from "react-icons/fa";
import { toast } from "react-toastify";

export default function ConnectButton({
  inmain = false
}: {
  /** If this connect button is to be in the main part of the page (not in the header) */
  inmain?: boolean
}) {
  const { activeAddress, activeWallet, algodClient, wallets } = useWallet();
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  // wallet
  const peraWallet = new PeraWalletConnect();
  const [accountData, setAccountData] = useState(null as any);

  // handlers
  const handleClick = (event: any) => {
    if (peraWallet.isPeraDiscoverBrowser) {
      connectToPera();
    } else {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const shortenAddress = (address: string) => {
    return (
      address.substring(0, 4) + "..." + address.substring(address.length - 4)
    );
  };

  const connectToPera = async () => {
    handleClose();

    try {
      await wallets.find((w) => w.id === "pera")?.connect();
      toast.success("Connected!");
    } catch {
      toast.error("Failed to connect!");
    }
  };

  const connectToDefly = async () => {
    handleClose();
    try {
      await wallets.find((w) => w.id === "defly")?.connect();
      toast.success("Connected!");
    } catch {
      toast.error("Failed to connect!");
    }
  };

  const connectToLute = async () => {
    handleClose();
    try {
      await wallets.find((w) => w.id === "lute")?.connect();
      toast.success("Connected!");
    } catch {
      toast.error("Failed to connect!");
    }
  };

  const connectToExodus = async () => {
    handleClose();
    try {
      await wallets.find((w) => w.id === "exodus")?.connect();
      toast.success("Connected!");
    } catch {
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

  const clearLoginState = async () => {
    activeWallet?.disconnect();
    localStorage.removeItem("authBasic");
    localStorage.removeItem("authBasicFail");
  };

  const disconnect = async () => {
    clearLoginState();
    toast.success("Disconnected!");
    window.location.reload();
  };

  useEffect(() => {
    if (activeAddress) {
      algodClient
        .accountInformation(activeAddress)
        .exclude("all")
        .do()
        .then((data: any) => {
          setAccountData(data);
        });
    }
  }, [activeAddress, algodClient]);

  // This is for authenticating with Crust, which is needed for some of the tools (Simple Mint,
  // Simple Update, etc.)
  useEffect(() => {
    // Only Pera supports signing the arbitrary bytes, which is needed for Crust authentication
    if (activeWallet?.id !== WalletId.PERA) return;

    // The connect button in the main body should not activate this useEffect
    if (activeAddress && !inmain) {
      // Already authenticated or the authentication was rejected. Do nothing.
      if (isCrustAuth() || isCrustAuthFail()) return

      signLoginAlgorandForCrustIpfsEndpoint(activeAddress)
        .then(authBasic => {
          localStorage.setItem("authBasic", authBasic ?? '');
          console.log("------------crust auth success: ", authBasic);
          // toast.success("Crust authentication success!")
        })
        .catch((err: any) => {
          localStorage.setItem("authBasicFail", "true")
          console.error('Failed to log into Crust:', err)
          toast.warn("Crust authentication failed. Don't worry, your wallet is still connected to wen.tools.")
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWallet, activeAddress])

  return (
    <div className={
      "flex flex-row justify-center items-center font-sans rounded-2xl mx-2"
      // Add extra vertical spacing when connect button is in the main part of the page
      + ((inmain && !activeAddress) ? " mt-4 mb-2" : "")
    }>
      {!activeAddress ? (
        // Show a different button according to where it is on the page
        inmain
          ? <ButtonMain // Button in main section of the page
            id="connect-button-main"
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            variant="outlined"
            color="inherit"
          >
            <span className="font-sans font-light normal-case sm:leading-relaxed leading-relaxed text-xl">
              Login
            </span>
          </ButtonMain>
          : <Button // Button in header
            id={"connect-button"}
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            color="inherit"
          >
            <span className="font-sans font-light normal-case sm:leading-relaxed leading-tight lg:text-xl">
              Login
            </span>
          </Button>
      ) : (!inmain && /* Render this section if the button is not in the body (in the header) */
        <Tooltip title="Account" placement="bottom-start">
          <IconButton
            id={"connect-button" + (inmain ? "-main" : "")}
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            sx={{ fontFamily: "sans", color: "white", borderRadius: "24px" }}
          >
            <FaWallet className="pr-4 text-4xl" />
          </IconButton>
        </Tooltip>
      )}
      <Menu
        id="connect-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          "aria-labelledby": "connect-button" + (inmain ? "-main" : ""),
        }}
        sx={{
          mt: "1px",
          "& .MuiMenu-paper": { backgroundColor: "#1A1A1A" },
          fontFamily: "poppins, sans-serif",
          borderRadius: "24px",
        }}
        className="p-6 w-[100%] overflow-hidden rounded-xl"
      >
        {!activeAddress ? (
          <MenuList
            sx={{ p: "0px", borderRadius: "24px" }}
            className="flex flex-col gap-3 w-[130px] md:w-[180px] rounded-xl items-center justify-center"
          >
            <MenuItem
              sx={{
                backgroundColor: "transparent",
                color: "white",
                ":hover": { backgroundColor: "#1A1A1A", opacity: "0.8" },
              }}
              onClick={connectToPera}
            >
              <div className="flex flex-col gap-2 items-start rounded-xl">
                <div className="font-sans text-lg font-medium flex flex-row items-center">
                  <img
                    src="/pera-logomark-white.png"
                    alt=""
                    className="w-[24px] h-[24px]"
                  />
                  <span className="ml-2 font-normal">Pera</span>
                </div>
              </div>
            </MenuItem>
            <MenuItem
              sx={{
                backgroundColor: "transparent",
                color: "white",
                ":hover": { backgroundColor: "transparent", opacity: "0.8" },
              }}
              onClick={connectToDefly}
            >
              <div className="flex flex-col gap-2 items-start">
                <div className="font-sans text-lg font-medium flex flex-row items-center">
                  <img
                    src="/defly-logo.png"
                    alt=""
                    className="w-[30px] h-[30px]"
                  />
                  <span className="ml-2 font-normal">Defly</span>
                </div>
              </div>
            </MenuItem>
            <MenuItem
              sx={{
                backgroundColor: "transparent",
                color: "white",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
                ":hover": { backgroundColor: "transparent", opacity: "0.8" },
              }}
              onClick={connectToLute}
            >
              <div className="flex flex-col gap-2 items-start">
                <div className="font-sans text-lg font-medium flex flex-row items-center">
                  <img
                    src="/lute-wallet.svg"
                    alt=""
                    className="w-[26px] h-[26px]"
                  />
                  <span className="ml-2 font-normal">Lute</span>
                </div>
              </div>
            </MenuItem>
            
            <MenuItem
              sx={{
                backgroundColor: "transparent",
                color: "white",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
                ":hover": { backgroundColor: "transparent", opacity: "0.8" },
              }}
              onClick={connectToExodus}
            >
              <div className="flex flex-col gap-2 items-start">
                <div className="font-sans text-lg font-medium flex flex-row items-center">
                  <img
                    src="/exodus-logo.svg"
                    alt=""
                    className="w-[26px] h-[26px]"
                  />
                  <span className="ml-2 font-normal">Exodus</span>
                </div>
              </div>
            </MenuItem>
          </MenuList>
        ) : (
          <MenuList
            sx={{ p: "0px", fontFamily: "poppins, sans-serif" }}
            className="flex flex-col gap-1 w-[260px] rounded-lg"
          >
            {activeWallet?.id && (
              <MenuItem
                sx={{
                  backgroundColor: "transparent",
                  color: "white",
                  borderTopLeftRadius: "4px",
                  borderTopRightRadius: "4px",
                  fontFamily: "poppins, sans-serif",
                  ":hover": { backgroundColor: "#1A1A1A", opacity: "0.8" },
                }}
                onClick={handleClose}
              >
                <div className="flex flex-row items-center gap-2">
                  <div>
                    {activeWallet?.id === "pera" && (
                      <img
                        src="/pera-logomark-white.png"
                        alt=""
                        className="w-[24px] h-[24px]"
                      />
                    )}
                    {activeWallet?.id === "defly" && (
                      <img
                        src="/defly-logo.png"
                        alt=""
                        className="w-[30px] h-[30px]"
                      />
                    )}
                    {activeWallet?.id === "lute" && (
                      <img
                        src="/lute-wallet.svg"
                        alt=""
                        className="w-[26px] h-[26px]"
                      />
                    )}
                  </div>
                  <span>{activeWallet?.id}</span>
                </div>
              </MenuItem>
            )}
            <MenuItem
              sx={{
                color: "white",
                fontWeight: "500",
                fontFamily: "poppins, sans-serif",
              }}
              onClick={() => {
                navigator.clipboard.writeText(activeAddress);
                toast.success("Copied!");
              }}
            >
              <div className="flex flex-row items-center">
                <span>{shortenAddress(activeAddress)}</span>
                <Icon className="ml-2" style={{ fontSize: "1rem" }}>
                  <FaCopy />
                </Icon>
              </div>
            </MenuItem>
            <MenuItem
              sx={{
                textAlign: "start",
                color: "white",
                fontFamily: "poppins, sans-serif",
                borderBottomLeftRadius: "4px",
                borderBottomRightRadius: "4px",
              }}
              onClick={handleClose}
            >
              <div className="flex flex-col justify-start">
                <span className="text-sm font-medium font-sans">
                  <div className="flex flex-row items-center">
                    Balance: {((accountData?.amount || 0) / 10 ** 6).toFixed(2)}
                    {algoLogo}
                  </div>
                </span>
                <span className="text-sm font-medium mb-2 font-sans">
                  <div className="flex flex-row items-center">
                    Min Balance:{" "}
                    {((accountData?.["min-balance"] || 0) / 10 ** 6).toFixed(2)}
                    {algoLogo}
                  </div>
                </span>
                <span className="text-sm font-medium font-sans">
                  Asset Count: {accountData?.["total-assets-opted-in"]}
                </span>
              </div>
            </MenuItem>
            <MenuItem
              sx={{
                backgroundColor: "red",
                color: "white",
                ":hover": { backgroundColor: "red", opacity: "0.8" },
                fontFamily: "poppins, sans-serif",
                fontWeight: "500",
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

/**
 * A customized button for the Wallet Connect button when it is in the main section of the page.
 * See the MUI documentation for more information:
 * <https://mui.com/material-ui/react-button/#customization>
 */
const ButtonMain = styled(Button)<ButtonProps>(({ theme }) => ({
  // #f57b14 is what "primary-orange" color is set to in tailwind.config.js
  borderColor: '#f57b14',
  color: '#f57b14',
  '&:hover': {
    backgroundColor: '#f57b14',
    color: theme.palette.getContrastText('#f57b14'),
  },
}));

