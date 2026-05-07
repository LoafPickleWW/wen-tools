import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  CircularProgress,
} from "@mui/material";
import { IoLockClosed } from "react-icons/io5";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (passphrase: string) => Promise<void>;
  title?: string;
  description?: string;
}

export default function PassphraseDialog({
  open,
  onClose,
  onSubmit,
  title = "Enter Passphrase",
  description = "This account is protected with a passphrase. Enter it to continue.",
}: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!passphrase) return;
    setLoading(true);
    setError("");
    try {
      await onSubmit(passphrase);
      setPassphrase("");
    } catch (err: any) {
      setError(err.message?.includes("Unsupported") ? "Incorrect passphrase" : (err.message || "Incorrect passphrase"));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassphrase("");
    setError("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle
        sx={{
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <IoLockClosed /> {title}
      </DialogTitle>
      <DialogContent className="flex flex-col gap-3 pt-2">
        <p className="text-sm opacity-70">{description}</p>
        <TextField
          label="Passphrase"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          size="small"
          fullWidth
          autoFocus
          error={!!error}
          helperText={error}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!passphrase || loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? "Decrypting…" : "Unlock"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
