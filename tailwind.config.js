/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      spacing: {
        '108': '27rem',
      },
      colors: {
        'orange-1000' : '#C254414B',
      },
      
      fontSize: {
        'xxs': '0.6rem',
      },
    },
    fontFamily: {
      'roboto': ['Roboto', 'sans-serif'],
    }
  },
  plugins: [],
}
