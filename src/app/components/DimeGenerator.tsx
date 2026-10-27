import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Printer, X, AlertTriangle, Info, FileCode } from "lucide-react";
import { parseSped, parseBrNum, formatBrl, validarData } from "./SpedParser";
import type { ParsedSped, SpedRecord } from "./SpedParser";

// ── E110 field positions ─────────────────────────────────────────────────────
// |E110|VL_TOT_DÉBITOS|VL_AJ_DÉBITOS|VL_TOT_AJ_DÉBITOS|VL_ESTORNOS_CRED|
//       VL_TOT_CRÉDITOS|VL_AJ_CRÉDITOS|VL_TOT_AJ_CRÉDITOS|VL_ESTORNOS_DÉB|
//       VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|VL_SLD_CREDOR_TRANSP|DEB_ESP
const E110 = {
  TOT_DEB:1, AJ_DEB:2, TOT_AJ_DEB:3, EST_CRED:4,
  TOT_CRED:5, AJ_CRED:6, TOT_AJ_CRED:7, EST_DEB:8,
  SLD_CRED_ANT:9, SLD_APURADO:10, TOT_DED:11,
  RECOLHER:12, SLD_CRED_TRANSP:13, DEB_ESP:14,
};

// ── E200 field positions (ICMS-ST por UF) ────────────────────────────────────
// |E200|UF|DT_ED_INI|DT_ED_FIN|
const E200 = { UF:1, DT_INI:2, DT_FIN:3 };

// ── E210 field positions ──────────────────────────────────────────────────────
// |E210|IND_MOV_ST|VL_SLD_CRED_ANT_ST|VL_DEVOL_ST|VL_RESSARC_ST|VL_OUT_CRED_ST|
//       VL_AJ_CRED_ST|VL_TOT_CRED_ST|VL_RETENC_ST|VL_OUT_DEB_ST|VL_AJ_DEB_ST|
//       VL_TOT_DEB_ST|VL_SLD_DEV_ANT_ST|VL_DEDUCOES_ST|VL_ICMS_RECOL_ST|VL_SLD_CRED_ST
const E210 = { IND_MOV:1, SLD_CRED_ANT:2, DEVOL:3, RESSARC:4, OUT_CRED:5,
               AJ_CRED:6, TOT_CRED:7, RETENC:8, OUT_DEB:9, AJ_DEB:10,
               TOT_DEB:11, SLD_DEV_ANT:12, DED:13, RECOL:14, SLD_CRED:15 };

// ── E116 field positions (obrigações do ICMS a recolher) ────────────────────
// |E116|COD_OR|VL_OR|DT_VCTO|COD_REC|NUM_PROC|IND_PROC|PROC|TXT_COMPL|MES_REF|
const E116 = { COD_OR:1, VALOR:2, VENCIMENTO:3, COD_RECEITA:4 };

// |E111|COD_AJ_APUR|DESCR_COMPL_AJ|VL_AJ_APUR|
// |E112|NUM_DA|NUM_PROC|IND_PROC|PROC|TXT_COMPL|
const E111 = { DESCRICAO:2 };

// ── C190 field positions ─────────────────────────────────────────────────────
// |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|
const C190 = { CST:1, CFOP:2, ALIQ:3, VL_OPR:4, VL_BC:5, VL_ICMS:6, VL_BC_ST:7, VL_ST:8, VL_RED_BC:9 };

// ── 0150/C100: participante e documento fiscal ──────────────────────────────
// |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|...|
// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|...|
const R0150 = { COD_PART:1, COD_PAIS:3, IE:6, COD_MUN:7 };
const C100 = { IND_OPER:1, COD_PART:3 };

const REG80_ITEMS = [
  { item: "010", label: "Estoque no início do exercício" },
  { item: "020", label: "Estoque no fim do exercício" },
  { item: "030", label: "Receita bruta de vendas e serviços" },
] as const;

const REG81_ITEMS = [
  { item: "110", label: "Circulante" },
  { item: "111", label: "Disponibilidades" },
  { item: "113", label: "Contas a receber do circulante" },
  { item: "121", label: "Estoque de mercadorias e matéria-prima" },
  { item: "123", label: "Outros estoques" },
  { item: "128", label: "Outras contas do ativo circulante" },
  { item: "130", label: "Realizável a longo prazo" },
  { item: "131", label: "Contas a receber do realizável" },
  { item: "148", label: "Outras contas do realizável" },
  { item: "150", label: "Permanente" },
  { item: "151", label: "Investimentos" },
  { item: "155", label: "Imobilizado líquido" },
  { item: "157", label: "Diferido líquido" },
  { item: "159", label: "Intangível" },
  { item: "199", label: "Total geral do ativo" },
] as const;

const REG82_ITEMS = [
  { item: "210", label: "Circulante" },
  { item: "211", label: "Fornecedores" },
  { item: "213", label: "Empréstimos e financiamentos" },
  { item: "215", label: "Outras contas do passivo circulante" },
  { item: "230", label: "Exigível a longo prazo" },
  { item: "240", label: "Resultados de exercícios futuros" },
  { item: "269", label: "Passivo a descoberto" },
  { item: "270", label: "Patrimônio líquido" },
  { item: "271", label: "Capital social" },
  { item: "278", label: "Outras contas do patrimônio líquido" },
  { item: "279", label: "Outras contas do patrimônio líquido (valor negativo)" },
  { item: "299", label: "Total geral do passivo" },
] as const;

const REG83_ITEMS = [
  { item: "310", label: "Receita bruta de vendas e serviços" },
  { item: "311", label: "Deduções da receita bruta" },
  { item: "320", label: "Receita líquida de vendas e serviços" },
  { item: "323", label: "Custo das mercadorias, produtos ou serviços" },
  { item: "330", label: "Lucro bruto" },
  { item: "331", label: "Prejuízo bruto" },
  { item: "333", label: "Outras receitas operacionais" },
  { item: "335", label: "Despesas operacionais" },
  { item: "340", label: "Lucro operacional" },
  { item: "341", label: "Prejuízo operacional" },
  { item: "343", label: "Receitas não operacionais" },
  { item: "345", label: "Despesas não operacionais" },
  { item: "350", label: "Resultado antes do IR e contribuição social" },
  { item: "351", label: "Resultado negativo antes do IR e contribuição social" },
  { item: "353", label: "Provisão para IR e contribuição social" },
  { item: "354", label: "Reversão da provisão para IR e contribuição social" },
  { item: "360", label: "Resultado após IR e contribuição social" },
  { item: "361", label: "Resultado negativo após IR e contribuição social" },
  { item: "363", label: "Participações e contribuições" },
  { item: "398", label: "Prejuízo do exercício" },
  { item: "399", label: "Lucro do exercício" },
] as const;

const REG84_ITEMS = [
  { item: "411", label: "Pró-labore" },
  { item: "412", label: "Comissões, salários e ordenados" },
  { item: "421", label: "Encargos sociais" },
  { item: "422", label: "Tributos federais" },
  { item: "423", label: "Tributos estaduais" },
  { item: "424", label: "Tributos municipais" },
  { item: "431", label: "Combustíveis e lubrificantes" },
  { item: "432", label: "Água e telefone" },
  { item: "433", label: "Energia elétrica" },
  { item: "441", label: "Aluguéis" },
  { item: "442", label: "Seguros" },
  { item: "443", label: "Fretes e carretos" },
  { item: "451", label: "Serviços profissionais" },
  { item: "461", label: "Despesas financeiras" },
  { item: "498", label: "Outras despesas" },
] as const;

const REG85_INPUT_ITEMS = [
  { item: "501", label: "Valor do IRPJ devido no exercício anterior" },
  { item: "511", label: "Contribuição ao FIA por DARE para o Fundo Estadual" },
  { item: "512", label: "Transferência ou contribuição ao FIA para Fundos Municipais" },
  { item: "521", label: "Contribuição ao FEI por DARE para o Fundo Estadual" },
  { item: "522", label: "Transferência ou contribuição ao FEI para Fundos Municipais" },
] as const;

const emptyValues = (items: ReadonlyArray<{ item: string }>) =>
  Object.fromEntries(items.map(({ item }) => [item, ""])) as Record<string, string>;

const UF_BY_IBGE_PREFIX: Record<string, string> = {
  "11":"RO", "12":"AC", "13":"AM", "14":"RR", "15":"PA", "16":"AP",
  "17":"TO", "21":"MA", "22":"PI", "23":"CE", "24":"RN", "25":"PB",
  "26":"PE", "27":"AL", "28":"SE", "29":"BA", "31":"MG", "32":"ES",
  "33":"RJ", "35":"SP", "41":"PR", "42":"SC", "43":"RS", "50":"MS",
  "51":"MT", "52":"GO", "53":"DF",
};

function f(r: SpedRecord, idx: number): string {
  return (r.fields[idx] ?? "").trim();
}

// ── CFOP groupings for DIME Quadro 05 ────────────────────────────────────────
// CFOP → group label
function cfopGrupo(cfop: string): string {
  const n = parseInt(cfop);
  if (n >= 5100 && n <= 5199) return "Vendas de produção/comércio — mesma UF";
  if (n >= 5200 && n <= 5299) return "Transferências de produção/comércio — mesma UF";
  if (n >= 5300 && n <= 5399) return "Devoluções de compras — mesma UF";
  if (n >= 5400 && n <= 5499) return "Vendas com ST — mesma UF";
  if (n >= 5500 && n <= 5599) return "Remessas para uso/consumo/ativo — mesma UF";
  if (n >= 5600 && n <= 5699) return "Créditos e ressarcimentos — mesma UF";
  if (n >= 5900 && n <= 5999) return "Outras saídas — mesma UF";
  if (n >= 6100 && n <= 6199) return "Vendas de produção/comércio — outras UFs";
  if (n >= 6200 && n <= 6299) return "Transferências de produção/comércio — outras UFs";
  if (n >= 6300 && n <= 6399) return "Devoluções de compras — outras UFs";
  if (n >= 6400 && n <= 6499) return "Vendas com ST — outras UFs";
  if (n >= 6900 && n <= 6999) return "Outras saídas — outras UFs";
  if (n >= 7100 && n <= 7999) return "Exportações";
  if (n >= 1100 && n <= 1199) return "Compras para industrialização/comercialização — mesma UF";
  if (n >= 1200 && n <= 1299) return "Transferências para industrialização/comercialização — mesma UF";
  if (n >= 1300 && n <= 1399) return "Devoluções de vendas — mesma UF";
  if (n >= 1400 && n <= 1499) return "Compras com ST — mesma UF";
  if (n >= 1500 && n <= 1599) return "Entradas p/ uso/consumo/ativo — mesma UF";
  if (n >= 1900 && n <= 1999) return "Outras entradas — mesma UF";
  if (n >= 2100 && n <= 2199) return "Compras para industrialização/comercialização — outras UFs";
  if (n >= 2400 && n <= 2499) return "Compras com ST — outras UFs";
  if (n >= 2900 && n <= 2999) return "Outras entradas — outras UFs";
  if (n >= 3100 && n <= 3999) return "Importações";
  return `CFOP ${cfop}`;
}

interface C190Group {
  grupo: string;
  cfops: string[];
  vlOpr: number;
  vlBcIcms: number;
  vlIcms: number;
  vlBcSt: number;
  vlSt: number;
}

interface DimeData {
  // Quadro 04/05/09 — ICMS Próprio (direto do E110)
  q02: {
    debSaidas: number; ajDeb: number; estCred: number; totDeb: number;
    credEntradas: number; ajCred: number; estDeb: number; sldCredAnt: number; totCred: number;
    sldApurado: number; deducoes: number; icmsRecolher: number; sldCredTransp: number; debEsp: number;
  };
  // Quadro 11 — ICMS-ST por UF
  q03: Array<{ uf: string; recol: number; sldCred: number; totCred: number; totDeb: number }>;
  // Quadros 01/02 — Movimento econômico por CFOP
  q05: C190Group[];
  // Metadata
  empresa: string;
  cnpj: string;
  ie: string;
  uf: string;
  periodoIni: string;
  periodoFin: string;
  contNome0100: string;
  contCPF0100: string;
  pagamentoIcms?: {
    codigoReceita: string;
    valor: number;
    vencimento: string;
  };
  autorizacaoDcip: string;
}

function extractDimeData(parsed: ParsedSped): DimeData | null {
  const hdr = parsed.header;
  if (!hdr) return null;

  const empresa    = hdr.fields[5] ?? "";
  const cnpj       = hdr.fields[6] ?? hdr.fields[7] ?? "";
  const uf         = hdr.fields[8] ?? "";
  const ie         = hdr.fields[9] ?? "";
  const periodoIni = hdr.fields[3] ?? "";
  const periodoFin = hdr.fields[4] ?? "";

  // E110 — ICMS próprio (pega o primeiro registro E110 do bloco E100)
  const e110recs = parsed.byReg.get("E110") ?? [];
  const e110 = e110recs[0];
  const q02 = e110 ? (() => {
    const debSaidas = parseBrNum(f(e110, E110.TOT_DEB));
    const ajDeb =
      parseBrNum(f(e110, E110.AJ_DEB)) +
      parseBrNum(f(e110, E110.TOT_AJ_DEB));
    const estCred = parseBrNum(f(e110, E110.EST_CRED));
    const credEntradas = parseBrNum(f(e110, E110.TOT_CRED));
    const ajCred =
      parseBrNum(f(e110, E110.AJ_CRED)) +
      parseBrNum(f(e110, E110.TOT_AJ_CRED));
    const estDeb = parseBrNum(f(e110, E110.EST_DEB));
    const sldCredAnt = parseBrNum(f(e110, E110.SLD_CRED_ANT));

    return {
      debSaidas,
      ajDeb,
      estCred,
      totDeb: debSaidas + ajDeb + estCred,
      credEntradas,
      ajCred,
      estDeb,
      sldCredAnt,
      totCred: credEntradas + ajCred + estDeb + sldCredAnt,
      sldApurado: parseBrNum(f(e110, E110.SLD_APURADO)),
      deducoes: parseBrNum(f(e110, E110.TOT_DED)),
      icmsRecolher: parseBrNum(f(e110, E110.RECOLHER)),
      sldCredTransp: parseBrNum(f(e110, E110.SLD_CRED_TRANSP)),
      debEsp: parseBrNum(f(e110, E110.DEB_ESP)),
    };
  })() : {
    debSaidas:0, ajDeb:0, estCred:0, totDeb:0, credEntradas:0, ajCred:0,
    estDeb:0, sldCredAnt:0, totCred:0, sldApurado:0, deducoes:0, icmsRecolher:0, sldCredTransp:0, debEsp:0
  };

  // E200/E210 — ICMS-ST por UF
  const q03: DimeData["q03"] = [];
  const e200recs = parsed.byReg.get("E200") ?? [];
  for (const e2 of e200recs) {
    const ufSt = f(e2, E200.UF);
    // E210 imediatamente após E200 (simplification: find E210 after this E200)
    const idx = parsed.records.findIndex(r => r.lineNumber === e2.lineNumber);
    const e210Rec = parsed.records.slice(idx+1).find(r => r.reg === "E210");
    if (e210Rec) {
      q03.push({
        uf: ufSt,
        recol: parseBrNum(f(e210Rec, E210.RECOL)),
        sldCred: parseBrNum(f(e210Rec, E210.SLD_CRED)),
        totCred: parseBrNum(f(e210Rec, E210.TOT_CRED)),
        totDeb: parseBrNum(f(e210Rec, E210.TOT_DEB)),
      });
    }
  }

  // C190 — movimento econômico agrupado por CFOP
  const grupoMap = new Map<string, C190Group>();
  for (const r of parsed.byReg.get("C190") ?? []) {
    const cfop = f(r, C190.CFOP);
    const grupo = cfopGrupo(cfop);
    const key = grupo;
    if (!grupoMap.has(key)) {
      grupoMap.set(key, { grupo, cfops: [], vlOpr:0, vlBcIcms:0, vlIcms:0, vlBcSt:0, vlSt:0 });
    }
    const g = grupoMap.get(key)!;
    if (!g.cfops.includes(cfop)) g.cfops.push(cfop);
    g.vlOpr    += parseBrNum(f(r, C190.VL_OPR));
    g.vlBcIcms += parseBrNum(f(r, C190.VL_BC));
    g.vlIcms   += parseBrNum(f(r, C190.VL_ICMS));
    g.vlBcSt   += parseBrNum(f(r, C190.VL_BC_ST));
    g.vlSt     += parseBrNum(f(r, C190.VL_ST));
  }
  const q05 = Array.from(grupoMap.values()).sort((a,b) => b.vlOpr - a.vlOpr);

  // Reg 0100 — Dados do contabilista
  // EFD ICMS/IPI: |0100|NOME|CPF|CRC|CNPJ|CEP|END|NUM|COMPL|BAIRRO|FONE|FAX|EMAIL|COD_MUN|
  const r0100 = (parsed.byReg.get("0100") ?? [])[0];
  let contNome0100 = "";
  let contCPF0100  = "";
  if (r0100) {
    contNome0100 = f(r0100, 1);
    contCPF0100 = f(r0100, 2).replace(/\D/g, "");

    // Compatibilidade com arquivos não padronizados: procura o CPF sem usar
    // campos de telefone, endereço ou e-mail como nome do contabilista.
    if (contCPF0100.length !== 11) {
      const cpfField = r0100.fields
        .slice(1)
        .map(value => value.replace(/\D/g, ""))
        .find(value => value.length === 11);
      contCPF0100 = cpfField ?? "";
    }
  }

  const e116recs = parsed.byReg.get("E116") ?? [];
  const pagamentoNormal =
    e116recs.find(record => f(record, E116.COD_RECEITA) === "1449") ??
    e116recs.find(record => parseBrNum(f(record, E116.VALOR)) > 0);
  const pagamentoIcms = pagamentoNormal
    ? {
        codigoReceita: f(pagamentoNormal, E116.COD_RECEITA) || "1449",
        valor: parseBrNum(f(pagamentoNormal, E116.VALOR)),
        vencimento: f(pagamentoNormal, E116.VENCIMENTO),
      }
    : undefined;

  const camposAjustes = [
    ...(parsed.byReg.get("E111") ?? []).flatMap(record => [
      f(record, E111.DESCRICAO),
      ...record.fields.slice(1),
    ]),
    ...(parsed.byReg.get("E112") ?? []).flatMap(record =>
      record.fields.slice(1)
    ),
  ];
  const autorizacaoDcip =
    camposAjustes
      .map(value => value.match(/(?:^|\D)(\d{15})(?:\D|$)/)?.[1] ?? "")
      .find(value => value !== "") ?? "";

  return {
    q02,
    q03,
    q05,
    empresa,
    cnpj,
    ie,
    uf,
    periodoIni,
    periodoFin,
    contNome0100,
    contCPF0100,
    pagamentoIcms,
    autorizacaoDcip,
  };
}

function formatPeriodo(data: string): string {
  if (!validarData(data)) return data;
  const m = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${m[+data.slice(2,4)-1]}/${data.slice(4)}`;
}

function formatCNPJ(cnpj: string): string {
  const c = cnpj.replace(/\D/g,"");
  if (c.length !== 14) return cnpj;
  return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
}

function defaultDueDate(periodoFin: string): string {
  if (!validarData(periodoFin)) return "";
  const month = Number(periodoFin.slice(2, 4));
  const year = Number(periodoFin.slice(4, 8));
  const due = new Date(year, month, 10);
  return [
    String(due.getDate()).padStart(2, "0"),
    String(due.getMonth() + 1).padStart(2, "0"),
    due.getFullYear(),
  ].join("");
}

// ── Quadro row ────────────────────────────────────────────────────────────────
function QRow({ num, label, value, bold, highlight }: {
  num: string; label: string; value: number;
  bold?: boolean; highlight?: "devedor" | "credor" | "neutral";
}) {
  const hl =
    highlight === "devedor" ? "bg-red-50 text-red-800" :
    highlight === "credor"  ? "bg-emerald-50 text-emerald-800" :
    highlight === "neutral" ? "bg-blue-50 text-blue-800" : "";
  return (
    <div className={`grid grid-cols-[3rem_1fr_auto] items-center gap-2 px-3 py-1.5 text-sm border-b border-gray-100 last:border-0 ${hl}`}>
      <span className={`font-mono text-xs text-gray-400 ${bold ? "font-bold text-gray-600" : ""}`}>{num}</span>
      <span className={`${bold ? "font-bold text-gray-800" : "text-gray-700"}`}>{label}</span>
      <span className={`font-mono tabular-nums ${bold ? "font-bold" : ""} ${value < 0 ? "text-red-700" : ""}`}>
        R$ {formatBrl(Math.abs(value))}
      </span>
    </div>
  );
}

function ManualRecordPanel({
  title,
  subtitle,
  note,
  items,
  values,
  included,
  onToggle,
  onChange,
}: {
  title: string;
  subtitle: string;
  note: string;
  items: ReadonlyArray<{ item: string; label: string }>;
  values: Record<string, string>;
  included: boolean;
  onToggle: () => void;
  onChange: (item: string, value: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-orange-50 px-3 py-2">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-orange-800">
            {title}
          </p>
          <p className="mt-0.5 text-[10px] text-orange-700">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
            included
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-gray-300 bg-white text-gray-600"
          }`}
        >
          {included ? "Incluído no TXT" : "Não incluir no TXT"}
        </button>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          {note}
        </div>
        {items.map(({ item, label }) => (
          <label
            key={item}
            className="grid items-center gap-2 sm:grid-cols-[4rem_1fr_12rem]"
          >
            <span className="font-mono text-xs font-bold text-orange-700">
              {item}
            </span>
            <span className="text-sm text-gray-700">{label}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={values[item]}
              onChange={event => onChange(item, event.target.value)}
              placeholder="0,00"
              className="rounded-lg border border-gray-300 px-3 py-2 text-right font-mono text-sm focus:border-orange-500 focus:outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function DimeGenerator() {
  const [parsed, setParsed] = useState<ParsedSped | null>(null);
  const [dime, setDime] = useState<DimeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [encoding, setEncoding] = useState<"UTF-8" | "ISO-8859-1">("UTF-8");
  const [activeTab, setActiveTab] = useState<
    "q02" | "q03" | "q05" | "q80" | "q81" | "q82" | "q83" | "q84" | "q85"
  >("q02");
  // Dados do contabilista para Reg 20 do arquivo DIME
  const [contCPF, setContCPF] = useState("");
  const [contNome, setContNome] = useState("");
  const [codigoReceita, setCodigoReceita] = useState("1449");
  const [classeVencimento, setClasseVencimento] = useState("10014");
  const [dataVencimento, setDataVencimento] = useState("");
  const [autorizacaoDcip, setAutorizacaoDcip] = useState("");
  const [includeReg80, setIncludeReg80] = useState(false);
  const [includeReg81, setIncludeReg81] = useState(false);
  const [includeReg82, setIncludeReg82] = useState(false);
  const [includeReg83, setIncludeReg83] = useState(false);
  const [includeReg84, setIncludeReg84] = useState(false);
  const [includeReg85, setIncludeReg85] = useState(false);
  const [reg80Values, setReg80Values] = useState<Record<string, string>>(
    () => emptyValues(REG80_ITEMS),
  );
  const [reg84Values, setReg84Values] = useState<Record<string, string>>(
    () => emptyValues(REG84_ITEMS),
  );
  const [reg81Values, setReg81Values] = useState<Record<string, string>>(
    () => emptyValues(REG81_ITEMS),
  );
  const [reg82Values, setReg82Values] = useState<Record<string, string>>(
    () => emptyValues(REG82_ITEMS),
  );
  const [reg83Values, setReg83Values] = useState<Record<string, string>>(
    () => emptyValues(REG83_ITEMS),
  );
  const [reg85Values, setReg85Values] = useState<Record<string, string>>(
    () => emptyValues(REG85_INPUT_ITEMS),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (file.size > 100 * 1024 * 1024) { alert("Arquivo maior que 100 MB."); return; }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const p = parseSped(content);
      const d = extractDimeData(p);
      setParsed(p);
      setDime(d);
      setContNome(d?.contNome0100 ?? "");
      setContCPF(d?.contCPF0100 ?? "");
      setCodigoReceita(d?.pagamentoIcms?.codigoReceita || "1449");
      setClasseVencimento("10014");
      setDataVencimento(
        d?.pagamentoIcms?.vencimento || defaultDueDate(d?.periodoFin ?? ""),
      );
      setAutorizacaoDcip(d?.autorizacaoDcip ?? "");
      setIncludeReg80(false);
      setIncludeReg81(false);
      setIncludeReg82(false);
      setIncludeReg83(false);
      setIncludeReg84(false);
      setIncludeReg85(false);
      setReg80Values(emptyValues(REG80_ITEMS));
      setReg81Values(emptyValues(REG81_ITEMS));
      setReg82Values(emptyValues(REG82_ITEMS));
      setReg83Values(emptyValues(REG83_ITEMS));
      setReg84Values(emptyValues(REG84_ITEMS));
      setReg85Values(emptyValues(REG85_INPUT_ITEMS));
      setLoading(false);
    };
    reader.readAsText(file, encoding);
  }, [encoding]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0]; if (file) processFile(file);
  };

  const handlePrint = () => window.print();

  // ── Gerador do arquivo magnético oficial DIME-SC ─────────────────────────────
  // Leiaute fixo por posição conforme Portaria SEF nº 153/2012 – Anexo II
  // Convenções: N=numérico zeros à esq | C=alfanum. espaços à dir | $=valor 17 dígitos (centavos)
  const handleExportDime = () => {
    if (!dime || !parsed) return;

    // Helpers de formatação
    const pN  = (v: number | string, w: number) =>
      Math.round(Math.abs(Number(v))).toString().padStart(w, "0").slice(-w);
    const ascii = (v: string) =>
      v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ");
    const pC  = (v: string, w: number) => ascii(v).toUpperCase().slice(0, w).padEnd(w, " ");
    // $ = 17 dígitos, valor em centavos (2 casas implícitas)
    const pMoney = (v: number) =>
      Math.round(Math.abs(v) * 100).toString().padStart(17, "0");

    // Competência: periodoIni vem como DDMMAAAA do SPED → MMAAAA para DIME
    const pi  = dime.periodoIni;
    const comp = pi.length >= 8 ? pi.slice(2, 8) : pi.padEnd(6, "0"); // MMAAAA

    // IE: dígitos apenas, 9 posições
    const ie9  = dime.ie.replace(/\D/g, "").padStart(9, "0").slice(-9);

    const lines: string[] = [];
    let declRegs = 0; // registros dentro desta declaração (de 21 até 98, inclusive)

    const add = (line: string) => { lines.push(line); declRegs++; };

    // ── Reg 20: Dados do Contabilista ─────────────────────────────────────────
    // Campos: tipo(2N) quadro(2C=brancos) CPF(11N) nome(50C) datahora(14N AAAAMMDDHHMMSS)
    const now = new Date();
    const dthr = [
      now.getFullYear(), pN(now.getMonth()+1,2), pN(now.getDate(),2),
      pN(now.getHours(),2), pN(now.getMinutes(),2), pN(now.getSeconds(),2),
    ].join("");
    const cpfDigits = contCPF.replace(/\D/g, "");
    if (cpfDigits.length !== 11) {
      alert("Informe os 11 dígitos do CPF do contabilista para gerar o arquivo DIME.");
      return;
    }
    const cpf11 = cpfDigits;
    const nomeContab = contNome.trim() || "NAO INFORMADO";
    lines.push(
      "20" + "  " + cpf11 +
      pC(nomeContab, 50) + dthr
    );
    // Reg 20 NÃO conta para declRegs (é do contabilista, não da declaração)

    // ── Reg 21: Início da Declaração ──────────────────────────────────────────
    // Campos: tipo(2N) quadro(2N=00) inscrição(9N) nome(50C) período(6N=MMAAAA)
    //         tipodecl(1N) regime(1N) porte(1N) consolidada(1N) centralizada(1N)
    //         transferCredito(1N) credPresumido(1N) credIncentivo(1N)
    //         movimento(1N) substituto(1N) escritaContabil(1N) trabalhadores(5N)
    add(
      "21" + "00" +
      ie9 +
      pC(dime.empresa, 50) +
      comp +
      "1" +   // tipo declaração: 1=Normal
      "2" +   // regime: 2=Normal
      "1" +   // porte: 1=Não se aplica
      "1" +   // consolidada: 1=Não é apuração consolidada
      "1" +   // centralizada: 1=Não se aplica
      "1" +   // transferência de créditos: 1=Não transferiu nem recebeu
      "1" +   // créditos presumidos: 1=Não se aplica
      "1" +   // créditos por incentivos fiscais: 1=Não se aplica
      (dime.q05.length > 0 || dime.q02.totDeb > 0 ? "3" : "1") + // movimento
      (dime.q03.length > 0 ? "1" : "2") + // substituto tributário
      "2" +   // escrita contábil: 2=Não
      pN(0, 5) // trabalhadores
    );

    // ── Regs 22/23: Quadros 01/02 — Valores Fiscais por CFOP ─────────────────
    // Formato (145 posições): tipo, quadro, CFOP e 8 campos monetários.
    // Agrupa os registros analíticos dos blocos C e D por CFOP, separando
    // entradas (1/2/3xxx) de saídas (5/6/7xxx).
    type CfopValues = {
      vlOpr:number; vlBc:number; vlImp:number; vlIsen:number; vlOut:number;
      vlBcSt:number; vlSt:number; vlDifal:number;
    };
    const mapE = new Map<string, CfopValues>();
    const mapS = new Map<string, CfopValues>();

    type ParticipantInfo = { uf: string; contribuinte: boolean };
    type C190Context = {
      record: SpedRecord;
      uf: string;
      contribuinte: boolean;
      indOper: string;
      hasSt: boolean;
    };

    const participantes = new Map<string, ParticipantInfo>();
    for (const record of parsed.byReg.get("0150") ?? []) {
      const codPais = f(record, R0150.COD_PAIS);
      const codMun = f(record, R0150.COD_MUN).replace(/\D/g, "");
      const uf =
        codPais && codPais !== "1058"
          ? "EX"
          : UF_BY_IBGE_PREFIX[codMun.slice(0, 2)] ?? "";
      participantes.set(f(record, R0150.COD_PART), {
        uf,
        contribuinte:
          f(record, R0150.IE) !== "" &&
          f(record, R0150.IE).toUpperCase() !== "ISENTO",
      });
    }

    const fiscalContexts: C190Context[] = [];
    let currentDocument:
      | { codPart: string; indOper: string }
      | undefined;
    const documentRegs = new Set(["C100", "C500", "D100", "D500"]);
    const analyticalRegs = new Map([
      ["C190", true],
      ["C590", true],
      ["D190", false],
      ["D590", false],
    ]);
    for (const record of parsed.records) {
      if (documentRegs.has(record.reg)) {
        currentDocument = {
          codPart: f(record, C100.COD_PART),
          indOper: f(record, C100.IND_OPER),
        };
        continue;
      }
      const hasSt = analyticalRegs.get(record.reg);
      if (hasSt === undefined) continue;

      const cfop = f(record, C190.CFOP);
      const participant = currentDocument
        ? participantes.get(currentDocument.codPart)
        : undefined;
      const firstDigit = cfop.charAt(0);
      const uf =
        ["3", "7"].includes(firstDigit)
          ? "EX"
          : participant?.uf ||
            (["1", "5"].includes(firstDigit) ? dime.uf.toUpperCase() : "");

      fiscalContexts.push({
        record,
        uf,
        contribuinte: participant?.contribuinte ?? false,
        indOper: currentDocument?.indOper ?? "",
        hasSt,
      });
    }

    for (const { record: r, hasSt } of fiscalContexts) {
      const cfop  = f(r, C190.CFOP).trim();
      const vlOpr = parseBrNum(f(r, C190.VL_OPR));
      const vlBc  = parseBrNum(f(r, C190.VL_BC));
      const vlImp = parseBrNum(f(r, C190.VL_ICMS));
      const vlBcSt = hasSt ? parseBrNum(f(r, C190.VL_BC_ST)) : 0;
      const vlSt = hasSt ? parseBrNum(f(r, C190.VL_ST)) : 0;
      const cst = f(r, C190.CST).padStart(2, "0").slice(-2);
      const semTributacao = Math.max(0, vlOpr - vlBc);
      const vlIsen = ["40", "41"].includes(cst) ? semTributacao : 0;
      const vlOut  = ["40", "41"].includes(cst) ? 0 : semTributacao;
      const d0 = cfop.charAt(0);
      const map = ["1","2","3"].includes(d0) ? mapE : ["5","6","7"].includes(d0) ? mapS : null;
      if (!map || !cfop) continue;
      if (!map.has(cfop)) {
        map.set(cfop, {
          vlOpr:0, vlBc:0, vlImp:0, vlIsen:0, vlOut:0,
          vlBcSt:0, vlSt:0, vlDifal:0,
        });
      }
      const g = map.get(cfop)!;
      g.vlOpr += vlOpr; g.vlBc += vlBc; g.vlImp += vlImp;
      g.vlIsen += vlIsen; g.vlOut += vlOut;
      g.vlBcSt += vlBcSt; g.vlSt += vlSt;
    }

    const cfopsEntrada = [...mapE.entries()].sort(([a], [b]) => a.localeCompare(b));
    const cfopsSaida = [...mapS.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [cfop, v] of cfopsEntrada) {
      add(
        "22" + "01" + pN(cfop,5) +
        pMoney(v.vlOpr) + pMoney(v.vlBc) + pMoney(v.vlImp) +
        pMoney(v.vlIsen) + pMoney(v.vlOut) +
        pMoney(v.vlBcSt) + pMoney(v.vlSt) + pMoney(v.vlDifal)
      );
    }
    for (const [cfop, v] of cfopsSaida) {
      add(
        "23" + "02" + pN(cfop,5) +
        pMoney(v.vlOpr) + pMoney(v.vlBc) + pMoney(v.vlImp) +
        pMoney(v.vlIsen) + pMoney(v.vlOut) +
        pMoney(v.vlBcSt) + pMoney(v.vlSt) + pMoney(0)
      );
    }

    // ── Reg 24: Quadro 03 — Resumo dos Valores Fiscais ───────────────────────
    // Formato: tipo(2N) quadro(2C) item(3N) valor(17$)
    const addQ = (
      tipo: string,
      quadro: string,
      item: number,
      valor: number,
      obrigatorio = false,
    ) => {
      if (valor <= 0 && !obrigatorio) return;
      add(tipo + quadro + pN(item,3) + pMoney(valor));
    };

    // Soma entradas e saídas do C190
    let totEOpr=0,totEBc=0,totEImp=0,totEIsen=0,totEOut=0,totEBcSt=0,totESt=0,totEDifal=0;
    let totSOpr=0,totSBc=0,totSImp=0,totSIsen=0,totSOut=0,totSBcSt=0,totSSt=0;
    for (const v of mapE.values()) {
      totEOpr+=v.vlOpr; totEBc+=v.vlBc; totEImp+=v.vlImp; totEIsen+=v.vlIsen;
      totEOut+=v.vlOut; totEBcSt+=v.vlBcSt; totESt+=v.vlSt; totEDifal+=v.vlDifal;
    }
    for (const v of mapS.values()) {
      totSOpr+=v.vlOpr; totSBc+=v.vlBc; totSImp+=v.vlImp; totSIsen+=v.vlIsen;
      totSOut+=v.vlOut; totSBcSt+=v.vlBcSt; totSSt+=v.vlSt;
    }

    addQ("24","03",  10, totEOpr);  // Entradas – Valor Contábil
    addQ("24","03",  20, totEBc);   // Entradas – Base de Cálculo
    addQ("24","03",  30, totEImp);  // Entradas – Imposto Creditado
    addQ("24","03",  40, totEIsen);
    addQ("24","03",  50, totEOut);
    addQ("24","03",  53, totEBcSt);
    addQ("24","03",  54, totESt);
    addQ("24","03",  57, totEDifal);
    addQ("24","03",  60, totSOpr);  // Saídas   – Valor Contábil
    addQ("24","03",  70, totSBc);   // Saídas   – Base de Cálculo
    addQ("24","03",  80, totSImp);  // Saídas   – Imposto Debitado
    addQ("24","03",  90, totSIsen);
    addQ("24","03", 100, totSOut);
    addQ("24","03", 103, totSBcSt);
    addQ("24","03", 104, totSSt);

    // ── Reg 25: Quadro 04 — Resumo da Apuração dos Débitos ───────────────────
    // Mapeamento do E110:
    //   010 (+) Débito pelas saídas          = VL_TOT_DEBITOS
    //   050 (+) Estorno de crédito           = VL_ESTORNOS_CRED
    //   070 (+) Outros débitos/ajustes       = VL_AJ_DEBITOS
    //   990 (=) Subtotal → Q09.010          = soma dos itens emitidos
    // A apuração deve preservar os totais declarados no E110. Somar apenas os
    // C190 deixa de fora documentos de outros blocos e produz outro saldo.
    const q4DebSaidas = dime.q02.debSaidas;
    const q4EstCred = dime.q02.estCred;
    const q4OutrosDeb = dime.q02.ajDeb;
    const q4Subtotal = q4DebSaidas + q4EstCred + q4OutrosDeb;
    addQ("25","04",  10, q4DebSaidas);
    addQ("25","04",  50, q4EstCred);
    addQ("25","04",  70, q4OutrosDeb);
    addQ("25","04", 990, q4Subtotal, true);

    // ── Reg 26: Quadro 05 — Resumo da Apuração dos Créditos ─────────────────
    // Mapeamento do E110:
    //   010 (+) Saldo credor anterior        = VL_SLD_CREDOR_ANT
    //   020 (+) Créditos pelas entradas      = VL_TOT_CREDITOS
    //   990 (=) Subtotal → Q09.050          = soma dos itens emitidos
    // O item 020 deve corresponder ao imposto creditado do Quadro 03. Ajustes
    // do E110 não podem ser lançados no item 150, que não se aplica atualmente.
    const q5SaldoAnterior = dime.q02.sldCredAnt;
    const q5CredEntradas = totEImp;
    const q5Subtotal = q5SaldoAnterior + q5CredEntradas;
    addQ("26","05",  10, q5SaldoAnterior);
    addQ("26","05",  20, q5CredEntradas);
    addQ("26","05", 990, q5Subtotal, true);

    // ── Reg 30: Quadro 09 — Cálculo do Imposto a Pagar ou Saldo Credor ───────
    // Mapeamento:
    //   010 (+) Subtotal Débitos  = Q04.990
    //   040 (=) Total Débitos     = idem (sem ajustes decendiais)
    //   050 (+) Subtotal Créditos = Q05.990
    //   075 (+) Ajustes a crédito informados no E110
    //   080 (=) Total Créditos    = subtotal + ajustes
    //   120 (=) Saldo Devedor     = total de débitos - total de créditos
    //   999 (=) Imposto a Recolher= saldo devedor
    //   140 (=) Saldo Credor      = VL_SLD_CREDOR_TRANSP (se > 0)
    //   998    Saldo Credor p/mês = VL_SLD_CREDOR_TRANSP
    const q9AjustesCredito = dime.q02.ajCred + dime.q02.estDeb;
    const q9TotalCreditos = q5Subtotal + q9AjustesCredito;
    // O Validador DIME exige que os saldos sejam o resultado exato dos
    // totalizadores informados nos itens 040, 080 e 110 do próprio Quadro 09.
    const saldoDevedor = Math.max(0, q4Subtotal - q9TotalCreditos);
    const saldoCredor = Math.max(0, q9TotalCreditos - q4Subtotal);
    addQ("30","09",  10, q4Subtotal, true);
    addQ("30","09",  40, q4Subtotal, true);
    addQ("30","09",  50, q5Subtotal, true);
    addQ("30","09",  75, q9AjustesCredito);
    addQ("30","09",  80, q9TotalCreditos, true);
    if (q4Subtotal >= q9TotalCreditos) {
      addQ("30","09", 120, saldoDevedor, true);
      addQ("30","09", 999, saldoDevedor, true);
    } else {
      addQ("30","09", 140, saldoCredor);
      addQ("30","09", 998, saldoCredor);
    }

    // ── Reg 31: Quadro 10 — Débitos Específicos ──────────────────────────────
    if (dime.q02.debEsp > 0) addQ("31","10", 40, dime.q02.debEsp);

    // ── Reg 32: Quadro 11 — Informações sobre Substituição Tributária ─────────
    // Resume todos os E200/E210 (DIME Q11 é global, não por UF)
    if (dime.q03.length > 0) {
      const stTot = dime.q03.reduce(
        (a,r) => ({ totDeb:a.totDeb+r.totDeb, totCred:a.totCred+r.totCred, recol:a.recol+r.recol, sldCred:a.sldCred+r.sldCred }),
        { totDeb:0, totCred:0, recol:0, sldCred:0 }
      );
      addQ("32","11",  70, stTot.totDeb);   // Imposto retido (total débitos)
      addQ("32","11",  90, stTot.totCred);  // Saldo credor anterior (total créditos)
      if (stTot.recol > 0) {
        addQ("32","11", 170, stTot.recol);  // Saldo devedor
        addQ("32","11", 999, stTot.recol);  // Imposto a recolher
      }
      if (stTot.sldCred > 0) {
        addQ("32","11", 190, stTot.sldCred); // Saldo credor
        addQ("32","11", 998, stTot.sldCred); // Saldo credor para o mês seguinte
      }
    }

    // ── Reg 33: Quadro 12 — Discriminação do pagamento do ICMS ──────────────
    // Para apuração normal: origem 1, receita 1449 e classe 10014. Os campos
    // permanecem editáveis para contribuintes com classe de vencimento especial.
    if (saldoDevedor > 0) {
      const receita = codigoReceita.replace(/\D/g, "");
      const classe = classeVencimento.replace(/\D/g, "");
      const vencimento = dataVencimento.replace(/\D/g, "");
      if (
        receita.length !== 4 ||
        classe.length !== 5 ||
        !validarData(vencimento)
      ) {
        alert(
          "Informe código de receita, classe e data de vencimento válidos para o Quadro 12.",
        );
        return;
      }
      add(
        "33" + "12" + "1" +
        pN(receita, 4) +
        vencimento +
        pMoney(saldoDevedor) +
        pN(classe, 5) +
        pN(0, 15)
      );
    }

    // ── Reg 46: Quadro 46 — Autorização do crédito informado no DCIP ────────
    if (q9AjustesCredito > 0) {
      const autorizacao = autorizacaoDcip.replace(/\D/g, "");
      if (autorizacao.length !== 15) {
        alert(
          "Informe os 15 dígitos da autorização AUC/DCIP correspondente aos ajustes a crédito.",
        );
        return;
      }
      add(
        "46" + "46" + pN(1, 3) +
        pN(autorizacao, 15) +
        pMoney(q9AjustesCredito) +
        pN(14, 2)
      );
      add(
        "46" + "46" + pN(990, 3) +
        pN(0, 15) +
        pMoney(q9AjustesCredito) +
        pN(0, 2)
      );
    }

    // ── Regs 49/50: Entradas e saídas por Unidade da Federação ──────────────
    type EntradaUf = {
      valorContabil: number;
      baseCalculo: number;
      outras: number;
      petroleoEnergia: number;
      outrosProdutos: number;
    };
    type SaidaUf = {
      valorNaoContrib: number;
      valorContrib: number;
      baseNaoContrib: number;
      baseContrib: number;
      outras: number;
      icmsSt: number;
    };
    const entradasUf = new Map<string, EntradaUf>();
    const saidasUf = new Map<string, SaidaUf>();

    for (const context of fiscalContexts) {
      if (!context.uf) continue;
      const cfop = f(context.record, C190.CFOP);
      const firstDigit = cfop.charAt(0);
      const valorContabil = parseBrNum(f(context.record, C190.VL_OPR));
      const baseCalculo = parseBrNum(f(context.record, C190.VL_BC));
      const outras = Math.max(0, valorContabil - baseCalculo);
      const icmsSt = context.hasSt
        ? parseBrNum(f(context.record, C190.VL_ST))
        : 0;

      if (
        context.indOper === "0" ||
        ["1", "2", "3"].includes(firstDigit)
      ) {
        const value = entradasUf.get(context.uf) ?? {
          valorContabil: 0,
          baseCalculo: 0,
          outras: 0,
          petroleoEnergia: 0,
          outrosProdutos: 0,
        };
        value.valorContabil += valorContabil;
        value.baseCalculo += baseCalculo;
        value.outras += outras;
        // O C190 não identifica o produto; na ausência de detalhamento por
        // item, o ICMS-ST é classificado em "outros produtos".
        value.outrosProdutos += icmsSt;
        entradasUf.set(context.uf, value);
      } else if (
        context.indOper === "1" ||
        ["5", "6", "7"].includes(firstDigit)
      ) {
        const value = saidasUf.get(context.uf) ?? {
          valorNaoContrib: 0,
          valorContrib: 0,
          baseNaoContrib: 0,
          baseContrib: 0,
          outras: 0,
          icmsSt: 0,
        };
        if (context.contribuinte) {
          value.valorContrib += valorContabil;
          value.baseContrib += baseCalculo;
        } else {
          value.valorNaoContrib += valorContabil;
          value.baseNaoContrib += baseCalculo;
        }
        value.outras += outras;
        value.icmsSt += icmsSt;
        saidasUf.set(context.uf, value);
      }
    }

    const totalEntrada: EntradaUf = {
      valorContabil: 0,
      baseCalculo: 0,
      outras: 0,
      petroleoEnergia: 0,
      outrosProdutos: 0,
    };
    for (const [uf, value] of [...entradasUf].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      add(
        "49" + "49" + pC(uf, 2) +
        pMoney(value.valorContabil) +
        pMoney(value.baseCalculo) +
        pMoney(value.outras) +
        pMoney(value.petroleoEnergia) +
        pMoney(value.outrosProdutos)
      );
      totalEntrada.valorContabil += value.valorContabil;
      totalEntrada.baseCalculo += value.baseCalculo;
      totalEntrada.outras += value.outras;
      totalEntrada.petroleoEnergia += value.petroleoEnergia;
      totalEntrada.outrosProdutos += value.outrosProdutos;
    }
    if (entradasUf.size > 0) {
      add(
        "49" + "49" + "TT" +
        pMoney(totalEntrada.valorContabil) +
        pMoney(totalEntrada.baseCalculo) +
        pMoney(totalEntrada.outras) +
        pMoney(totalEntrada.petroleoEnergia) +
        pMoney(totalEntrada.outrosProdutos)
      );
    }

    const totalSaida: SaidaUf = {
      valorNaoContrib: 0,
      valorContrib: 0,
      baseNaoContrib: 0,
      baseContrib: 0,
      outras: 0,
      icmsSt: 0,
    };
    for (const [uf, value] of [...saidasUf].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      add(
        "50" + "50" + pC(uf, 2) +
        pMoney(value.valorNaoContrib) +
        pMoney(value.valorContrib) +
        pMoney(value.baseNaoContrib) +
        pMoney(value.baseContrib) +
        pMoney(value.outras) +
        pMoney(value.icmsSt)
      );
      totalSaida.valorNaoContrib += value.valorNaoContrib;
      totalSaida.valorContrib += value.valorContrib;
      totalSaida.baseNaoContrib += value.baseNaoContrib;
      totalSaida.baseContrib += value.baseContrib;
      totalSaida.outras += value.outras;
      totalSaida.icmsSt += value.icmsSt;
    }
    if (saidasUf.size > 0) {
      add(
        "50" + "50" + "TT" +
        pMoney(totalSaida.valorNaoContrib) +
        pMoney(totalSaida.valorContrib) +
        pMoney(totalSaida.baseNaoContrib) +
        pMoney(totalSaida.baseContrib) +
        pMoney(totalSaida.outras) +
        pMoney(totalSaida.icmsSt)
      );
    }

    // ── Reg 80: Quadro 80 — Inventário e Receita Bruta ──────────────────────
    // Leiaute: tipo(2N) quadro(2C) item(3N) valor(17$).
    if (includeReg80) {
      for (const { item } of REG80_ITEMS) {
        add("80" + "80" + item + pMoney(parseBrNum(reg80Values[item] || "0")));
      }
    }

    // ── Reg 81: Quadro 81 — Ativo ───────────────────────────────────────────
    if (includeReg81) {
      for (const { item } of REG81_ITEMS) {
        add("81" + "81" + item + pMoney(parseBrNum(reg81Values[item] || "0")));
      }
    }

    // ── Reg 82: Quadro 82 — Passivo ─────────────────────────────────────────
    if (includeReg82) {
      if (
        parseBrNum(reg82Values["269"] || "0") > 0 &&
        parseBrNum(reg82Values["270"] || "0") > 0
      ) {
        alert(
          "No Registro 82, informe somente o item 269 (passivo a descoberto) ou o item 270 (patrimônio líquido).",
        );
        return;
      }
      for (const { item } of REG82_ITEMS) {
        add("82" + "82" + item + pMoney(parseBrNum(reg82Values[item] || "0")));
      }
    }

    // ── Reg 83: Quadro 83 — Demonstração de Resultado ───────────────────────
    if (includeReg83) {
      const oppositeResults = [
        ["330", "331"],
        ["340", "341"],
        ["350", "351"],
        ["360", "361"],
        ["398", "399"],
      ];
      const invalidPair = oppositeResults.find(
        ([positive, negative]) =>
          parseBrNum(reg83Values[positive] || "0") > 0 &&
          parseBrNum(reg83Values[negative] || "0") > 0,
      );
      if (invalidPair) {
        alert(
          `No Registro 83, os itens ${invalidPair[0]} e ${invalidPair[1]} não podem ter valores simultaneamente.`,
        );
        return;
      }
      for (const { item } of REG83_ITEMS) {
        add("83" + "83" + item + pMoney(parseBrNum(reg83Values[item] || "0")));
      }
    }

    // ── Reg 84: Quadro 84 — Detalhamento das Despesas ───────────────────────
    // O item 499 corresponde ao total dos itens de despesas informados.
    if (includeReg84) {
      let totalDespesas = 0;
      for (const { item } of REG84_ITEMS) {
        const value = parseBrNum(reg84Values[item] || "0");
        totalDespesas += value;
        add("84" + "84" + item + pMoney(value));
      }
      add("84" + "84" + "499" + pMoney(totalDespesas));
    }

    // ── Reg 85: Quadro 85 — Contribuições ao FIA e FEI ──────────────────────
    if (includeReg85) {
      const fiaDare = parseBrNum(reg85Values["511"] || "0");
      const fiaMunicipal = parseBrNum(reg85Values["512"] || "0");
      const feiDare = parseBrNum(reg85Values["521"] || "0");
      const feiMunicipal = parseBrNum(reg85Values["522"] || "0");
      const reg85Rows = [
        ["501", parseBrNum(reg85Values["501"] || "0")],
        ["511", fiaDare],
        ["512", fiaMunicipal],
        ["519", fiaDare + fiaMunicipal],
        ["521", feiDare],
        ["522", feiMunicipal],
        ["529", feiDare + feiMunicipal],
      ] as const;
      for (const [item, value] of reg85Rows) {
        add("85" + "85" + item + pMoney(value));
      }
    }

    // ── Reg 98: Encerramento da Declaração ────────────────────────────────────
    // Campos: tipo(2N) quadro(2C=brancos) qtd-registros-declaração(5N) incluindo este
    add("98" + "  " + pN(declRegs + 1, 5));

    // ── Reg 99: Fechamento do Arquivo ─────────────────────────────────────────
    // Campos: tipo(2N) quadro(2C=brancos) qtd-total(5N) qtd-declarações(5N)
    const totalRegs = lines.length + 1; // inclui o próprio 99
    lines.push("99" + "  " + pN(totalRegs, 5) + pN(1, 5));

    const content = lines.join("\r\n") + "\r\n";
    const blob = new Blob([content], { type: "text/plain;charset=iso-8859-1" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `DIME_${ie9}_${comp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reg84Total = REG84_ITEMS.reduce(
    (total, { item }) => total + parseBrNum(reg84Values[item] || "0"),
    0,
  );
  const reg85FiaTotal =
    parseBrNum(reg85Values["511"] || "0") +
    parseBrNum(reg85Values["512"] || "0");
  const reg85FeiTotal =
    parseBrNum(reg85Values["521"] || "0") +
    parseBrNum(reg85Values["522"] || "0");

  return (
    <div className="flex flex-col h-full">
      {!parsed && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="mb-4 max-w-lg text-center">
            <div className="inline-flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-3">
              <Info size={12} /> Exclusivo para empresas de Santa Catarina
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Gerador de DIME-SC</h3>
            <p className="text-sm text-gray-500">Extraia os dados do SPED Fiscal (EFD ICMS/IPI) para preencher a DIME automaticamente</p>
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
              ${dragging ? "border-orange-500 bg-orange-50 scale-[1.02]" : "border-gray-300 hover:border-orange-400 hover:bg-orange-50/40"}`}
          >
            <Upload size={36} className={`mx-auto mb-3 ${dragging ? "text-orange-500" : "text-gray-400"}`} />
            <p className="font-bold text-gray-700 text-lg">Arraste o SPED Fiscal (EFD ICMS/IPI)</p>
            <p className="text-sm text-gray-400 mt-1">Blocos C e E serão utilizados para gerar a DIME</p>
            <div className="flex items-center justify-center gap-3 mt-4">
              <select value={encoding} onChange={e => setEncoding(e.target.value as any)} onClick={e => e.stopPropagation()}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-600">
                <option value="UTF-8">UTF-8</option>
                <option value="ISO-8859-1">ISO-8859-1 (Latin-1)</option>
              </select>
            </div>
            <button className="mt-4 bg-orange-500 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-orange-600 transition-colors">
              Selecionar arquivo
            </button>
          </div>
          <input ref={inputRef} type="file" accept=".txt,.sped" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} className="hidden" />
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center gap-3 text-orange-700">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
          <span className="font-semibold">Extraindo dados da DIME...</span>
        </div>
      )}

      {parsed && dime && !loading && (
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <FileText size={16} className="text-orange-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-orange-900 text-sm truncate">{dime.empresa || "—"}</p>
                <p className="text-xs text-orange-700">
                  {formatCNPJ(dime.cnpj)} · {dime.uf} · {formatPeriodo(dime.periodoIni)} a {formatPeriodo(dime.periodoFin)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={handleExportDime}
                title="Gera o TXT posicional para importação no Validador DIME-SC"
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 border border-orange-600 px-3 py-1.5 rounded-lg transition-colors shadow">
                <FileCode size={12} /> Gerar TXT para Validador DIME
              </button>
              <button onClick={handlePrint}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-gray-800 border border-gray-300 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors">
                <Printer size={12} /> Imprimir
              </button>
              <button onClick={() => { setParsed(null); setDime(null); }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 px-2.5 py-1.5 rounded-lg transition-colors">
                <X size={12} /> Outro arquivo
              </button>
            </div>
          </div>

          {/* Dados do Contabilista */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex-shrink-0">
            <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">Contabilista</span>
            <input
              type="text"
              placeholder="CPF (somente números)"
              maxLength={14}
              value={contCPF}
              onChange={e => setContCPF(e.target.value.replace(/\D/g,"").slice(0,11))}
              className="w-36 text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-orange-400"
            />
            <input
              type="text"
              placeholder="Nome do contabilista"
              maxLength={50}
              value={contNome}
              onChange={e => setContNome(e.target.value.slice(0,50))}
              className="flex-1 text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-orange-400"
            />
            <span className="text-xs text-gray-400 whitespace-nowrap">(Reg 20)</span>
          </div>

          {/* Dados do pagamento do ICMS normal */}
          <div className="grid grid-cols-[auto_7rem_8rem_9rem] items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex-shrink-0">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-800">
                Pagamento do ICMS
              </p>
              <p className="text-[10px] text-emerald-600 truncate">
                Quadro 12 · ajuste somente se houver regime especial
              </p>
            </div>
            <div>
              <label className="block text-[9px] font-bold uppercase text-emerald-700 mb-0.5">
                Receita
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={codigoReceita}
                onChange={e =>
                  setCodigoReceita(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                className="w-full text-xs border border-emerald-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold uppercase text-emerald-700 mb-0.5">
                Classe
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={classeVencimento}
                onChange={e =>
                  setClasseVencimento(
                    e.target.value.replace(/\D/g, "").slice(0, 5),
                  )
                }
                className="w-full text-xs border border-emerald-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold uppercase text-emerald-700 mb-0.5">
                Vencimento
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="DDMMAAAA"
                value={dataVencimento}
                onChange={e =>
                  setDataVencimento(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                className="w-full text-xs border border-emerald-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {(dime.q02.ajCred + dime.q02.estDeb) > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex-shrink-0">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-900">
                  Autorização do crédito DCIP
                </p>
                <p className="text-[10px] text-amber-700">
                  Quadro 46, origem 14 · crédito de R$ {formatBrl(dime.q02.ajCred + dime.q02.estDeb)}
                </p>
              </div>
              <div className="w-52">
                <label className="block text-[9px] font-bold uppercase text-amber-700 mb-0.5">
                  Número AUC/DCIP — 15 dígitos
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={15}
                  placeholder="000000000000000"
                  value={autorizacaoDcip}
                  onChange={e =>
                    setAutorizacaoDcip(
                      e.target.value.replace(/\D/g, "").slice(0, 15),
                    )
                  }
                  className="w-full font-mono text-xs border border-amber-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* DIME format notice */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-800 flex-shrink-0">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong>TXT para o Validador DIME-SC</strong> — arquivo magnético posicional da Portaria SEF nº 153/2012, Anexo II. Este é o arquivo que deve ser importado no programa da SEF/SC.
            </span>
          </div>

          {/* UF warning */}
          {dime.uf && dime.uf.toUpperCase() !== "SC" && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800 flex-shrink-0">
              <AlertTriangle size={13} className="flex-shrink-0" />
              Atenção: UF do arquivo é <strong>{dime.uf}</strong>. A DIME-SC é exclusiva para contribuintes de Santa Catarina.
            </div>
          )}

          {/* Tabs */}
          <div className="flex flex-shrink-0 gap-1 overflow-x-auto">
            {[
              { key:"q02", label:"Quadro 02 — ICMS Próprio" },
              { key:"q03", label:`Quadro 03 — ICMS-ST (${dime.q03.length} UFs)` },
              { key:"q05", label:`Quadro 05 — Mov. Econômica (${dime.q05.length} grupos)` },
              { key:"q80", label:"Registro 80 — Inventário" },
              { key:"q81", label:"Registro 81 — Ativo" },
              { key:"q82", label:"Registro 82 — Passivo" },
              { key:"q83", label:"Registro 83 — Resultado" },
              { key:"q84", label:"Registro 84 — Despesas" },
              { key:"q85", label:"Registro 85 — FIA e FEI" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setActiveTab(key as any)}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl border border-b-0 transition-colors ${
                  activeTab === key ? "bg-white border-gray-300 text-orange-700" : "bg-gray-100 border-transparent text-gray-500 hover:bg-gray-200"
                }`}>{label}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto bg-white border border-gray-300 rounded-b-xl rounded-tr-xl">

            {/* Quadro 02 */}
            {activeTab === "q02" && (
              <div className="divide-y divide-gray-100">
                <div className="px-3 py-2 bg-orange-50">
                  <p className="text-xs font-black text-orange-800 uppercase tracking-wider">Quadro 02 — Apuração do ICMS Operações Próprias</p>
                </div>
                <div>
                  <div className="px-3 py-1 bg-gray-50">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">DÉBITOS</p>
                  </div>
                  <QRow num="01" label="Débitos de Saídas / Prestações de Serviços" value={dime.q02.debSaidas} />
                  <QRow num="02" label="Ajustes a Débito" value={dime.q02.ajDeb} />
                  <QRow num="03" label="Estorno de Créditos" value={dime.q02.estCred} />
                  <QRow num="04" label="Total Débitos" value={dime.q02.totDeb} bold />
                </div>
                <div>
                  <div className="px-3 py-1 bg-gray-50">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">CRÉDITOS</p>
                  </div>
                  <QRow num="05" label="Créditos de Entradas e Aquisições" value={dime.q02.credEntradas} />
                  <QRow num="06" label="Ajustes a Crédito" value={dime.q02.ajCred} />
                  <QRow num="07" label="Estorno de Débitos" value={dime.q02.estDeb} />
                  <QRow num="08" label="Saldo Credor do Período Anterior" value={dime.q02.sldCredAnt} />
                  <QRow num="09" label="Total Créditos" value={dime.q02.totCred} bold />
                </div>
                <div>
                  <div className="px-3 py-1 bg-gray-50">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">APURAÇÃO</p>
                  </div>
                  {dime.q02.sldApurado > 0 ? (
                    <QRow num="10" label="Saldo Devedor" value={dime.q02.sldApurado} bold highlight="devedor" />
                  ) : (
                    <QRow num="10" label="Saldo Credor" value={dime.q02.sldCredTransp} bold highlight="credor" />
                  )}
                  <QRow num="11" label="Deduções" value={dime.q02.deducoes} />
                  <QRow num="12" label="ICMS a Recolher" value={dime.q02.icmsRecolher} bold highlight={dime.q02.icmsRecolher > 0 ? "devedor" : "neutral"} />
                  <QRow num="13" label="Saldo Credor p/ Próximo Período" value={dime.q02.sldCredTransp} bold highlight={dime.q02.sldCredTransp > 0 ? "credor" : "neutral"} />
                  {dime.q02.debEsp > 0 && <QRow num="14" label="Débito Especial" value={dime.q02.debEsp} />}
                </div>
              </div>
            )}

            {/* Quadro 03 */}
            {activeTab === "q03" && (
              <div>
                <div className="px-3 py-2 bg-orange-50 border-b border-gray-200">
                  <p className="text-xs font-black text-orange-800 uppercase tracking-wider">Quadro 03 — ICMS Substituição Tributária por UF</p>
                </div>
                {dime.q03.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p className="font-semibold">Nenhum registro E200/E210 encontrado</p>
                    <p className="text-sm mt-1">O SPED Fiscal não contém dados de ICMS-ST por UF</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {dime.q03.map((row) => (
                      <div key={row.uf} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-gray-800 text-sm">{row.uf}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${row.recol > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {row.recol > 0 ? `ICMS-ST a Recolher: R$ ${formatBrl(row.recol)}` : `Saldo Credor: R$ ${formatBrl(row.sldCred)}`}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <span>Total Débitos: R$ {formatBrl(row.totDeb)}</span>
                          <span>Total Créditos: R$ {formatBrl(row.totCred)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quadro 05 */}
            {activeTab === "q05" && (
              <div>
                <div className="px-3 py-2 bg-orange-50 border-b border-gray-200">
                  <p className="text-xs font-black text-orange-800 uppercase tracking-wider">Quadro 05 — Movimentação Econômica (C190)</p>
                </div>
                {dime.q05.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p className="font-semibold">Nenhum registro C190 encontrado</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 text-left">
                          <th className="px-3 py-2 font-semibold">Natureza da Operação (CFOP)</th>
                          <th className="px-3 py-2 font-semibold text-right">Vl. Operações</th>
                          <th className="px-3 py-2 font-semibold text-right">BC ICMS</th>
                          <th className="px-3 py-2 font-semibold text-right">ICMS</th>
                          <th className="px-3 py-2 font-semibold text-right">BC ICMS-ST</th>
                          <th className="px-3 py-2 font-semibold text-right">ICMS-ST</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dime.q05.map((g, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <p className="font-semibold text-gray-800">{g.grupo}</p>
                              <p className="text-gray-400 font-mono text-[10px]">{g.cfops.slice(0,8).join(", ")}{g.cfops.length > 8 ? "…" : ""}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{formatBrl(g.vlOpr)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{formatBrl(g.vlBcIcms)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-orange-700">{formatBrl(g.vlIcms)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">{formatBrl(g.vlBcSt)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-600">{formatBrl(g.vlSt)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-100 font-bold">
                          <td className="px-3 py-2 text-gray-800">TOTAL</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBrl(dime.q05.reduce((s,g) => s+g.vlOpr,0))}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBrl(dime.q05.reduce((s,g) => s+g.vlBcIcms,0))}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-orange-700">{formatBrl(dime.q05.reduce((s,g) => s+g.vlIcms,0))}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBrl(dime.q05.reduce((s,g) => s+g.vlBcSt,0))}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{formatBrl(dime.q05.reduce((s,g) => s+g.vlSt,0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Registro 80 */}
            {activeTab === "q80" && (
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-orange-50 px-3 py-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-orange-800">
                      Quadro 80 — Inventário e Receita Bruta
                    </p>
                    <p className="mt-0.5 text-[10px] text-orange-700">
                      Valores relativos ao exercício anterior · preenchimento manual
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncludeReg80(value => !value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      includeReg80
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-gray-300 bg-white text-gray-600"
                    }`}
                  >
                    {includeReg80 ? "Incluído no TXT" : "Não incluir no TXT"}
                  </button>
                </div>
                <div className="space-y-3 p-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                    O Registro 80 é uma declaração complementar anual. Ative a
                    inclusão somente quando ele for exigido para a referência.
                  </div>
                  {REG80_ITEMS.map(({ item, label }) => (
                    <label
                      key={item}
                      className="grid items-center gap-2 sm:grid-cols-[4rem_1fr_12rem]"
                    >
                      <span className="font-mono text-xs font-bold text-orange-700">
                        {item}
                      </span>
                      <span className="text-sm text-gray-700">{label}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={reg80Values[item]}
                        onChange={event =>
                          setReg80Values(values => ({
                            ...values,
                            [item]: event.target.value,
                          }))
                        }
                        placeholder="0,00"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-right font-mono text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Registro 81 */}
            {activeTab === "q81" && (
              <ManualRecordPanel
                title="Quadro 81 — Ativo"
                subtitle="Balanço patrimonial do exercício anterior"
                note="Preencha somente quando a empresa possuir escrita contábil. Informe também os totalizadores 110, 130, 150 e 199 conforme o balanço."
                items={REG81_ITEMS}
                values={reg81Values}
                included={includeReg81}
                onToggle={() => setIncludeReg81(value => !value)}
                onChange={(item, value) =>
                  setReg81Values(values => ({ ...values, [item]: value }))
                }
              />
            )}

            {/* Registro 82 */}
            {activeTab === "q82" && (
              <ManualRecordPanel
                title="Quadro 82 — Passivo"
                subtitle="Balanço patrimonial do exercício anterior"
                note="Preencha somente quando a empresa possuir escrita contábil. Os itens 269 (passivo a descoberto) e 270 (patrimônio líquido) não devem ser informados simultaneamente."
                items={REG82_ITEMS}
                values={reg82Values}
                included={includeReg82}
                onToggle={() => setIncludeReg82(value => !value)}
                onChange={(item, value) =>
                  setReg82Values(values => ({ ...values, [item]: value }))
                }
              />
            )}

            {/* Registro 83 */}
            {activeTab === "q83" && (
              <ManualRecordPanel
                title="Quadro 83 — Demonstração de Resultado"
                subtitle="Resultado contábil do exercício anterior"
                note="Preencha somente quando a empresa possuir escrita contábil. Informe lucro ou prejuízo nos itens correspondentes, evitando preencher resultados opostos simultaneamente."
                items={REG83_ITEMS}
                values={reg83Values}
                included={includeReg83}
                onToggle={() => setIncludeReg83(value => !value)}
                onChange={(item, value) =>
                  setReg83Values(values => ({ ...values, [item]: value }))
                }
              />
            )}

            {/* Registro 84 */}
            {activeTab === "q84" && (
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-orange-50 px-3 py-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-orange-800">
                      Quadro 84 — Detalhamento das Despesas
                    </p>
                    <p className="mt-0.5 text-[10px] text-orange-700">
                      Despesas do exercício anterior pelo regime de competência
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncludeReg84(value => !value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      includeReg84
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-gray-300 bg-white text-gray-600"
                    }`}
                  >
                    {includeReg84 ? "Incluído no TXT" : "Não incluir no TXT"}
                  </button>
                </div>
                <div className="space-y-3 p-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                    Informe as despesas independentemente de estarem pagas. O
                    item 499 é calculado automaticamente pela soma dos itens.
                  </div>
                  {REG84_ITEMS.map(({ item, label }) => (
                    <label
                      key={item}
                      className="grid items-center gap-2 sm:grid-cols-[4rem_1fr_12rem]"
                    >
                      <span className="font-mono text-xs font-bold text-orange-700">
                        {item}
                      </span>
                      <span className="text-sm text-gray-700">{label}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={reg84Values[item]}
                        onChange={event =>
                          setReg84Values(values => ({
                            ...values,
                            [item]: event.target.value,
                          }))
                        }
                        placeholder="0,00"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-right font-mono text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </label>
                  ))}
                  <div className="grid items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 sm:grid-cols-[4rem_1fr_12rem]">
                    <span className="font-mono text-xs font-black text-orange-800">499</span>
                    <span className="text-sm font-bold text-orange-900">Total das despesas</span>
                    <span className="text-right font-mono text-sm font-black text-orange-900">
                      R$ {formatBrl(reg84Total)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Registro 85 */}
            {activeTab === "q85" && (
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-orange-50 px-3 py-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-orange-800">
                      Quadro 85 — Contribuições ao FIA e FEI
                    </p>
                    <p className="mt-0.5 text-[10px] text-orange-700">
                      Valores devidos no exercício anterior
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncludeReg85(value => !value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      includeReg85
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-gray-300 bg-white text-gray-600"
                    }`}
                  >
                    {includeReg85 ? "Incluído no TXT" : "Não incluir no TXT"}
                  </button>
                </div>
                <div className="space-y-3 p-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                    Quadro obrigatório para pessoas jurídicas no lucro real que
                    obtiveram benefícios fiscais ou financeiro-fiscais de ICMS,
                    conforme a legislação de Santa Catarina.
                  </div>
                  {REG85_INPUT_ITEMS.map(({ item, label }) => (
                    <label
                      key={item}
                      className="grid items-center gap-2 sm:grid-cols-[4rem_1fr_12rem]"
                    >
                      <span className="font-mono text-xs font-bold text-orange-700">
                        {item}
                      </span>
                      <span className="text-sm text-gray-700">{label}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={reg85Values[item]}
                        onChange={event =>
                          setReg85Values(values => ({
                            ...values,
                            [item]: event.target.value,
                          }))
                        }
                        placeholder="0,00"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-right font-mono text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </label>
                  ))}
                  <div className="grid items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 sm:grid-cols-[4rem_1fr_12rem]">
                    <span className="font-mono text-xs font-black text-orange-800">519</span>
                    <span className="text-sm font-bold text-orange-900">
                      Total das contribuições ou transferências ao FIA
                    </span>
                    <span className="text-right font-mono text-sm font-black text-orange-900">
                      R$ {formatBrl(reg85FiaTotal)}
                    </span>
                  </div>
                  <div className="grid items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 sm:grid-cols-[4rem_1fr_12rem]">
                    <span className="font-mono text-xs font-black text-orange-800">529</span>
                    <span className="text-sm font-bold text-orange-900">
                      Total das contribuições ou transferências ao FEI
                    </span>
                    <span className="text-right font-mono text-sm font-black text-orange-900">
                      R$ {formatBrl(reg85FeiTotal)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
