/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta escura no espírito do portal Contabilidade.net
        fundo: {
          DEFAULT: '#0a0a0f', // fundo da página
          card: '#13131c',    // superfície dos cards
          eleva: '#1c1c28',   // superfície elevada (inputs, cabeçalhos de tabela)
          borda: '#2a2a3a',
        },
        marca: {
          azul: '#2f6fff',
          ciano: '#22d3ee',
          roxo: '#7c3aed',
          neon: '#4f8cff',
        },
      },
      boxShadow: {
        neon: '0 0 40px rgba(47, 111, 255, 0.18)',
      },
    },
  },
  plugins: [],
};
