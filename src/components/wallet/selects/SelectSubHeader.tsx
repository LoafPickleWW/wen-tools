import ListSubheader, { ListSubheaderProps } from "@mui/material/ListSubheader";

function SelectSubHeader(props: ListSubheaderProps) {
  return <ListSubheader {...props} />;
}

SelectSubHeader.muiSkipListHighlight = true;
export default SelectSubHeader;
