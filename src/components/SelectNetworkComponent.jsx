import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Switch from "@mui/material/Switch";
import { useState, useEffect } from "react";

export default function SelectNetworkComponent() {
  const [selectNetwork, setSelectNetwork] = useState("mainnet");

  const updateNetworkType = (networkType) => {
    localStorage.setItem("networkType", networkType);
    setSelectNetwork(networkType);
  };

  useEffect(() => {
    if (localStorage.getItem("networkType") !== null) {
      updateNetworkType(localStorage.getItem("networkType"));
    } else {
      // default network is mainnet
      updateNetworkType("mainnet");
    }
  }, []);

  return (
    <FormGroup sx={{ justifyContent: "center" }}>
      <FormControlLabel
        label={
          <span className="font-sans text-primary-gray">
            {selectNetwork.charAt(0).toUpperCase() + selectNetwork.slice(1)}
          </span>
        }
        checked={selectNetwork === "mainnet"}
        control={
          <Switch
            checked={selectNetwork === "mainnet"}
            onChange={() =>
              selectNetwork === "mainnet"
                ? updateNetworkType("testnet")
                : updateNetworkType("mainnet")
            }
            sx={{
              "& .MuiSwitch-thumb": {
                backgroundColor: "#fff",
              },
              "& .MuiSwitch-track": {
                backgroundColor: "#fff",
              },
              "& .Mui-checked": {
                color: "primary-green",
              },
            }}
            style={{ color: "#f57b14" }}
          />
        }
        classes={{ label: "text-white" }}
      />
    </FormGroup>
  );
}
