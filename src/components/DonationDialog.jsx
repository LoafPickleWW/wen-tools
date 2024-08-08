import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";
import { orange } from '@mui/material/colors';
import { createTheme } from '@mui/material/styles';
import { useState } from "react";
import { FaCopy } from "react-icons/fa";
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
        variant="outlined"
        color="info"
        size="medium"
        style={{ margin: "0 auto", display: "flex", marginTop: "1rem", color: "#f57b14"}}
        onClick={handleOpen}
      >
        Donate
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
