/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 20px 60px rgba(15, 23, 42, 0.10)',
        glow: '0 0 60px rgba(59, 130, 246, 0.18)'
      }
    }
  },
  plugins: []
}
