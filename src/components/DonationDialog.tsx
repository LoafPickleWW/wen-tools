import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";
import { useState } from "react";
import { FaCopy, FaHeart } from "react-icons/fa";
import { toast } from "react-toastify";

const DonationDialog = () => {
  const [open, setOpen] = useState(false);

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
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle sx={{ textAlign: "center" }}>Donate</DialogTitle>
        <DialogContent>
          <a href="algorand://RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ?amount=25000000&note=Wen%20Tools%20Donation">
            <img
              src="../qr.svg"
              alt="donate"
              className="mx-auto aspect-square rounded-lg hover:brightness-110 w-64"
            />
          </a>
          <p className="text-center text-xs text-gray-500 font-roboto my-2">
            Click/Scan the QR code or copy the address below 🙏
          </p>
          <TextField
            value="RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ"
            variant="outlined"
            margin="none"
            fullWidth
            size="small"
            helperText="wentools.algo"
            FormHelperTextProps={{
              style: { textAlign: "center" },
            }}
            InputProps={{
              endAdornment: (
                <IconButton onClick={handleCopy}>
                  <FaCopy className="w-4 h-4" />
                </IconButton>
              ),
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DonationDialog;
