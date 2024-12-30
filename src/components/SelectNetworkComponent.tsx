import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Switch from "@mui/material/Switch";
import { NetworkId, useWallet } from "@txnlab/use-wallet-react";

export default function SelectNetworkComponent() {
  const { activeNetwork, setActiveNetwork } = useWallet();

  return (
    <FormGroup sx={{ justifyContent: "center" }}>
      <FormControlLabel
        label={
          <span className="font-sans text-primary-gray">
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
                backgroundColor: "#f57b14",
              },
              "& .MuiSwitch-track": {
                backgroundColor: "#fff",
              },
              "& .Mui-checked + span.MuiSwitch-track": {
                backgroundColor: "#f57b14",
              },
            }}
          />
        }
        classes={{ label: "text-white" }}
      />
    </FormGroup>
  );
}