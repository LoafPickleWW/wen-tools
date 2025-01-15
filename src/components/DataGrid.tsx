import * as React from "react";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Checkbox from "@mui/material/Checkbox";
import Tooltip from "@mui/material/Tooltip";
import { visuallyHidden } from "@mui/utils";
import { HeadCell } from "../types";
import { Button } from "@mui/material";

interface BaseData {
  id: number;
  [key: string]: any;
}

type Order = "asc" | "desc";

function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  if (b[orderBy] < a[orderBy]) {
    return -1;
  }
  if (b[orderBy] > a[orderBy]) {
    return 1;
  }
  return 0;
}

function getComparator<T extends BaseData>(
  order: Order,
  orderBy: keyof T
): (a: T, b: T) => number {
  return order === "desc"
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

interface EnhancedTableHeadProps<T extends BaseData> {
  numSelected: number;
  onRequestSort: (event: React.MouseEvent<unknown>, property: keyof T) => void;
  onSelectAllClick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  order: Order;
  orderBy: keyof T;
  rowCount: number;
  headCells: HeadCell[];
}

function EnhancedTableHead<T extends BaseData>(
  props: EnhancedTableHeadProps<T>
) {
  const {
    onSelectAllClick,
    order,
    orderBy,
    numSelected,
    rowCount,
    onRequestSort,
    headCells,
  } = props;

  const createSortHandler =
    (property: keyof T) => (event: React.MouseEvent<unknown>) => {
      onRequestSort(event, property);
    };

  return (
    <TableHead>
      <TableRow>
        <TableCell padding="checkbox">
          <Checkbox
            color="warning"
            indeterminate={numSelected > 0 && numSelected < rowCount}
            checked={rowCount > 0 && numSelected === rowCount}
            onChange={onSelectAllClick}
            inputProps={{
              "aria-label": "select all",
            }}
          />
        </TableCell>
        {headCells.map((headCell) => (
          <TableCell
            key={String(headCell.id)}
            align="center"
            padding={headCell.disablePadding ? "none" : "normal"}
            sortDirection={orderBy === headCell.id ? order : false}
          >
            <TableSortLabel
              active={orderBy === headCell.id}
              direction={orderBy === headCell.id ? order : "asc"}
              onClick={createSortHandler(headCell.id)}
            >
              {headCell.label}
              {orderBy === headCell.id ? (
                <Box component="span" sx={visuallyHidden}>
                  {order === "desc" ? "sorted descending" : "sorted ascending"}
                </Box>
              ) : null}
            </TableSortLabel>
          </TableCell>
        ))}
      </TableRow>
    </TableHead>
  );
}

interface EnhancedTableToolbarProps<T extends BaseData> {
  numSelected: number;
  title: string;
  selected: T[];
  actions: {
    tooltipTitle: string;
    icon: JSX.Element;
    onClick: (
      selected: T[],
      setDisabled: React.Dispatch<React.SetStateAction<boolean>>
    ) => void;
  }[];
}

function EnhancedTableToolbar<T extends BaseData>(
  props: EnhancedTableToolbarProps<T>
) {
  const { numSelected, title, actions, selected } = props;
  const [disabled, setDisabled] = React.useState(false);
  return (
    <Toolbar
      sx={[
        {
          pl: { sm: 2 },
          pr: { xs: 1, sm: 1 },
        },
        numSelected > 0 && {
          bgcolor: (theme) =>
            alpha("#C254414B", theme.palette.action.hoverOpacity),
        },
      ]}
    >
      {numSelected > 0 ? (
        <Typography
          sx={{ flex: "1 1 100%" }}
          color="inherit"
          variant="subtitle1"
          component="div"
        >
          {numSelected} selected
        </Typography>
      ) : (
        <Typography
          sx={{ flex: "1 1 100%" }}
          variant="h6"
          id="tableTitle"
          component="div"
        >
          {title}
        </Typography>
      )}
      {numSelected > 0 &&
        actions.map((action) => (
          <Tooltip title={action.tooltipTitle} key={action.tooltipTitle}>
            <Button
              className={`${
                disabled ? "!cursor-not-allowed !text-gray-400" : "!text-primary-orange"
              }`}
              disabled={disabled}
              onClick={(_) => action.onClick(selected, setDisabled)}
            >
              {action.icon}
            </Button>
          </Tooltip>
        ))}
    </Toolbar>
  );
}

interface EnhancedTableProps<T extends BaseData> {
  title: string;
  headCells: HeadCell[];
  data: T[];
  actions: {
    tooltipTitle: string;
    icon: JSX.Element;
    onClick: (
      selected: T[],
      setDisabled: React.Dispatch<React.SetStateAction<boolean>>
    ) => void;
  }[];
  initialOrderBy?: keyof T;
  initialOrder?: Order;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
}

export function EnhancedTable<T extends BaseData>({
  title,
  headCells,
  data,
  actions,
  initialOrderBy = "id" as keyof T,
  initialOrder = "asc",
  rowsPerPageOptions = [5, 10, 25],
  defaultRowsPerPage = 5,
}: EnhancedTableProps<T>) {
  const [order, setOrder] = React.useState<Order>(initialOrder);
  const [orderBy, setOrderBy] = React.useState<keyof T>(initialOrderBy);
  const [selected, setSelected] = React.useState<T[]>([]);
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(defaultRowsPerPage);

  const handleRequestSort = (
    _: React.MouseEvent<unknown>,
    property: keyof T
  ) => {
    const isAsc = orderBy === property && order === "asc";
    setOrder(isAsc ? "desc" : "asc");
    setOrderBy(property);
  };

  const handleSelectAllClick = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelected(data);
      return;
    }
    setSelected([]);
  };

  const handleClick = (_: React.MouseEvent<unknown>, row: T) => {
    let newSelected: T[] = [];

    const isExists = selected.some((item) => item.id === row.id);
    if (isExists) {
      newSelected = selected.filter((item) => item.id !== row.id);
    } else {
      newSelected = [...selected, row];
    }
    setSelected(newSelected);
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const emptyRows =
    page > 0 ? Math.max(0, (1 + page) * rowsPerPage - data.length) : 0;

  const visibleRows = React.useMemo(
    () =>
      [...data]
        .sort(getComparator(order, orderBy))
        .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [data, order, orderBy, page, rowsPerPage]
  );

  return (
    <Box className="max-w-[400px] md:max-w-[1000px]">
      <Paper sx={{ width: "100%", mb: 2 }}>
        <EnhancedTableToolbar
          title={title}
          selected={selected}
          numSelected={selected.length}
          actions={actions}
        />
        <TableContainer>
          <Table
            sx={{ minWidth: 750 }}
            aria-labelledby="tableTitle"
            size="small"
          >
            <EnhancedTableHead
              numSelected={selected.length}
              order={order}
              orderBy={orderBy}
              onSelectAllClick={handleSelectAllClick}
              onRequestSort={handleRequestSort}
              rowCount={data.length}
              headCells={headCells}
            />
            <TableBody>
              {visibleRows.map((row, index) => {
                const isItemSelected = selected.includes(row);
                const labelId = `enhanced-table-checkbox-${index}`;

                return (
                  <TableRow
                    hover
                    onClick={(event) => handleClick(event, row)}
                    role="checkbox"
                    aria-checked={isItemSelected}
                    tabIndex={-1}
                    key={row.id}
                    selected={isItemSelected}
                    sx={{
                      cursor: "pointer",
                      "&.Mui-selected": {
                        bgcolor: (theme) =>
                          alpha("#C254414B", theme.palette.action.hoverOpacity),
                        "&:hover": {
                          bgcolor: (theme) =>
                            alpha(
                              "#C254414B",
                              theme.palette.action.focusOpacity
                            ),
                        },
                      },
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        color="warning"
                        checked={isItemSelected}
                        inputProps={{
                          "aria-labelledby": labelId,
                        }}
                      />
                    </TableCell>
                    {headCells.map((headCell) => (
                      <TableCell key={String(headCell.id)} align="center">
                        {row[headCell.id]}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
              {emptyRows > 0 && (
                <TableRow
                  style={{
                    height: 33 * emptyRows,
                  }}
                >
                  <TableCell colSpan={headCells.length + 1} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={rowsPerPageOptions}
          component="div"
          count={data.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </Paper>
    </Box>
  );
}
