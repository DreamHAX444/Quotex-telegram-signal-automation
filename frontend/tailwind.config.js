/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#09090B',
        card: '#09090B',
        foreground: '#FAFAFA',
        muted: '#27272A',
        'muted-foreground': '#A1A1AA',
        border: '#27272A',
        accent: '#10B981', // Crisp Emerald
        'accent-foreground': '#052e16',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      }
    }
  },
  plugins: [],
}
