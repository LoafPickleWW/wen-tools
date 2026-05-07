import { useState, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import { toast } from "react-toastify";
import { importAccount } from "../../utils/falcon";
import { saveAccount, getAccountByAddress } from "../../db/falconDb";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function ImportAccountDialog({ open, onClose, onImported }: Props) {
  const [jsonText, setJsonText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setJsonText(reader.result as string);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    try {
      const account = importAccount(jsonText);

      // Check for duplicates
      const existing = await getAccountByAddress(account.address);
      if (existing) {
        toast.warning("This account is already stored in your browser.");
        return;
      }

      await saveAccount(account);
      toast.success("Account imported!");
      setJsonText("");
      onImported();
      onClose();
    } catch (err: any) {
      toast.error(`Import failed: ${err.message || err}`);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Import Falcon Account</DialogTitle>
      <DialogContent className="flex flex-col gap-4 pt-2">
        <p className="text-sm opacity-70">
          Upload or paste the JSON backup file that was exported from this tool.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button
          variant="outlined"
          onClick={() => fileRef.current?.click()}
          fullWidth
        >
          Choose JSON File
        </Button>

        <TextField
          label="Or paste JSON here"
          multiline
          rows={6}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          size="small"
          fullWidth
          InputProps={{
            sx: { fontFamily: "monospace", fontSize: "0.75rem" },
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={!jsonText.trim()}
        >
          Import
        </Button>
      </DialogActions>
    </Dialog>
  );
}
