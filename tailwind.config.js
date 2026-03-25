/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        snu: {
          blue: '#003B71',
          gray: '#E8E9EA',
          dark: '#00274c',
          text: '#333333',
        }
      },
      keyframes: {
        'shrink': {
          '0%': { width: '100%' },
          '100%': { width: '0%' }
        },
        'fade-in-up': {
          '0%': {
            opacity: '0',
            transform: 'translateY(15px)'
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)'
          },
        },
        'bounce-soft': {
          '0%, 100%': {
            transform: 'translateY(-5%)',
            animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)'
          },
          '50%': {
            transform: 'translateY(0)',
            animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)'
          }
        }
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
        'bounce-soft': 'bounce-soft 2s infinite',
      }
    },
  },
  plugins: [],
};
