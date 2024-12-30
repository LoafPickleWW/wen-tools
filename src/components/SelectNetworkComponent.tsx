import { Select, MenuItem } from "@mui/material";
import FormGroup from "@mui/material/FormGroup";
import { NetworkId, useWallet } from "@txnlab/use-wallet-react";

export default function SelectNetworkComponent() {
  const { activeNetwork, setActiveNetwork } = useWallet();

  return (
    <FormGroup
      sx={{
        justifyContent: "center",
        padding: "0rem!important",
      }}
      className="text-[#010010] p-0 font-bold font-sans"
    >
      <div className="relative w-full bg-gradient-to-r from-[#EAE004] to-[#FF931E] rounded-full text-[#010010] font-bold p-0 font-sans border-0 flex items-center justify-center">
        <Select
          value={activeNetwork}
          onChange={(e) => setActiveNetwork(e.target.value as NetworkId)}
          displayEmpty
          inputProps={{
            "aria-label": "Without label",
            style: { appearance: "none" }, // Removes default arrow
          }}
          sx={{
            color: "#010010",
            border: "0",
            background: "linear-gradient(to right, #EAE004, #FF931E)",
            transition: "color 0.3s ease, opacity 0.3s ease",
            borderRadius: "9999px",
            textTransform: "none",
            fontSize: {
              xs: ".8rem",
              md: "1.2rem",
            },
            fontFamily: "Poppins, sans-serif",
            fontWeight: "500",
            opacity: 0.8,
            "&:hover": {
              opacity: 1,
            },
            "& .MuiSelect-icon": {
              display: "none", // Hides the Material-UI icon
            },
            "& .MuiInputBase-input": {
              padding: ".5rem",
            },
            "& .MuiSelect-select":
              {
                paddingRight: ".5rem!important",
              },
          }}
          className="w-full bg-gradient-to-r from-[#EAE004] to-[#FF931E] rounded-full text-[#010010] font-bold p-0 font-sans border-0"
        >
          <MenuItem
            value={NetworkId.MAINNET}
            className="p-0 font-bold font-sans border-0"
            sx={{
              fontSize: {
                xs: ".8rem",
                md: "1.2rem",
              },
              fontFamily: "Poppins, sans-serif",
              fontWeight: "500",
              "&:hover": {
                backgroundColor: "#FF931E",
                color: "#000",
              },
            }}
          >
            Mainnet
          </MenuItem>
          <MenuItem
            value={NetworkId.TESTNET}
            className="p-0 font-bold font-sans border-0"
            sx={{
              fontSize: {
                xs: ".8rem",
                md: "1.2rem",
              },
              fontFamily: "Poppins, sans-serif",
              fontWeight: "500",
              "&:hover": {
                backgroundColor: "#FF931E",
                color: "#000",
              },
            }}
          >
            Testnet
          </MenuItem>
        </Select>
      </div>
    </FormGroup>
  );
}