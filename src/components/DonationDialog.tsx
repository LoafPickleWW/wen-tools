import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import { useState, useEffect } from "react";
import { FaCopy, FaHeart, FaChevronDown } from "react-icons/fa";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";

const DonationDialog = () => {
  const [open, setOpen] = useState(false);
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();

  const [donateAmount, setDonateAmount] = useState<string>("10");
  const [assetType, setAssetType] = useState<"ALGO" | "USDC">("ALGO");
  const [isOptedInUSDC, setIsOptedInUSDC] = useState(false);
  const [donatingInProgress, setDonatingInProgress] = useState(false);

  // Check if connected user is opted into USDC and check balance
  useEffect(() => {
    if (activeAddress && algodClient) {
      const usdcId = activeNetwork === "mainnet" ? 315608 : 10458941;
      algodClient.accountInformation(activeAddress).do()
        .then((res: any) => {
          const assets = res["assets"] || [];
          const usdcAsset = assets.find((a: any) => a["asset-id"] === usdcId);
          if (usdcAsset) {
            setIsOptedInUSDC(true);
            const usdcBalance = usdcAsset["amount"] || 0;
            if (usdcBalance >= 1_000_000) {
              setAssetType("USDC");
            } else {
              setAssetType("ALGO");
            }
          } else {
            setIsOptedInUSDC(false);
            setAssetType("ALGO");
          }
        })
        .catch((err) => {
          console.error("Error checking USDC balance:", err);
          setIsOptedInUSDC(false);
          setAssetType("ALGO");
        });
    } else {
      setIsOptedInUSDC(false);
      setAssetType("ALGO");
    }
  }, [activeAddress, algodClient, activeNetwork]);

  // Set default amount when switching asset type
  useEffect(() => {
    if (assetType === "USDC") {
      setDonateAmount("1");
    } else {
      setDonateAmount("10");
    }
  }, [assetType]);

  const handleOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      "RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ"
    );
    toast.success("Copied to clipboard");
  };

  const handleDonate = async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet first!");
      return;
    }
    const amountNum = parseFloat(donateAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid amount!");
      return;
    }
    setDonatingInProgress(true);
    try {
      const params = await algodClient.getTransactionParams().do();
      let txn;
      const donationAddress = "RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ";
      if (assetType === "ALGO") {
        txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: donationAddress,
          amount: Math.round(amountNum * 1_000_000), // microAlgos
          suggestedParams: params,
        });
      } else {
        const usdcId = activeNetwork === "mainnet" ? 315608 : 10458941;
        txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: donationAddress,
          assetIndex: usdcId,
          amount: Math.round(amountNum * 1_000_000), // USDC has 6 decimals
          suggestedParams: params,
        });
      }
      toast.info("Please sign the transaction in your wallet...");
      const signed = await transactionSigner([txn], [0]);
      toast.info("Sending transaction to network...");
      await algodClient.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algodClient, txn.txID(), 4);
      toast.success("Thank you so much for your support! ❤️");
      handleClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Transaction failed");
    } finally {
      setDonatingInProgress(false);
    }
  };

  const presets = assetType === "ALGO" ? ["10", "50", "250"] : ["1", "5", "25"];

  return (
    <>
      <Button
        variant="contained"
        size="large"
        sx={{
          color: "#010010",
          border: "0",
          background: "linear-gradient(to right, #EAE004, #FF931E)",
          transition: "all 0.3s ease",
          borderRadius: "9999px",
          padding: {
            xs: ".4rem .6rem",
            sm: ".4rem 1.2rem",
          },
          minWidth: {
            xs: "auto",
            sm: "64px",
          },
          textTransform: "none",
          fontSize: {
            xs: ".9rem",
            md: "1.1rem",
          },
          fontFamily: "Poppins, sans-serif",
          opacity: 1,
          boxShadow: "0 0 8px rgba(234, 224, 4, 0.5)",
          animation: "donatePulse 2.5s infinite ease-in-out",
          "@keyframes donatePulse": {
            "0%": {
              boxShadow: "0 0 0 0 rgba(234, 224, 4, 0.7)",
            },
            "70%": {
              boxShadow: "0 0 0 8px rgba(255, 147, 30, 0)",
            },
            "100%": {
              boxShadow: "0 0 0 0 rgba(255, 147, 30, 0)",
            },
          },
          "&:hover": {
            opacity: 0.9,
            transform: "scale(1.05)",
            boxShadow: "0 0 12px rgba(255, 147, 30, 0.8)",
          },
        }}
        onClick={handleOpen}
        className="font-semibold font-sans text-[#010010] text-xl w-auto flex items-center justify-center"
      >
        <span className="hidden sm:inline">Donate</span>
        <span className="inline sm:hidden flex items-center">
          <FaHeart className="text-sm" />
        </span>
      </Button>
      <Dialog 
        open={open} 
        onClose={handleClose}
        PaperProps={{
          sx: {
            backgroundColor: "#1A171A",
            border: "2px solid #FF931E",
            borderRadius: "20px",
            color: "white",
            padding: "8px",
            maxWidth: "380px",
            width: "100%",
          }
        }}
      >
        <DialogTitle sx={{ 
          textAlign: "center",
          fontFamily: "Poppins, sans-serif",
          fontWeight: "bold",
          fontSize: "1.4rem",
          color: "white",
          paddingBottom: "8px"
        }}>
          Support wen.tools
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0.5, pb: 1 }}>
          
          {/* Asset selection if connected and opted into USDC */}
          {isOptedInUSDC && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 font-sans">Select Token</span>
              <ToggleButtonGroup
                value={assetType}
                exclusive
                onChange={(_, val) => val && setAssetType(val)}
                fullWidth
                size="small"
                sx={{
                  "& .MuiToggleButton-root": {
                    color: "white",
                    borderColor: "rgba(255, 147, 30, 0.3)",
                    textTransform: "none",
                    fontFamily: "Poppins, sans-serif",
                    py: 0.5,
                    "&.Mui-selected": {
                      backgroundColor: "#FF931E",
                      color: "#010010",
                      fontWeight: "bold",
                      "&:hover": {
                        backgroundColor: "#FF931E",
                      }
                    }
                  }
                }}
              >
                <ToggleButton value="ALGO">ALGO</ToggleButton>
                <ToggleButton value="USDC">USDC</ToggleButton>
              </ToggleButtonGroup>
            </div>
          )}

          {/* Amount Presets */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-sans">Choose Amount</span>
            <div className="flex gap-1.5">
              {presets.map((preset) => (
                <Button
                  key={preset}
                  variant="outlined"
                  size="small"
                  fullWidth
                  onClick={() => setDonateAmount(preset)}
                  sx={{
                    color: donateAmount === preset ? "#010010" : "white",
                    borderColor: "#FF931E",
                    backgroundColor: donateAmount === preset ? "#FF931E" : "transparent",
                    textTransform: "none",
                    fontFamily: "Poppins, sans-serif",
                    borderRadius: "8px",
                    py: 0.5,
                    fontWeight: donateAmount === preset ? "bold" : "normal",
                    "&:hover": {
                      borderColor: "#FF931E",
                      backgroundColor: donateAmount === preset ? "#FF931E" : "rgba(255, 147, 30, 0.1)",
                    }
                  }}
                >
                  {preset} {assetType}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Input */}
          <TextField
            label="Custom Amount"
            type="number"
            value={donateAmount}
            onChange={(e) => setDonateAmount(e.target.value)}
            variant="outlined"
            margin="none"
            fullWidth
            size="small"
            InputLabelProps={{
              style: { color: "rgba(255, 147, 30, 0.8)", fontSize: "0.80rem" }
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                color: "white",
                backgroundColor: "#272227",
                borderRadius: "10px",
                fontSize: "0.8rem",
                "& fieldset": {
                  borderColor: "rgba(255, 147, 30, 0.5)",
                },
                "&:hover fieldset": {
                  borderColor: "#FF931E",
                },
                "&.Mui-focused fieldset": {
                  borderColor: "#FF931E",
                },
              },
            }}
          />

          {/* Direct Wallet Donation Button */}
          {activeAddress ? (
            <Button
              variant="contained"
              onClick={handleDonate}
              disabled={donatingInProgress}
              sx={{
                background: "linear-gradient(to right, #EAE004, #FF931E)",
                color: "#010010",
                fontWeight: "bold",
                borderRadius: "10px",
                textTransform: "none",
                fontFamily: "Poppins, sans-serif",
                py: 0.75,
                fontSize: "0.95rem",
                "&:hover": {
                  opacity: 0.9,
                }
              }}
            >
              {donatingInProgress ? "Processing..." : `Donate ${donateAmount} ${assetType}`}
            </Button>
          ) : (
            <div className="text-center text-[11px] text-slate-400 p-2 bg-[#272227] rounded-lg border border-dashed border-slate-700">
              Connect wallet in header to donate directly
            </div>
          )}

          {/* Manual QR & Address Accordion */}
          <Accordion
            sx={{
              backgroundColor: "transparent",
              color: "white",
              boxShadow: "none",
              "&:before": { display: "none" },
              border: "1px solid rgba(255, 147, 30, 0.2)",
              borderRadius: "10px !important",
              overflow: "hidden",
            }}
          >
            <AccordionSummary
              expandIcon={<FaChevronDown className="text-[10px] text-[#FF931E]" />}
              sx={{ minHeight: "auto", py: 0, "& .MuiAccordionSummary-content": { my: 0.75 } }}
            >
              <span className="text-[11px] font-semibold text-slate-300 font-sans">Or scan QR / copy address</span>
            </AccordionSummary>
            <AccordionDetails sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, p: 1, pb: 1.5, pt: 0 }}>
              <a href={`algorand://RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ?amount=${Math.round((parseFloat(donateAmount) || 0) * 1_000_000)}&note=Wen%20Tools%20Donation`}>
                <div className="p-2 bg-white rounded-lg inline-block shadow-md hover:scale-105 duration-300">
                  <img
                    src="../qr.svg"
                    alt="donate"
                    className="mx-auto aspect-square rounded-md w-32"
                  />
                </div>
              </a>
              <TextField
                value="RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ"
                variant="outlined"
                margin="none"
                fullWidth
                size="small"
                helperText="wentools.algo"
                FormHelperTextProps={{
                  style: { textAlign: "center", color: "#FF931E", fontWeight: "600", marginTop: "2px", fontSize: "0.7rem" },
                }}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    color: "white",
                    backgroundColor: "#272227",
                    borderRadius: "6px",
                    fontSize: "0.7rem",
                    "& fieldset": {
                      borderColor: "rgba(255, 147, 30, 0.3)",
                    },
                  },
                }}
                InputProps={{
                  endAdornment: (
                    <IconButton onClick={handleCopy} sx={{ color: "#FF931E", p: 0.5 }}>
                      <FaCopy className="w-3 h-3" />
                    </IconButton>
                  ),
                }}
              />
            </AccordionDetails>
          </Accordion>

        </DialogContent>
      </Dialog>
    </>
  );
};

export default DonationDialog;
