import React from "react";

interface NumberFormatterProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  className?: string; // Tailwind or custom styles can be passed
}

export const NumberFormatter: React.FC<NumberFormatterProps> = ({
  value,
  className = "",
  ...props
}) => {
  /**
   * Format large numbers with appropriate suffix (e.g., M, B, T, etc.),
   * starting with millions. Numbers below 1 million will be formatted with commas.
   */
  const formatNumber = (num: number): { display: string; full: string } => {
    const fullNumber = num.toLocaleString(); // Full number with commas
    const suffixes = ["", "", "M", "B", "T", "Q", "Qi", "Sx"]; // Start suffix from 'M'
    let index = 0;

    // Skip formatting for numbers less than 1 million
    if (num < 1_000_000) {
      return { display: fullNumber, full: fullNumber };
    }

    while (num >= 1000 && index < suffixes.length - 1) {
      num /= 1000;
      index++;
    }

    const rounded = parseFloat(num.toFixed(2)); // Round to 2 decimal places
    const display =
      rounded % 1 === 0
        ? `${Math.floor(rounded)} ${suffixes[index]}`
        : `${rounded} ${suffixes[index]}`;

    return { display, full: fullNumber };
  };

  const { display, full } = formatNumber(value);

  return (
    <div
      className={`${className}`}
      title={full} // Tooltip with the full number
      {...props}
    >
      <span>{display}</span>
    </div>
  );
};
