/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta clara do RTE. Os nomes dos tokens foram mantidos para não
        // quebrar as centenas de usos espalhados pelos componentes: mudou o
        // valor, não a chave.
        fundo: {
          DEFAULT: '#F7F6F3', // fundo da página
          card: '#FFFFFF',    // superfície dos cards
          eleva: '#FBFAF7',   // superfície elevada (inputs, cabeçalhos de tabela)
          borda: '#E5E3DC',
        },
        marca: {
          // O roxo do logotipo RTE é a cor de ação do sistema inteiro.
          azul: '#7F2BF5',   // token histórico: hoje é o roxo da marca
          ciano: '#B47CFF',
          roxo: '#5E1BB8',
          neon: '#9B5CF7',
        },
        tinta: {
          forte: '#111111',  // títulos
          media: '#3D3D3A',  // texto corrido
          fraca: '#5F5E5A',  // texto de apoio
          suave: '#888780',  // legendas e placeholders
        },
      },
      boxShadow: {
        neon: '0 1px 3px rgba(17, 17, 17, 0.06)',
      },
    },
  },
  plugins: [],
};
