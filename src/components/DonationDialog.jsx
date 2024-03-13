import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";
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
      "VYPDFMVRXCI2Z4FPC2GHB4QC6PSCTEDAS4EU7GE3W4B3MRHXNZO6BB2RZA"
    );
    toast.success("Copied to clipboard");
  };

  return (
    <>
      <Button
        variant="outlined"
        color="info"
        size="medium"
        style={{ margin: "0 auto", display: "flex", marginTop: "1rem"}}
        onClick={handleOpen}
      >
        Donate
      </Button>
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle sx={{ textAlign: "center" }}>Donate</DialogTitle>
        <DialogContent>
          <a href="algorand://VYPDFMVRXCI2Z4FPC2GHB4QC6PSCTEDAS4EU7GE3W4B3MRHXNZO6BB2RZA?amount=25000000&note=The%20Laboratory%20Donation">
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
            value="VYPDFMVRXCI2Z4FPC2GHB4QC6PSCTEDAS4EU7GE3W4B3MRHXNZO6BB2RZA"
            variant="outlined"
            margin="none"
            fullWidth
            size="small"
            helperText="bykewel.algo"
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
