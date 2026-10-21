import * as fs from 'fs';
import * as path from 'path';
import { nfeParserService, ERRO_ESTRUTURA_DESCONHECIDA } from './nfeParser';
import { conferirReforma, tabelaCarregada } from './conferenciaReforma';

const NOTA1 = path.resolve(__dirname, '../../../exemplos/nota1.xml');

const CTE_CARGA = `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte versao="4.00" Id="CTe35260211111111000111570010000000011000000010">
      <ide>
        <mod>57</mod><nCT>1</nCT><dhEmi>2026-02-10T10:00:00-03:00</dhEmi>
        <toma3><toma>3</toma></toma3>
      </ide>
      <emit><CNPJ>11111111000111</CNPJ><xNome>TRANSPORTADORA FICTICIA</xNome><CRT>3</CRT></emit>
      <rem><CNPJ>33333333000133</CNPJ><xNome>REMETENTE FICTICIO</xNome></rem>
      <dest><CNPJ>22222222000122</CNPJ><xNome>DESTINATARIO FICTICIO</xNome></dest>
      <vPrest><vTPrest>500.00</vTPrest><vRec>500.00</vRec></vPrest>
      <imp>
        <ICMS><ICMS00><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS><vICMS>60.00</vICMS></ICMS00></ICMS>
      </imp>
    </infCte>
  </CTe>
</cteProc>`;

const CTE_OS = `<?xml version="1.0" encoding="UTF-8"?>
<cteOSProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTeOS>
    <infCte versao="4.00" Id="CTe35260211111111000111670010000000011000000010">
      <ide><mod>67</mod><nCT>2</nCT><dhEmi>2026-02-11T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>11111111000111</CNPJ><xNome>TRANSPORTADORA FICTICIA</xNome><CRT>3</CRT></emit>
      <toma><CNPJ>44444444000144</CNPJ><xNome>TOMADOR FICTICIO</xNome></toma>
      <vPrest><vTPrest>300.00</vTPrest><vRec>300.00</vRec></vPrest>
      <imp><ICMS><ICMS00><CST>00</CST><vBC>300.00</vBC><pICMS>12.00</pICMS><vICMS>36.00</vICMS></ICMS00></ICMS></imp>
    </infCte>
  </CTeOS>
</cteOSProc>`;

const NFSE = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse>
  <Nfse>
    <InfNfse>
      <NumeroNfse>123</NumeroNfse>
      <DataEmissaoNfse>2026-02-12T10:00:00</DataEmissaoNfse>
      <CpfCnpjPrestador><CNPJ>55555555000155</CNPJ></CpfCnpjPrestador>
      <RazaoSocialPrestador>PRESTADOR FICTICIO</RazaoSocialPrestador>
      <CpfCnpjTomador><CNPJ>11111111000111</CNPJ></CpfCnpjTomador>
      <RazaoSocialTomador>TOMADOR FICTICIO</RazaoSocialTomador>
      <ValorServicos>1000.00</ValorServicos>
      <ValorIss>50.00</ValorIss>
      <BaseCalculo>1000.00</BaseCalculo>
    </InfNfse>
  </Nfse>
</CompNfse>`;

const DESCONHECIDO = `<?xml version="1.0" encoding="UTF-8"?>
<pedidoCompra><numero>1</numero><vNF>100.00</vNF></pedidoCompra>`;

describe('parseNFE: autodetecção do modelo', () => {
  it('lê NF-e modelo 55 sem que o modelo seja informado', async () => {
    const xml = fs.readFileSync(NOTA1, 'utf-8');
    const doc = await nfeParserService.parseNFE(xml);

    expect(doc.modelo).toBe(55);
    expect(doc.tipo).toBe('indefinido');
    expect(doc.cnpjEmitente).toBe('12345678000190');
    expect(doc.cnpjDestino).toBe('99888777000166');
    expect(doc.values.total).toBe(12000);
  });

  it('lê NFC-e pela tag mod 65', async () => {
    const xml = fs.readFileSync(NOTA1, 'utf-8').replace('<mod>55</mod>', '<mod>65</mod>');
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.modelo).toBe(65);
  });

  it('lê CT-e de carga com o tomador no destino', async () => {
    const doc = await nfeParserService.parseNFE(CTE_CARGA);

    expect(doc.modelo).toBe(57);
    expect(doc.tipo).toBe('indefinido');
    expect(doc.cnpjEmitente).toBe('11111111000111');
    expect(doc.cnpjDestino).toBe('22222222000122');
    expect(doc.values.total).toBe(500);
  });

  it('lê CT-e OS', async () => {
    const doc = await nfeParserService.parseNFE(CTE_OS);
    expect(doc.modelo).toBe(67);
    expect(doc.cnpjDestino).toBe('44444444000144');
  });

  it('usa o remetente como tomador quando toma é 0', async () => {
    const xml = CTE_CARGA.replace('<toma>3</toma>', '<toma>0</toma>');
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.cnpjDestino).toBe('33333333000133');
  });

  it('usa o tomador declarado em toma4', async () => {
    const xml = CTE_CARGA.replace(
      '<toma3><toma>3</toma></toma3>',
      '<toma4><toma>4</toma><CNPJ>66666666000166</CNPJ><xNome>OUTRO TOMADOR</xNome></toma4>'
    );
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.cnpjDestino).toBe('66666666000166');
    expect(doc.nomeDestino).toBe('OUTRO TOMADOR');
  });

  it('deduz o modelo pela raiz quando o CT-e não traz mod', async () => {
    const os = await nfeParserService.parseNFE(CTE_OS.replace('<mod>67</mod>', ''));
    const carga = await nfeParserService.parseNFE(CTE_CARGA.replace('<mod>57</mod>', ''));
    expect(os.modelo).toBe(67);
    expect(carga.modelo).toBe(57);
  });

  it('recusa CT-e com mod fora de 57 e 67', async () => {
    const xml = CTE_CARGA.replace('<mod>57</mod>', '<mod>99</mod>');
    await expect(nfeParserService.parseNFE(xml)).rejects.toThrow(ERRO_ESTRUTURA_DESCONHECIDA);
  });

  it('lê NFS-e', async () => {
    const doc = await nfeParserService.parseNFE(NFSE);

    expect(doc.modelo).toBe('NFSE');
    expect(doc.tipo).toBe('indefinido');
    expect(doc.cnpjEmitente).toBe('55555555000155');
    expect(doc.cnpjDestino).toBe('11111111000111');
    expect(doc.values.total).toBe(1000);
  });

  it('recusa XML de estrutura desconhecida com motivo único', async () => {
    await expect(nfeParserService.parseNFE(DESCONHECIDO)).rejects.toThrow(
      ERRO_ESTRUTURA_DESCONHECIDA
    );
  });

  it('recusa NF-e com modelo fora de 55 e 65', async () => {
    const xml = fs.readFileSync(NOTA1, 'utf-8').replace('<mod>55</mod>', '<mod>99</mod>');
    await expect(nfeParserService.parseNFE(xml)).rejects.toThrow(ERRO_ESTRUTURA_DESCONHECIDA);
  });

  it('recusa XML corrompido', async () => {
    await expect(nfeParserService.parseNFE('<nfeProc><NFe>')).rejects.toThrow();
  });
});

describe('parseNFE: CFOP e NCM para os filtros', () => {
  /** nota1 com os itens trocados pelos informados. */
  function nfeComItens(itens: Array<{ cfop?: string; ncm?: string }>): string {
    const det = itens
      .map(
        (item, i) =>
          `<det nItem="${i + 1}"><prod><cProd>${i + 1}</cProd><xProd>ITEM</xProd>` +
          (item.ncm ? `<NCM>${item.ncm}</NCM>` : '') +
          (item.cfop ? `<CFOP>${item.cfop}</CFOP>` : '') +
          '<vProd>10.00</vProd></prod></det>'
      )
      .join('');
    return fs.readFileSync(NOTA1, 'utf-8').replace(/<det [\s\S]*<\/det>/, det);
  }

  it('guarda CFOPs e NCMs distintos dos itens da NF-e', async () => {
    const doc = await nfeParserService.parseNFE(
      nfeComItens([
        { cfop: '5102', ncm: '84713012' },
        { cfop: '5102', ncm: '85171231' },
        { cfop: '5405', ncm: '84713012' },
      ])
    );

    expect(doc.cfops).toEqual(['5102', '5405']);
    expect(doc.ncms).toEqual(['84713012', '85171231']);
  });

  it('deixa as listas vazias quando os itens não trazem os códigos', async () => {
    const doc = await nfeParserService.parseNFE(nfeComItens([{}]));
    expect(doc.cfops).toEqual([]);
    expect(doc.ncms).toEqual([]);
  });

  it('lê o CFOP da operação no CT-e, sem NCM', async () => {
    const xml = CTE_CARGA.replace('<mod>57</mod>', '<CFOP>5353</CFOP><mod>57</mod>');
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.cfops).toEqual(['5353']);
    expect(doc.ncms).toEqual([]);
  });

  it('deixa CFOP e NCM vazios na NFS-e', async () => {
    const doc = await nfeParserService.parseNFE(NFSE);
    expect(doc.cfops).toEqual([]);
    expect(doc.ncms).toEqual([]);
  });
});

describe('parseNFE: pares CST/cClassTrib da reforma e data de emissão', () => {
  function nfeComReforma(itens: Array<{ cst?: string; cClassTrib?: string }>): string {
    const det = itens
      .map(
        (item, i) =>
          `<det nItem="${i + 1}"><prod><cProd>${i + 1}</cProd><xProd>ITEM</xProd><vProd>10.00</vProd></prod>` +
          '<imposto><IBSCBS>' +
          (item.cst ? `<CST>${item.cst}</CST>` : '') +
          (item.cClassTrib ? `<cClassTrib>${item.cClassTrib}</cClassTrib>` : '') +
          '</IBSCBS></imposto></det>'
      )
      .join('');
    return fs.readFileSync(NOTA1, 'utf-8').replace(/<det [\s\S]*<\/det>/, det);
  }

  it('guarda o par de cada item da NF-e', async () => {
    const doc = await nfeParserService.parseNFE(
      nfeComReforma([
        { cst: '000', cClassTrib: '000001' },
        { cst: '200' },
      ])
    );
    expect(doc.reformaItens).toEqual([
      { cst: '000', cClassTrib: '000001' },
      { cst: '200', cClassTrib: undefined },
    ]);
    expect(doc.semDataEmissao).toBe(false);
  });

  it('marca a NF-e sem dhEmi nem dEmi', async () => {
    const xml = fs.readFileSync(NOTA1, 'utf-8').replace(/<dhEmi>[^<]*<\/dhEmi>/, '');
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.semDataEmissao).toBe(true);
  });

  const comData = (tag: string) =>
    fs.readFileSync(NOTA1, 'utf-8').replace(/<dhEmi>[^<]*<\/dhEmi>/, tag);

  it('dEmi 2026-01-01 é do dia 01/01/2026, dentro do período', async () => {
    const doc = await nfeParserService.parseNFE(comData('<dEmi>2026-01-01</dEmi>'));
    expect(doc.semDataEmissao).toBe(false);
    expect(doc.diaEmissao).toBe('2026-01-01');
    expect(conferirReforma(doc, tabelaCarregada()).situacao).not.toBe('fora do período');
  });

  it('dhEmi de 23h30 de 31/12/2025 em -04:00 é fora do período', async () => {
    const doc = await nfeParserService.parseNFE(
      comData('<dhEmi>2025-12-31T23:30:00-04:00</dhEmi>')
    );
    expect(doc.diaEmissao).toBe('2025-12-31');
    expect(conferirReforma(doc, tabelaCarregada()).situacao).toBe('fora do período');
  });

  it('dhEmi malformado deixa a nota sem data em vez de recusá-la', async () => {
    const doc = await nfeParserService.parseNFE(
      comData('<dhEmi>2026-02-30T10:00:00-03:00</dhEmi>')
    );
    expect(doc.semDataEmissao).toBe(true);
    expect(doc.diaEmissao).toBeUndefined();
    expect(conferirReforma(doc, tabelaCarregada()).situacao).toBe('sem data');
  });

  it('guarda o par da nota no CT-e', async () => {
    const xml = CTE_CARGA.replace(
      '</ICMS>',
      '</ICMS><IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></IBSCBS>'
    );
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.reformaItens).toEqual([{ cst: '000', cClassTrib: '000001' }]);
    expect(doc.semDataEmissao).toBe(false);
  });

  it('marca o CT-e sem data', async () => {
    const doc = await nfeParserService.parseNFE(CTE_CARGA.replace(/<dhEmi>[^<]*<\/dhEmi>/, ''));
    expect(doc.semDataEmissao).toBe(true);
  });

  it('na NFS-e prefere o CST do grupo IBSCBS ao de outro tributo', async () => {
    const xml = NFSE.replace(
      '<BaseCalculo>1000.00</BaseCalculo>',
      '<BaseCalculo>1000.00</BaseCalculo>' +
        '<PisCofins><CST>01</CST></PisCofins>' +
        '<IBSCBS><CST>200</CST><cClassTrib>200002</cClassTrib></IBSCBS>'
    );
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.reformaItens).toEqual([{ cst: '200', cClassTrib: '200002' }]);
    expect(doc.camposTributarios?.find(c => c.grupo === 'reforma' && c.campo === 'CST')?.valor).toBe('200');
  });

  it('marca a NFS-e sem data', async () => {
    const doc = await nfeParserService.parseNFE(NFSE.replace(/<DataEmissaoNfse>[^<]*<\/DataEmissaoNfse>/, ''));
    expect(doc.semDataEmissao).toBe(true);
    expect(doc.reformaItens).toEqual([{ cst: undefined, cClassTrib: undefined }]);
  });
});

describe('parseNFE: casos de revisão da reforma', () => {
  it('lê CST e cClassTrib do CT-e aninhados em IBSCBS > gIBSCBS', async () => {
    const xml = CTE_CARGA.replace(
      '</ICMS>',
      '</ICMS><IBSCBS><gIBSCBS><CST>200</CST><cClassTrib>200002</cClassTrib>' +
        '<vBC>500.00</vBC></gIBSCBS></IBSCBS>'
    );
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.reformaItens).toEqual([{ cst: '200', cClassTrib: '200002' }]);
  });

  it('NFS-e com CST de PIS/COFINS e sem grupo IBSCBS fica sem CST do IBS/CBS', async () => {
    const xml = NFSE.replace(
      '<BaseCalculo>1000.00</BaseCalculo>',
      '<BaseCalculo>1000.00</BaseCalculo><PisCofins><CST>01</CST></PisCofins>'
    );
    const doc = await nfeParserService.parseNFE(xml);
    expect(doc.reformaItens).toEqual([{ cst: undefined, cClassTrib: undefined }]);
    expect(
      doc.camposTributarios?.find(c => c.grupo === 'reforma' && c.campo === 'CST')?.situacao
    ).toBe('ausente');
  });

  it('NFS-e com 31/02/2026 fica sem data', async () => {
    const doc = await nfeParserService.parseNFE(
      NFSE.replace('2026-02-12T10:00:00', '31/02/2026')
    );
    expect(doc.semDataEmissao).toBe(true);
    expect(conferirReforma(doc, tabelaCarregada()).situacao).toBe('sem data');
  });

  it('NFS-e não usa dhProc como data de emissão', async () => {
    const doc = await nfeParserService.parseNFE(
      NFSE.replace(
        '<DataEmissaoNfse>2026-02-12T10:00:00</DataEmissaoNfse>',
        '<dhProc>2026-02-12T10:00:00</dhProc>'
      )
    );
    expect(doc.semDataEmissao).toBe(true);
  });

  it('NFS-e guarda o dia local da emissão', async () => {
    const doc = await nfeParserService.parseNFE(NFSE);
    expect(doc.diaEmissao).toBe('2026-02-12');
  });
});
