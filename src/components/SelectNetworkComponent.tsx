import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Switch from "@mui/material/Switch";
import { NetworkId, useWallet } from "@txnlab/use-wallet-react";
import { usePQTheme } from "../context/PQThemeContext";

export default function SelectNetworkComponent() {
  const { activeNetwork, setActiveNetwork } = useWallet();
  const { isThemeActive } = usePQTheme();

  return (
    <FormGroup sx={{ justifyContent: "center" }}>
      <FormControlLabel
        label={
          <span className={`font-sans text-sm font-medium transition-colors ${isThemeActive ? "text-cyan-300 font-bold" : "text-primary-gray"}`}>
            {activeNetwork.charAt(0).toUpperCase() + activeNetwork.slice(1)}
          </span>
        }
        control={
          <Switch
            checked={activeNetwork === NetworkId.MAINNET}
            onChange={() =>
              activeNetwork === NetworkId.MAINNET
                ? setActiveNetwork(NetworkId.TESTNET)
                : setActiveNetwork(NetworkId.MAINNET)
            }
            sx={{
              "& .MuiSwitch-thumb": {
                backgroundColor: isThemeActive ? "var(--pq-primary, #00f0ff)" : "#f57b14",
                boxShadow: isThemeActive ? "0 0 10px var(--pq-glow)" : "none",
                transition: "all 0.3s ease",
              },
              "& .MuiSwitch-track": {
                backgroundColor: isThemeActive ? "var(--pq-glow, rgba(0,240,255,0.4))" : "#fff",
                opacity: isThemeActive ? 0.8 : 0.3,
              },
              "& .Mui-checked + span.MuiSwitch-track": {
                backgroundColor: isThemeActive ? "var(--pq-primary, #00f0ff)" : "#f57b14",
                opacity: 0.7,
              },
            }}
          />
        }
        classes={{ label: "text-white" }}
      />
    </FormGroup>
  );
}
