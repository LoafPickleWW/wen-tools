import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  CircularProgress,
  FormControlLabel,
  Switch,
  Collapse,
} from "@mui/material";
import { IoLockClosed } from "react-icons/io5";
import { toast } from "react-toastify";
import {
  createAccount,
  encryptSecretKey,
  type NetworkName,
} from "../../utils/falcon";
import { saveAccount } from "../../db/falconDb";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateAccountDialog({ open, onClose, onCreated }: Props) {
  const [label, setLabel] = useState("");
  const [network, setNetwork] = useState<NetworkName>("testnet");
  const [creating, setCreating] = useState(false);

  // Passphrase encryption
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");

  const resetForm = () => {
    setLabel("");
    setUsePassphrase(false);
    setPassphrase("");
    setConfirmPassphrase("");
  };

  const handleCreate = async () => {
    // Validate passphrase if enabled
    if (usePassphrase) {
      if (!passphrase) {
        toast.warning("Please enter a passphrase.");
        return;
      }
      if (passphrase.length < 8) {
        toast.warning("Passphrase must be at least 8 characters.");
        return;
      }
      if (passphrase !== confirmPassphrase) {
        toast.warning("Passphrases don't match.");
        return;
      }
    }

    setCreating(true);
    try {
      const account = await createAccount(network, label || undefined);

      let accountToSave = account;
      if (usePassphrase && passphrase) {
        const enc = await encryptSecretKey(account.secretKey, passphrase);
        accountToSave = {
          ...account,
          secretKey: enc.ciphertext,
          encrypted: true,
          salt: enc.salt,
          iv: enc.iv,
        };
      }

      await saveAccount(accountToSave);
      toast.success(
        usePassphrase
          ? "Falcon account created & encrypted!"
          : "Falcon account created!",
      );
      resetForm();
      onCreated();
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to create account: ${err.message || err}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Create Post-Quantum Account
      </DialogTitle>
      <DialogContent className="flex flex-col gap-4 pt-2">
        <p className="text-sm opacity-70">
          This generates a Falcon-1024 keypair entirely in your browser using
          WebAssembly. The private key never leaves your device.
        </p>
        <TextField
          label="Account Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. My PQ Test Account"
          size="small"
          fullWidth
        />
        <TextField
          select
          label="Network"
          value={network}
          onChange={(e) => setNetwork(e.target.value as NetworkName)}
          size="small"
          fullWidth
          helperText="Use Testnet for experimentation. Do not store real funds."
        >
          <MenuItem value="testnet">TestNet</MenuItem>
          <MenuItem value="mainnet">MainNet (caution!)</MenuItem>
          <MenuItem value="betanet">BetaNet</MenuItem>
        </TextField>

        {/* Passphrase protection */}
        <div className="border border-white/10 rounded-lg p-3 mt-1">
          <FormControlLabel
            control={
              <Switch
                checked={usePassphrase}
                onChange={(e) => setUsePassphrase(e.target.checked)}
                size="small"
              />
            }
            label={
              <span className="flex items-center gap-1 text-sm">
                <IoLockClosed className="opacity-60" />
                Protect with passphrase
              </span>
            }
          />
          <Collapse in={usePassphrase}>
            <div className="flex flex-col gap-3 mt-3">
              <p className="text-xs opacity-50">
                Your secret key will be encrypted with AES-256-GCM before
                storage. You'll need this passphrase to send transactions or
                export the account.
              </p>
              <TextField
                label="Passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                size="small"
                fullWidth
                helperText={
                  passphrase && passphrase.length < 8
                    ? "Must be at least 8 characters"
                    : ""
                }
                error={!!passphrase && passphrase.length < 8}
              />
              <TextField
                label="Confirm Passphrase"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                size="small"
                fullWidth
                error={
                  confirmPassphrase !== "" &&
                  passphrase !== confirmPassphrase
                }
                helperText={
                  confirmPassphrase !== "" &&
                  passphrase !== confirmPassphrase
                    ? "Passphrases don't match"
                    : ""
                }
              />
            </div>
          </Collapse>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={creating}
          startIcon={creating ? <CircularProgress size={16} /> : null}
        >
          {creating ? "Generating Keys…" : "Create Account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
