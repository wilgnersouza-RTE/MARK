/**
 * Importa a tabela oficial de cClassTrib para data/cclasstrib.json.
 *
 * A tabela é publicada no Portal Nacional da NF-e (aba Documentos > Diversos)
 * e muda a cada poucos meses. Em vez de manter os códigos no código-fonte,
 * baixe a planilha oficial e rode este script:
 *
 *   npm run importar:cclasstrib -- /caminho/tabela-cclasstrib.xlsx
 *   npm run importar:cclasstrib -- /caminho/tabela-cclasstrib.csv
 *
 * O script tenta reconhecer as colunas pelo nome, independentemente da ordem,
 * porque o layout da planilha já mudou entre versões do Informe Técnico.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

interface Linha {
  [coluna: string]: any;
}

/** Normaliza para comparar cabeçalhos sem depender de acento, caixa ou espaço */
function normalizar(texto: string): string {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Procura o valor de uma coluna testando vários nomes possíveis */
function coluna(linha: Linha, ...candidatos: string[]): string {
  const chaves = Object.keys(linha);

  for (const candidato of candidatos) {
    const alvo = normalizar(candidato);
    const chave = chaves.find(k => normalizar(k) === alvo);
    if (chave && linha[chave] !== undefined && linha[chave] !== null) {
      return String(linha[chave]).trim();
    }
  }

  // Segunda tentativa: casamento parcial
  for (const candidato of candidatos) {
    const alvo = normalizar(candidato);
    const chave = chaves.find(k => normalizar(k).includes(alvo));
    if (chave && linha[chave] !== undefined && linha[chave] !== null) {
      return String(linha[chave]).trim();
    }
  }

  return '';
}

function main() {
  const arquivo = process.argv[2];

  if (!arquivo) {
    console.error('Uso: npm run importar:cclasstrib -- /caminho/da/tabela.xlsx');
    process.exit(1);
  }

  if (!fs.existsSync(arquivo)) {
    console.error(`Arquivo não encontrado: ${arquivo}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(arquivo);
  const destino = path.join(__dirname, '..', 'data', 'cclasstrib.json');
  const atual = JSON.parse(fs.readFileSync(destino, 'utf-8'));

  const registros: any[] = [];
  const ignoradas: string[] = [];

  for (const nomeAba of workbook.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json<Linha>(workbook.Sheets[nomeAba]);

    for (const linha of linhas) {
      const codigo = coluna(linha, 'cClassTrib', 'Codigo cClassTrib', 'Classificacao Tributaria');
      if (!/^\d{6}$/.test(codigo)) continue;

      const cstPlanilha = coluna(linha, 'CST-IBS/CBS', 'CST', 'CST IBS CBS');
      // Os três primeiros dígitos do cClassTrib são o próprio CST. Se a planilha
      // trouxer o CST, usamos; senão, derivamos do código.
      const cst = /^\d{3}$/.test(cstPlanilha) ? cstPlanilha : codigo.slice(0, 3);

      if (cstPlanilha && /^\d{3}$/.test(cstPlanilha) && cstPlanilha !== codigo.slice(0, 3)) {
        ignoradas.push(
          `${codigo}: CST da planilha (${cstPlanilha}) difere dos 3 primeiros dígitos`
        );
      }

      registros.push({
        codigo,
        cst,
        descricao: coluna(linha, 'Descricao cClassTrib', 'Descricao', 'Nome cClassTrib'),
        baseLegal: coluna(linha, 'Base Legal', 'Dispositivo', 'Fundamentacao') || 'LC 214/2025',
        nomeReduzido: coluna(linha, 'Nome cClassTrib', 'Nome Reduzido') || undefined,
        inicioVigencia: coluna(linha, 'Inicio Vigencia', 'Data Inicio') || undefined,
        fimVigencia: coluna(linha, 'Fim Vigencia', 'Data Fim') || undefined,
        nfe: coluna(linha, 'NFe', 'NF-e') || undefined,
      });
    }
  }

  if (registros.length === 0) {
    console.error(
      'Nenhum código de 6 dígitos encontrado. Confirme se a planilha é a tabela cClassTrib oficial.'
    );
    console.error('Abas lidas:', workbook.SheetNames.join(', '));
    process.exit(1);
  }

  // Remove duplicatas mantendo o último registro de cada código
  const porCodigo = new Map<string, any>();
  for (const r of registros) porCodigo.set(r.codigo, r);

  atual.cClassTrib = Array.from(porCodigo.values()).sort((a, b) =>
    a.codigo.localeCompare(b.codigo)
  );
  atual.atencao = `Tabela importada de ${path.basename(arquivo)} em ${new Date().toISOString()}`;
  atual.importadoEm = new Date().toISOString();

  fs.writeFileSync(destino, JSON.stringify(atual, null, 2), 'utf-8');

  const porCst = new Map<string, number>();
  for (const r of atual.cClassTrib) {
    porCst.set(r.cst, (porCst.get(r.cst) || 0) + 1);
  }

  console.log(`\n✅ ${atual.cClassTrib.length} códigos importados para ${destino}\n`);
  console.log('Distribuição por CST:');
  for (const [cst, qtd] of Array.from(porCst.entries()).sort()) {
    console.log(`  CST ${cst}: ${qtd} código(s)`);
  }

  if (ignoradas.length > 0) {
    console.warn(`\n⚠️  ${ignoradas.length} inconsistência(s) de vínculo CST:`);
    ignoradas.slice(0, 10).forEach(i => console.warn(`  ${i}`));
  }
}

main();
