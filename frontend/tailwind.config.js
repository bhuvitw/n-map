/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Government / enterprise intelligence console palette.
        navy: {
          950: '#070b14',
          900: '#0a1020',
          850: '#0e1526',
          800: '#121b30',
          750: '#17213a',
          700: '#1d2b48',
          600: '#27395c',
        },
        steel: {
          400: '#7f9cc0',
          300: '#9db3d1',
        },
        accent: {
          DEFAULT: '#4b86d4',
          bright: '#5d9bea',

        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
