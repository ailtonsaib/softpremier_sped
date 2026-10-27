import { useState, useRef, useCallback } from "react";
import {
  Upload, FileText, AlertCircle, AlertTriangle, Info,
  CheckCircle, X, Search, Download,
} from "lucide-react";
import {
  parseSped, validarCNPJ, validarCPF, validarData,
  isCFOP_VALIDO, isCST_PIS_COFINS_VALIDO, parseBrNum, formatBrl,
  build9900Map, getBlockAbertura, getBlockEncerramento,
} from "./SpedParser";
import type { ParsedSped, ValidationIssue, SpedRecord } from "./SpedParser";

// ── 0000 EFD-Contribuições field positions ───────────────────────────────────
// |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|IDENT_MF|IND_SIT_ESP|IND_SIT_REG|NOM_CONT|CNPJ_CONT|
const F0000C = { COD_VER:1, COD_FIN:2, DT_INI:3, DT_FIN:4, NOME:5, CNPJ:6, CPF:7 };

// ── C100 EFD-Contrib field positions ─────────────────────────────────────────
// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...
const FC100 = { IND_OPER:1, COD_MOD:4, COD_SIT:5, CHV_NFE:8, DT_DOC:9, DT_E_S:10 };

// ── C170 EFD-Contrib item field positions ────────────────────────────────────
// |C170|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|COD_NAT|VL_BC_ICMS|ALIQ_ICMS|VL_ICMS|...CST_PIS|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|VL_PIS|CST_COFINS|...
// PIS/COFINS positions vary by version; approximate:
const FC170C = { CST_PIS:22, VL_BC_PIS:23, ALIQ_PIS:24, VL_PIS:26, CST_COFINS:27 };

// ── M200 (PIS apuração não-cumulativo) field positions ────────────────────────
// |M200|VL_TOT_CONT_NC_PER|VL_TOT_CRED_DESC|VL_TOT_CRED_DESC_ANT|VL_TOT_CONT_NC_DEV|VL_RET_NC|VL_OUT_DED_NC|VL_CONT_NC_REC|VL_TOT_CONT_CUM_PER|VL_RET_CUM|VL_OUT_DED_CUM|VL_CONT_CUM_REC|VL_TOT_CONT_REC|
const FM200 = {
  VL_TOT_NC:1, VL_TOT_CRED_DESC:2, VL_TOT_CRED_ANT:3, VL_TOT_NC_DEV:4,
  VL_RET_NC:5, VL_OUT_DED_NC:6, VL_CONT_NC_REC:7,
  VL_TOT_CUM:8, VL_RET_CUM:9, VL_OUT_DED_CUM:10, VL_CONT_CUM_REC:11,
  VL_TOT_REC:12,
};

// ── M600 (COFINS apuração) field positions ────────────────────────────────────
const FM600 = { ...FM200 };

const BLOCOS_CONTRIB = ["0","A","C","D","F","I","M","1","9"];
const BLOCOS_MINIMOS  = ["0","C","M","1","9"];

function f(r: SpedRecord, idx: number): string {
  return (r.fields[idx] ?? "").trim();
}

function validateContrib(parsed: ParsedSped): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (type: ValidationIssue["type"], code: string, message: string, lineNumber?: number, reg?: string) =>
    issues.push({ type, code, message, lineNumber, reg });

  for (const e of parsed.parseErrors) add("error", "PARSE001", e);

  if (parsed.tipo === "fiscal") {
    add("error", "TIPO001", "Este arquivo parece ser EFD ICMS/IPI, não EFD-Contribuições. Use o validador correto.");
  }

  // Cabeçalho 0000
  const hdr = parsed.header;
  if (!hdr) {
    add("error", "EST001", "Registro 0000 não encontrado — arquivo inválido.");
    return issues;
  }

  const cnpj   = f(hdr, F0000C.CNPJ);
  const cpf    = f(hdr, F0000C.CPF);
  const dtIni  = f(hdr, F0000C.DT_INI);
  const dtFin  = f(hdr, F0000C.DT_FIN);
  const nome   = f(hdr, F0000C.NOME);

  if (cnpj && !validarCNPJ(cnpj)) add("error", "CAB001", `0000: CNPJ inválido: "${cnpj}"`, hdr.lineNumber, "0000");
  if (!cnpj && cpf && !validarCPF(cpf)) add("error", "CAB002", `0000: CPF inválido: "${cpf}"`, hdr.lineNumber, "0000");
  if (!cnpj && !cpf) add("error", "CAB003", "0000: CNPJ e CPF ausentes", hdr.lineNumber, "0000");
  if (!validarData(dtIni)) add("error", "CAB004", `0000: DT_INI inválida: "${dtIni}"`, hdr.lineNumber, "0000");
  if (!validarData(dtFin)) add("error", "CAB005", `0000: DT_FIN inválida: "${dtFin}"`, hdr.lineNumber, "0000");
  if (validarData(dtIni) && validarData(dtFin)) {
    const ini = new Date(+dtIni.slice(4), +dtIni.slice(2,4)-1, +dtIni.slice(0,2));
    const fin = new Date(+dtFin.slice(4), +dtFin.slice(2,4)-1, +dtFin.slice(0,2));
    if (ini > fin) add("error", "CAB006", "0000: DT_INI posterior a DT_FIN", hdr.lineNumber, "0000");
  }
  if (!nome) add("warning", "CAB008", "0000: NOME não informado", hdr.lineNumber, "0000");

  // Estrutura de blocos mínimos
  for (const bloco of BLOCOS_MINIMOS) {
    if (!parsed.byReg.has(getBlockAbertura(bloco))) {
      add("error", "EST002", `Registro ${getBlockAbertura(bloco)} (abertura Bloco ${bloco}) não encontrado`);
    }
    if (!parsed.byReg.has(getBlockEncerramento(bloco))) {
      add("error", "EST003", `Registro ${getBlockEncerramento(bloco)} (encerramento Bloco ${bloco}) não encontrado`);
    }
  }

  // Registros extremos
  const ultimo = parsed.records[parsed.records.length - 1];
  if (ultimo?.reg !== "9999") {
    add("error", "EST004", `Último registro deve ser 9999, encontrado: ${ultimo?.reg ?? "(vazio)"}`, ultimo?.lineNumber);
  }
  const primeiro = parsed.records[0];
  if (primeiro?.reg !== "0000") {
    add("error", "EST005", `Primeiro registro deve ser 0000, encontrado: ${primeiro?.reg ?? "(vazio)"}`, primeiro?.lineNumber);
  }

  // 9900 contagens
  const mapa9900 = build9900Map(parsed);
  for (const [regNome, qtd] of mapa9900.entries()) {
    const reais = (parsed.byReg.get(regNome) ?? []).length;
    if (reais !== qtd) {
      add("error", "CNT001", `9900: Contagem de ${regNome} diverge — declarado: ${qtd}, encontrado: ${reais}`);
    }
  }

  // C100 — documentos fiscais
  let c100Erros = 0;
  for (const r of parsed.byReg.get("C100") ?? []) {
    const chvNfe = f(r, FC100.CHV_NFE);
    const codMod = f(r, FC100.COD_MOD);
    const dtDoc  = f(r, FC100.DT_DOC);
    if (chvNfe && (codMod === "55" || codMod === "57")) {
      if (chvNfe.replace(/\D/g,"").length !== 44 && c100Erros < 20) {
        add("error", "NF001", `C100 L${r.lineNumber}: CHV_NFE com ${chvNfe.replace(/\D/g,"").length} dígitos (esperado 44)`, r.lineNumber, "C100");
        c100Erros++;
      }
    }
    if (dtDoc && !validarData(dtDoc) && c100Erros < 30) {
      add("error", "NF002", `C100 L${r.lineNumber}: DT_DOC inválida: "${dtDoc}"`, r.lineNumber, "C100");
      c100Erros++;
    }
  }
  if (c100Erros >= 20) add("warning", "NF004", `Erros adicionais em C100 suprimidos (limite de exibição atingido)`);

  // C170 — itens: CST PIS/COFINS e CFOP
  let c170Erros = 0;
  for (const r of parsed.byReg.get("C170") ?? []) {
    const cstPis    = f(r, FC170C.CST_PIS);
    const cstCofins = f(r, FC170C.CST_COFINS);
    const cfop      = f(r, 10); // approximate CFOP position in C170

    if (cstPis && !isCST_PIS_COFINS_VALIDO(cstPis) && c170Erros < 20) {
      add("error", "CST_PIS01", `C170 L${r.lineNumber}: CST_PIS inválido: "${cstPis}"`, r.lineNumber, "C170");
      c170Erros++;
    }
    if (cstCofins && !isCST_PIS_COFINS_VALIDO(cstCofins) && c170Erros < 20) {
      add("error", "CST_COF01", `C170 L${r.lineNumber}: CST_COFINS inválido: "${cstCofins}"`, r.lineNumber, "C170");
      c170Erros++;
    }
    if (cfop && !isCFOP_VALIDO(cfop) && c170Erros < 20) {
      add("error", "CFOP01", `C170 L${r.lineNumber}: CFOP inválido: "${cfop}"`, r.lineNumber, "C170");
      c170Erros++;
    }
  }
  if (c170Erros >= 20) add("warning", "C170X", `Erros adicionais em C170 suprimidos`);

  // M200 — apuração PIS
  for (const r of parsed.byReg.get("M200") ?? []) {
    const nc    = parseBrNum(f(r, FM200.VL_TOT_NC));
    const cum   = parseBrNum(f(r, FM200.VL_TOT_CUM));
    const total = parseBrNum(f(r, FM200.VL_TOT_REC));
    const calc  = parseBrNum(f(r, FM200.VL_CONT_NC_REC)) + parseBrNum(f(r, FM200.VL_CONT_CUM_REC));
    if (Math.abs(total - calc) > 0.05 && total !== 0) {
      add("error", "M200A",
        `M200 L${r.lineNumber}: VL_TOT_CONT_REC (${formatBrl(total)}) ≠ soma NC+CUM (${formatBrl(calc)})`,
        r.lineNumber, "M200");
    }
    if (total > 0) add("info", "M200I", `M200: PIS total a recolher: R$ ${formatBrl(total)}`, r.lineNumber, "M200");
  }

  // M600 — apuração COFINS
  for (const r of parsed.byReg.get("M600") ?? []) {
    const total = parseBrNum(f(r, FM600.VL_TOT_REC));
    const calc  = parseBrNum(f(r, FM600.VL_CONT_NC_REC)) + parseBrNum(f(r, FM600.VL_CONT_CUM_REC));
    if (Math.abs(total - calc) > 0.05 && total !== 0) {
      add("error", "M600A",
        `M600 L${r.lineNumber}: VL_TOT_CONT_REC (${formatBrl(total)}) ≠ soma NC+CUM (${formatBrl(calc)})`,
        r.lineNumber, "M600");
    }
    if (total > 0) add("info", "M600I", `M600: COFINS total a recolher: R$ ${formatBrl(total)}`, r.lineNumber, "M600");
  }

  // Bloco A — serviços
  if (parsed.byBlock.has("A")) {
    add("info", "BLK_A", `Bloco A presente: ${(parsed.byBlock.get("A") ?? []).length} registros de serviços`);
  }

  // Bloco F — demais receitas
  if (parsed.byBlock.has("F")) {
    add("info", "BLK_F", `Bloco F presente: ${(parsed.byBlock.get("F") ?? []).length} registros de demais receitas`);
  }

  // Resumo
  const totalDocs = (parsed.byReg.get("C100") ?? []).length;
  const totalItens = (parsed.byReg.get("C170") ?? []).length;
  if (totalDocs > 0) {
    add("info", "INFO001", `Bloco C: ${totalDocs.toLocaleString("pt-BR")} documentos, ${totalItens.toLocaleString("pt-BR")} itens`);
  }

  return issues;
}

// ── UI ────────────────────────────────────────────────────────────────────────
type FilterType = "all" | "error" | "warning" | "info";

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const { type, code, message, lineNumber, reg } = issue;
  const [icon, bg, text] =
    type === "error"   ? [<AlertCircle size={14} />,   "bg-red-50 border-red-200",    "text-red-700"] :
    type === "warning" ? [<AlertTriangle size={14} />, "bg-amber-50 border-amber-200","text-amber-700"] :
                         [<Info size={14} />,           "bg-blue-50 border-blue-200",  "text-blue-700"];
  return (
    <div className={`flex items-start gap-2 px-3 py-2 border rounded-lg text-xs ${bg}`}>
      <span className={`mt-0.5 flex-shrink-0 ${text}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`font-mono font-bold ${text} mr-2`}>[{code}]</span>
        <span className="text-gray-700">{message}</span>
      </div>
      <div className="flex-shrink-0 flex gap-1.5 text-gray-400 text-[10px]">
        {lineNumber && <span>L{lineNumber}</span>}
        {reg && <span className={`font-mono font-semibold ${text}`}>{reg}</span>}
      </div>
    </div>
  );
}

export function SpedContribValidator() {
  const [parsed, setParsed] = useState<ParsedSped | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dragging, setDragging] = useState(false);
  const [encoding, setEncoding] = useState<"UTF-8" | "ISO-8859-1">("UTF-8");
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (file.size > 100 * 1024 * 1024) { alert("Arquivo maior que 100 MB."); return; }
    setFileName(file.name);
    setFileSize(file.size);
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const p = parseSped(content);
      setIssues(validateContrib(p));
      setParsed(p);
      setLoading(false);
    };
    reader.readAsText(file, encoding);
  }, [encoding]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) processFile(f);
  };

  const filtered = issues.filter(i => {
    if (filter !== "all" && i.type !== filter) return false;
    if (searchTerm && !i.message.toLowerCase().includes(searchTerm.toLowerCase()) && !i.code.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const counts = {
    error:   issues.filter(i => i.type === "error").length,
    warning: issues.filter(i => i.type === "warning").length,
    info:    issues.filter(i => i.type === "info").length,
  };

  const exportTxt = () => {
    const lines = issues.map(i => `[${i.type.toUpperCase()}][${i.code}]${i.lineNumber ? ` L${i.lineNumber}` : ""}${i.reg ? ` ${i.reg}` : ""}: ${i.message}`);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `validacao_contrib_${fileName || "sped"}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {!parsed && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
              ${dragging ? "border-green-500 bg-green-50 scale-[1.02]" : "border-gray-300 hover:border-green-400 hover:bg-green-50/40"}`}
          >
            <Upload size={36} className={`mx-auto mb-3 ${dragging ? "text-green-500" : "text-gray-400"}`} />
            <p className="font-bold text-gray-700 text-lg">Arraste o arquivo SPED Contribuições</p>
            <p className="text-sm text-gray-400 mt-1">EFD PIS/COFINS — arquivo .txt</p>
            <div className="flex items-center justify-center gap-3 mt-4">
              <select
                value={encoding}
                onChange={e => setEncoding(e.target.value as any)}
                onClick={e => e.stopPropagation()}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-600"
              >
                <option value="UTF-8">UTF-8</option>
                <option value="ISO-8859-1">ISO-8859-1 (Latin-1)</option>
              </select>
            </div>
            <button className="mt-4 bg-green-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-green-700 transition-colors">
              Selecionar arquivo
            </button>
            <p className="text-xs text-gray-400 mt-3">Máx. 100 MB · processado localmente</p>
          </div>
          <input ref={inputRef} type="file" accept=".txt,.sped" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} className="hidden" />
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center gap-3 text-green-700">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          <span className="font-semibold">Processando arquivo...</span>
        </div>
      )}

      {parsed && !loading && (
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={16} className="text-green-500 flex-shrink-0" />
              <span className="font-semibold text-gray-800 text-sm truncate">{fileName}</span>
              <span className="text-xs text-gray-400">({(fileSize/1024).toFixed(0)} KB · {parsed.totalLines.toLocaleString("pt-BR")} linhas)</span>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={exportTxt} className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-green-700 border border-gray-300 hover:border-green-400 px-2.5 py-1.5 rounded-lg transition-colors">
                <Download size={12} /> Exportar
              </button>
              <button onClick={() => { setParsed(null); setIssues([]); setFileName(""); }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 px-2.5 py-1.5 rounded-lg transition-colors">
                <X size={12} /> Outro arquivo
              </button>
            </div>
          </div>

          {parsed.header && (
            <div className="flex items-center gap-4 bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-xs text-green-900 flex-shrink-0 flex-wrap">
              <span><strong>Empresa:</strong> {parsed.header.fields[5] || "—"}</span>
              <span><strong>CNPJ:</strong> {parsed.header.fields[6] || parsed.header.fields[7] || "—"}</span>
              <span><strong>Período:</strong> {parsed.header.fields[3] || "—"} a {parsed.header.fields[4] || "—"}</span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {(["all","error","warning","info"] as FilterType[]).map(t => {
              const count = t === "all" ? issues.length : counts[t as keyof typeof counts];
              const [label, cls] =
                t === "all"     ? ["Todos",    filter==="all"     ? "bg-gray-800 text-white"    : "bg-gray-100 text-gray-600 hover:bg-gray-200"] :
                t === "error"   ? ["Erros",    filter==="error"   ? "bg-red-600 text-white"     : "bg-red-50 text-red-700 hover:bg-red-100"] :
                t === "warning" ? ["Alertas",  filter==="warning" ? "bg-amber-500 text-white"   : "bg-amber-50 text-amber-700 hover:bg-amber-100"] :
                                  ["Infos",    filter==="info"    ? "bg-green-600 text-white"   : "bg-green-50 text-green-700 hover:bg-green-100"];
              return (
                <button key={t} onClick={() => setFilter(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${cls}`}>
                  {label} <span className="opacity-80">{count}</span>
                </button>
              );
            })}
            <div className="flex-1 min-w-32 relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Buscar…"
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-300 rounded-full focus:outline-none focus:border-green-400" />
            </div>
            {counts.error === 0 && counts.warning === 0 && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full">
                <CheckCircle size={12} /> Arquivo válido
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" />
                <p className="font-semibold">Nenhuma ocorrência neste filtro</p>
              </div>
            ) : filtered.map((issue, i) => <IssueRow key={i} issue={issue} />)}
          </div>
        </div>
      )}
    </div>
  );
}
