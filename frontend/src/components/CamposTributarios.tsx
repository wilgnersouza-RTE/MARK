import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Check, Minus, ChevronRight, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { formatarMoeda } from '../utils/format';
import { API_URL } from '../utils/api';

interface Campo {
  grupo: 'atual' | 'reforma';
  campo: string;
  situacao: 'preenchido' | 'parcial' | 'ausente';
  valor?: string;
  itens?: { com: number; total: number };
}

interface Nota {
  id: string;
  numero: string;
  modelo: string;
  emitente: string;
  cnpjEmitente: string;
  valor: number;
  preenchidos: number;
  totalCampos: number;
  campos: Campo[];
}

type Filtro = 'todas' | 'incompletas' | 'completas';

export const CamposTributarios: React.FC<{ sessionId: string; token: string }> = ({
  sessionId,
  token,
}) => {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;

    axios
      .get(`${API_URL}/api/v1/dashboard/campos`, {
        headers: { 'x-session-id': sessionId, Authorization: `Bearer ${token}` },
      })
      .then(r => {
        if (ativo) setNotas(r.data.data?.notas ?? []);
      })
      .catch(() => {
        if (ativo) setErro('Não foi possível carregar a conferência de campos.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [sessionId, token]);

  const contagem = useMemo(
    () => ({
      todas: notas.length,
      completas: notas.filter(n => n.preenchidos === n.totalCampos).length,
      incompletas: notas.filter(n => n.preenchidos < n.totalCampos).length,
    }),
    [notas]
  );

  const visiveis = useMemo(() => {
    if (filtro === 'completas') return notas.filter(n => n.preenchidos === n.totalCampos);
    if (filtro === 'incompletas') return notas.filter(n => n.preenchidos < n.totalCampos);
    return notas;
  }, [notas, filtro]);

  if (erro) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {erro}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-tinta-forte">Campos tributários por nota</h3>
        <AjudaIcone
          largura={340}
          tamanho={14}
          conteudo={
            <MemoriaCalculo
              titulo="Conferência de preenchimento"
              descricao="Verifica se a nota traz os campos tributários, e não se o imposto está correto. São duas perguntas diferentes."
              linhas={[
                { rotulo: 'Preenchido', valor: 'campo presente no XML' },
                { rotulo: 'Parcial', valor: 'presente em parte dos itens' },
                { rotulo: 'Ausente', valor: 'campo não informado' },
              ]}
              origem="Em NF-e, os campos da reforma são declarados por produto, e não por nota — daí a situação parcial."
            />
          }
        />
        <span className="text-[11px] text-tinta-suave">
          {notas.length} nota{notas.length === 1 ? '' : 's'} · clique para ver campo a campo
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ['todas', 'Todas', contagem.todas],
            ['incompletas', 'Com campos faltando', contagem.incompletas],
            ['completas', 'Completas', contagem.completas],
          ] as Array<[Filtro, string, number]>
        ).map(([id, rotulo, qtd]) => (
          <button
            key={id}
            onClick={() => setFiltro(id)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              filtro === id
                ? 'bg-marca-azul font-medium text-white'
                : 'border border-fundo-borda text-tinta-media hover:border-marca-azul'
            }`}
          >
            {rotulo} <span className={filtro === id ? 'opacity-75' : 'text-tinta-suave'}>{qtd}</span>
          </button>
        ))}
      </div>

      {carregando ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-tinta-suave">
          <Loader2 size={16} className="animate-spin" />
          Conferindo os campos…
        </p>
      ) : (
        <div className="mt-3">
          <div className="grid grid-cols-[22px_1fr_1.4fr_auto_auto] gap-2 border-b border-fundo-borda pb-2 text-[11px] font-semibold text-tinta-forte">
            <span />
            <span>Nota</span>
            <span>Emitente</span>
            <span className="text-right">Valor</span>
            <span className="text-right">Campos</span>
          </div>

          {visiveis.map(nota => {
            const expandida = aberta === nota.id;
            const completa = nota.preenchidos === nota.totalCampos;

            return (
              <div key={nota.id} className={expandida ? 'bg-fundo-eleva' : ''}>
                <button
                  onClick={() => setAberta(expandida ? null : nota.id)}
                  className="grid w-full grid-cols-[22px_1fr_1.4fr_auto_auto] items-center gap-2 border-b border-fundo-borda py-2 text-left text-xs"
                >
                  {expandida ? (
                    <ChevronDown size={14} className="text-marca-azul" />
                  ) : (
                    <ChevronRight size={14} className="text-tinta-suave" />
                  )}
                  <span className="truncate font-mono text-tinta-forte">{nota.numero}</span>
                  <span className="truncate text-tinta-media">{nota.emitente}</span>
                  <span className="text-right font-mono text-tinta-media">
                    {formatarMoeda(nota.valor)}
                  </span>
                  <span
                    className={`text-right font-mono ${
                      completa ? 'text-tinta-forte' : 'text-amber-700'
                    }`}
                  >
                    {nota.preenchidos} de {nota.totalCampos}
                  </span>
                </button>

                {expandida && (
                  <div className="grid gap-5 border-b border-fundo-borda px-7 pb-4 pt-1 sm:grid-cols-2">
                    <ListaDeCampos
                      titulo="Tributação atual"
                      campos={nota.campos.filter(c => c.grupo === 'atual')}
                    />
                    <ListaDeCampos
                      titulo="Reforma · IBS, CBS e Seletivo"
                      campos={nota.campos.filter(c => c.grupo === 'reforma')}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {visiveis.length === 0 && (
            <p className="py-8 text-center text-sm text-tinta-suave">
              Nenhuma nota neste filtro.
            </p>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-fundo-borda pt-3 text-[11px] leading-snug text-tinta-suave">
        Campo não informado não é necessariamente erro: durante a transição, os grupos de IBS,
        CBS e Imposto Seletivo passam a ser exigidos por cronograma.
      </p>
    </div>
  );
};

/** Coluna de campos de um grupo, com a situação de cada um. */
const ListaDeCampos: React.FC<{ titulo: string; campos: Campo[] }> = ({ titulo, campos }) => (
  <div>
    <p className="mb-2 border-b border-fundo-borda pb-1 text-[11px] font-semibold text-tinta-forte">
      {titulo}
    </p>

    {campos.map(c => (
      <div key={c.campo} className="flex items-baseline justify-between gap-3 py-0.5 text-[11.5px]">
        <span
          className={`flex items-baseline gap-1.5 ${
            c.situacao === 'ausente' ? 'text-tinta-suave' : 'text-tinta-media'
          }`}
        >
          {c.situacao === 'preenchido' && (
            <Check size={13} className="shrink-0 translate-y-0.5 text-emerald-700" />
          )}
          {c.situacao === 'parcial' && (
            <AlertTriangle size={13} className="shrink-0 translate-y-0.5 text-amber-600" />
          )}
          {c.situacao === 'ausente' && (
            <Minus size={13} className="shrink-0 translate-y-0.5 text-tinta-suave" />
          )}
          {c.campo}
        </span>

        <span className="shrink-0 text-right">
          {c.situacao === 'ausente' ? (
            <span className="text-tinta-suave">não informado</span>
          ) : c.situacao === 'parcial' ? (
            <span className="text-amber-700">
              {c.itens?.com} de {c.itens?.total} itens
            </span>
          ) : (
            <span className="font-mono text-tinta-forte">{c.valor ?? 'informado'}</span>
          )}
        </span>
      </div>
    ))}
  </div>
);
