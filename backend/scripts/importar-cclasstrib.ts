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

/**
 * Data da planilha em AAAA-MM-DD. A planilha oficial grava as vigências
 * (dIniVig, dFimVig) como número de série do Excel; versões antigas, como
 * texto. Vazio quando não há data.
 */
function dataDaPlanilha(valor: string): string | undefined {
  if (!valor) return undefined;
  if (/^\d+(\.\d+)?$/.test(valor)) {
    const data = XLSX.SSF.parse_date_code(Number(valor));
    if (!data) return undefined;
    const doisDigitos = (n: number) => String(n).padStart(2, '0');
    return `${data.y}-${doisDigitos(data.m)}-${doisDigitos(data.d)}`;
  }
  return valor;
}

/** Indicador 0/1 da planilha */
function indicador(linha: Linha, nome: string): boolean {
  return coluna(linha, nome) === '1';
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
  const csts: any[] = [];
  const ignoradas: string[] = [];
  const gruposAnteriores = new Map<string, string>(
    (atual.cst ?? []).map((c: any) => [c.codigo, c.grupo])
  );

  for (const nomeAba of workbook.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json<Linha>(workbook.Sheets[nomeAba]);
    const cabecalhos = Object.keys(linhas[0] ?? {}).map(normalizar);

    // Aba de CST: tem os indicadores de grupo e não tem a coluna cClassTrib.
    if (cabecalhos.includes('indgibscbs') && !cabecalhos.includes('cclasstrib')) {
      for (const linha of linhas) {
        const codigo = coluna(linha, 'CST-IBS/CBS', 'CST');
        if (!/^\d{3}$/.test(codigo)) continue;
        csts.push({
          codigo,
          descricao: coluna(linha, 'Descricao CST-IBS/CBS', 'Descricao'),
          grupo: gruposAnteriores.get(codigo) ?? 'Tributação Padrão',
          exigeGrupoPadrao: indicador(linha, 'ind_gIBSCBS'),
          exigeMonofasica: indicador(linha, 'ind_gIBSCBSMono'),
          exigeTransfCred: indicador(linha, 'ind_gTransfCred'),
          exigeAjusteCompet: indicador(linha, 'ind_gAjusteCompet'),
        });
      }
      continue;
    }

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
        inicioVigencia: dataDaPlanilha(coluna(linha, 'dIniVig', 'Inicio Vigencia', 'Data Inicio')),
        fimVigencia: dataDaPlanilha(coluna(linha, 'dFimVig', 'Fim Vigencia', 'Data Fim')),
        // indNFe antes: o casamento parcial de "NFe" pegaria indNFeABI.
        nfe: coluna(linha, 'indNFe', 'NFe', 'NF-e') || undefined,
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
  if (csts.length > 0) {
    atual.cst = csts.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  // O nome do arquivo oficial traz o Informe Técnico e a versão:
  // "IT 2025.002 v.1.70 - cClassTrib.xlsx".
  const nomeArquivo = path.basename(arquivo);
  const versao = nomeArquivo.match(/v\.?\s*(\d+\.\d+)/i);
  const informe = nomeArquivo.match(/IT\s*(\d{4}\.\d{3})/i);
  if (versao) atual.versaoTabela = versao[1];
  if (informe) atual.informeTecnico = informe[1];

  atual.atencao = `Tabela importada de ${nomeArquivo} em ${new Date().toISOString()}`;
  atual.importadoEm = new Date().toISOString();

  fs.writeFileSync(destino, JSON.stringify(atual, null, 2), 'utf-8');

  const porCst = new Map<string, number>();
  for (const r of atual.cClassTrib) {
    porCst.set(r.cst, (porCst.get(r.cst) || 0) + 1);
  }

  console.log(
    `\n✅ ${atual.cClassTrib.length} cClassTrib e ${atual.cst.length} CST importados ` +
      `(versão ${atual.versaoTabela ?? 'não identificada'}) para ${destino}\n`
  );
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
