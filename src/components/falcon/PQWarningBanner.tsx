import { Alert, AlertTitle } from "@mui/material";
import { IoWarning } from "react-icons/io5";

export default function PQWarningBanner() {
  return (
    <Alert
      severity="warning"
      icon={<IoWarning className="text-2xl" />}
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "warning.main",
        "& .MuiAlert-message": { width: "100%" },
      }}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>
        Experimental Technology Demo
      </AlertTitle>
      <p className="text-sm leading-relaxed">
        This tool showcases{" "}
        <strong>post-quantum Falcon-1024 signatures</strong> on Algorand.
        Keys are stored <strong>only in your browser's local storage</strong>.
        Clearing browser data, switching browsers, or losing your device will{" "}
        <strong>permanently lose access</strong> unless you export your keys.
        <br />
        <strong>Do not use this for significant funds.</strong> This is not a
        production wallet.
      </p>
    </Alert>
  );
}
