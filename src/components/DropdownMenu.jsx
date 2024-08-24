import React from "react";

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

import { EXTERNAL_LINKS } from "../constants";

const DropdownMenu = ({ onClose, isOpen }) => {
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
          Useful Links
        </Typography>
      </Toolbar>
      <Divider color="white" />
      <List>
        {EXTERNAL_LINKS.map((item) => (
          <ListItemButton component="a" href={item.url} target="_blank">
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText
              primary={item.name}
              sx={{ color: "white", fontWeight: "bold" }}
            />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
};

export default DropdownMenu;
