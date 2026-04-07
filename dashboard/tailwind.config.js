/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          500: '#4f46e5',
          600: '#4338ca',
          700: '#3730a3'
        }
      }
    }
  },
  plugins: []
};
