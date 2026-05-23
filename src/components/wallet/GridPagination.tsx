import Box from "@mui/material/Box";
import Pagination from "@mui/material/Pagination";
import React from "react";

interface GridPaginationProps {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
  siblingCount?: number;
  boundaryCount?: number;
}

const GridPagination: React.FC<GridPaginationProps> = ({
  currentPage,
  totalPages,
  onChange,
  siblingCount = 1,
  boundaryCount = 2,
}) => {
  const handlePageChange = (
    _event: React.ChangeEvent<unknown>,
    page: number
  ) => {
    onChange(page);
  };

  return (
    <Box display="flex" justifyContent="center" mb={2}>
      <Pagination
        count={totalPages}
        page={currentPage}
        onChange={handlePageChange}
        boundaryCount={boundaryCount}
        siblingCount={siblingCount}
        showFirstButton
        showLastButton
        shape="rounded"
        sx={{
          "& .MuiPaginationItem-root": {
            borderRadius: "none",
            margin: "0 2px",
            color: "white",
            "&.Mui-selected": {
              backgroundColor: "#f57b14", 
              color: "black",
              "&:hover": {
                backgroundColor: "#f57b14",
              }
            },
          },
        }}
      />
    </Box>
  );
};

export default GridPagination;
