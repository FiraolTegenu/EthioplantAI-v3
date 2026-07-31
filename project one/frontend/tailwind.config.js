/** @type {import('tailwindcss').Config} */
export default {
  content: ['./*.html', './public/js/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          bgTop: '#F4F2E8',
          bgBottom: '#FCFAEE',
          textDark: '#1A3320',
          accent: '#2C4A3B',
          border: '#E2DEC7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['"Playfair Display"', 'serif'],
      },
    },
  },
  plugins: [],
};
