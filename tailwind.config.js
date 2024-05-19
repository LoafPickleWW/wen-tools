/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      spacing: {
        108: "27rem",
      },
      colors: {
        "orange-1000": "#C254414B",
        "red-1000": "#801F19",
        "special-red": "#7a0909",
        "primary-green": "#02AE70",
        "primary-blue": "#6EC1E4",
        "primary-yellow": "#FFC000",
        "primary-red": "#BB000E",
        "secondary-green": "#327A32",
        "secondary-yellow": "#F7DF7C",
        "primary-black": "#010002",
        "primary-gray": "#D0D0D1",
        "secondary-gray": "#393C3A",
        "secondary-black": "#000a02",
      },
      fontSize: {
        xxs: "0.6rem",
      },
    },
    fontFamily: {
      roboto: ["Roboto", "sans-serif"],
    },
  },
  plugins: [],
};
