import {
  Drawer,
  Toolbar,
  Typography,
  Divider,
  List,
  ListItemIcon,
  ListItemText,
  ListItemButton,
} from "@mui/material";

import { FaWallet } from "react-icons/fa";
import { IoSwapHorizontal } from "react-icons/io5";
import { type DropdownMenu } from "../types";
import DonationDialog from "./DonationDialog";

const DropdownMenu = ({ onClose, isOpen }: DropdownMenu) => {
  return (
    <Drawer
      variant="temporary"
      open={isOpen}
      onClose={onClose}
      ModalProps={{
        keepMounted: true, // Better open performance on mobile.
      }}
      PaperProps={{
        sx: { backgroundColor: "#1A171A" },
      }}
      sx={{
        "& .MuiDrawer-paper": {
          boxSizing: "border-box",
          width: 240,
        },
      }}
    >
      <Toolbar>
        <Typography
          variant="h6"
          color="white"
          sx={{
            fontWeight: "bold",
          }}
        >
          More Tools
        </Typography>
      </Toolbar>
      <Divider color="white" />
      <List className="text-center">
        <ListItemButton
          component="a"
          href="https://wallet.wen.tools"
          target="_blank"
        >
          <ListItemIcon>
            <FaWallet size={20} color="white" />
          </ListItemIcon>
          <ListItemText
            primary="Wen Wallet"
            sx={{ color: "white", fontWeight: "bold" }}
          />
        </ListItemButton>
        <ListItemButton
          component="a"
          href="https://swap.wen.tools"
          target="_blank"
        >
          <ListItemIcon>
            <IoSwapHorizontal size={24} color="white" />
          </ListItemIcon>
          <ListItemText
            primary="Wen Swap"
            sx={{ color: "white", fontWeight: "bold" }}
          />
        </ListItemButton>
        <div className="mt-3">
          <DonationDialog />
        </div>
      </List>
    </Drawer>
  );
};

export default DropdownMenu;
