import { useState, useRef, useCallback } from "react";
import {
  Upload, FileText, AlertCircle, AlertTriangle, Info,
  CheckCircle, ChevronDown, ChevronUp, X, Search, Download,
} from "lucide-react";
import {
  parseSped, validarCNPJ, validarCPF, validarData,
  isCFOP_VALIDO, isCST_ICMS_VALIDO, validateUF, parseBrNum, formatBrl,
  build9900Map, getBlockAbertura, getBlockEncerramento,
} from "./SpedParser";
import type { ParsedSped, ValidationIssue, SpedRecord } from "./SpedParser";

// ── 0000 field positions (EFD ICMS/IPI) ─────────────────────────────────────
// |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|TEL|FAX|COD_NAT|IND_ATIV|
const F0000 = { COD_VER:1, COD_FIN:2, DT_INI:3, DT_FIN:4, NOME:5, CNPJ:6, CPF:7, UF:8, IE:9 };

// ── C100 field positions ─────────────────────────────────────────────────────
// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...
const FC100 = { IND_OPER:1, COD_MOD:4, COD_SIT:5, CHV_NFE:8, DT_DOC:9, DT_E_S:10, VL_DOC:11 };

// ── C190 field positions ─────────────────────────────────────────────────────
// |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|
const FC190 = { CST_ICMS:1, CFOP:2, ALIQ_ICMS:3, VL_OPR:4, VL_BC_ICMS:5, VL_ICMS:6 };

// ── E110 field positions ─────────────────────────────────────────────────────
// |E110|VL_TOT_DÉBITOS|VL_AJ_DÉBITOS|VL_TOT_AJ_DÉBITOS|VL_ESTORNOS_CRED|VL_TOT_CRÉDITOS|VL_AJ_CRÉDITOS|VL_TOT_AJ_CRÉDITOS|VL_ESTORNOS_DÉB|VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|VL_SLD_CREDOR_TRANSP|DEB_ESP|
const FE110 = {
  VL_TOT_DEB:1, VL_AJ_DEB:2, VL_TOT_AJ_DEB:3, VL_EST_CRED:4,
  VL_TOT_CRED:5, VL_AJ_CRED:6, VL_TOT_AJ_CRED:7, VL_EST_DEB:8,
  VL_SLD_CRED_ANT:9, VL_SLD_APURADO:10, VL_TOT_DED:11,
  VL_ICMS_RECOLHER:12, VL_SLD_CRED_TRANSP:13,
};

// ── Blocks obrigatórios no SPED Fiscal ──────────────────────────────────────
const BLOCOS_OBRIGATORIOS = ["0","C","E","1","9"];

function f(r: SpedRecord, idx: number): string {
  return (r.fields[idx] ?? "").trim();
}

// ── Validation engine ─────────────────────────────────────────────────────────
function validateFiscal(parsed: ParsedSped): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (type: ValidationIssue["type"], code: string, message: string, lineNumber?: number, reg?: string) =>
    issues.push({ type, code, message, lineNumber, reg });

  // 1. Parse errors
  for (const e of parsed.parseErrors) {
    add("error", "PARSE001", e);
  }

  // 2. Verificar tipo do arquivo
  if (parsed.tipo === "contribuicoes") {
    add("error", "TIPO001", "Este arquivo parece ser EFD-Contribuições, não EFD ICMS/IPI. Use o validador correto.");
  }

  // 3. Registro 0000 obrigatório
  const hdr = parsed.header;
  if (!hdr) {
    add("error", "EST001", "Registro 0000 (cabeçalho) não encontrado — arquivo inválido.");
    return issues; // Sem cabeçalho, parar validação
  }

  // 4. Validar 0000
  const cnpj0000 = f(hdr, F0000.CNPJ);
  const cpf0000  = f(hdr, F0000.CPF);
  const dtIni    = f(hdr, F0000.DT_INI);
  const dtFin    = f(hdr, F0000.DT_FIN);
  const uf0000   = f(hdr, F0000.UF);
  const nome0000 = f(hdr, F0000.NOME);
  const codVer   = f(hdr, F0000.COD_VER);

  if (cnpj0000 && !validarCNPJ(cnpj0000)) {
    add("error", "CAB001", `0000: CNPJ inválido: "${cnpj0000}"`, hdr.lineNumber, "0000");
  }
  if (!cnpj0000 && cpf0000 && !validarCPF(cpf0000)) {
    add("error", "CAB002", `0000: CPF inválido: "${cpf0000}"`, hdr.lineNumber, "0000");
  }
  if (!cnpj0000 && !cpf0000) {
    add("error", "CAB003", "0000: CNPJ e CPF ausentes", hdr.lineNumber, "0000");
  }
  if (!validarData(dtIni)) {
    add("error", "CAB004", `0000: DT_INI inválida: "${dtIni}"`, hdr.lineNumber, "0000");
  }
  if (!validarData(dtFin)) {
    add("error", "CAB005", `0000: DT_FIN inválida: "${dtFin}"`, hdr.lineNumber, "0000");
  }
  if (validarData(dtIni) && validarData(dtFin)) {
    const ini = new Date(dtIni.slice(4), +dtIni.slice(2,4)-1, +dtIni.slice(0,2));
    const fin = new Date(dtFin.slice(4), +dtFin.slice(2,4)-1, +dtFin.slice(0,2));
    if (ini > fin) add("error", "CAB006", "0000: DT_INI é posterior a DT_FIN", hdr.lineNumber, "0000");
  }
  if (uf0000 && !UFS_VALIDAS.has(uf0000)) {
    add("error", "CAB007", `0000: UF inválida: "${uf0000}"`, hdr.lineNumber, "0000");
  }
  if (!nome0000) {
    add("warning", "CAB008", "0000: NOME do contribuinte não informado", hdr.lineNumber, "0000");
  }
  if (!codVer) {
    add("warning", "CAB009", "0000: COD_VER (versão do leiaute) não informada", hdr.lineNumber, "0000");
  }

  // 5. Estrutura de blocos — abertura e encerramento
  for (const bloco of BLOCOS_OBRIGATORIOS) {
    const abertura = getBlockAbertura(bloco);
    const encerramento = getBlockEncerramento(bloco);
    if (!parsed.byReg.has(abertura)) {
      add("error", "EST002", `Registro ${abertura} (abertura do Bloco ${bloco}) não encontrado`);
    }
    if (!parsed.byReg.has(encerramento)) {
      add("error", "EST003", `Registro ${encerramento} (encerramento do Bloco ${bloco}) não encontrado`);
    }
  }

  // 6. Último registro deve ser 9999
  const ultimo = parsed.records[parsed.records.length - 1];
  if (ultimo?.reg !== "9999") {
    add("error", "EST004", `Último registro deve ser 9999, encontrado: ${ultimo?.reg ?? "(vazio)"}`, ultimo?.lineNumber);
  }

  // 7. Primeiro registro não-vazio deve ser 0000
  const primeiro = parsed.records[0];
  if (primeiro?.reg !== "0000") {
    add("error", "EST005", `Primeiro registro deve ser 0000, encontrado: ${primeiro?.reg ?? "(vazio)"}`, primeiro?.lineNumber);
  }

  // 8. Validar 9900 — contagem de registros
  const mapa9900 = build9900Map(parsed);
  for (const [regNome, qtd9900] of mapa9900.entries()) {
    const reais = (parsed.byReg.get(regNome) ?? []).length;
    if (reais !== qtd9900) {
      add("error", "CNT001",
        `9900: Contagem do registro ${regNome} diverge — declarado: ${qtd9900}, encontrado: ${reais}`);
    }
  }

  // 9. Validar C100
  let c100InvalidCount = 0;
  for (const r of parsed.byReg.get("C100") ?? []) {
    const chvNfe = f(r, FC100.CHV_NFE);
    const dtDoc  = f(r, FC100.DT_DOC);
    const dtES   = f(r, FC100.DT_E_S);
    const codMod = f(r, FC100.COD_MOD);

    // Chave NF-e: apenas para modelos 55 (NF-e) e 57 (CT-e)
    if (chvNfe && (codMod === "55" || codMod === "57")) {
      const chvClean = chvNfe.replace(/\D/g, "");
      if (chvClean.length !== 44) {
        if (c100InvalidCount < 20) {
          add("error", "NF001", `C100 linha ${r.lineNumber}: CHV_NFE com ${chvClean.length} dígitos (esperado 44)`, r.lineNumber, "C100");
        }
        c100InvalidCount++;
      }
    }

    if (dtDoc && !validarData(dtDoc)) {
      if (c100InvalidCount < 30) {
        add("error", "NF002", `C100 linha ${r.lineNumber}: DT_DOC inválida: "${dtDoc}"`, r.lineNumber, "C100");
      }
      c100InvalidCount++;
    }
    if (dtES && !validarData(dtES)) {
      if (c100InvalidCount < 30) {
        add("warning", "NF003", `C100 linha ${r.lineNumber}: DT_E_S inválida: "${dtES}"`, r.lineNumber, "C100");
      }
    }
  }
  if (c100InvalidCount > 30) {
    add("warning", "NF004", `Mais ${c100InvalidCount - 30} ocorrências similares em C100 não exibidas (limite de exibição)`);
  }

  // 10. Validar C190 — CST ICMS, CFOP, alíquota
  let c190InvalidCount = 0;
  for (const r of parsed.byReg.get("C190") ?? []) {
    const cstIcms  = f(r, FC190.CST_ICMS);
    const cfop     = f(r, FC190.CFOP);
    const aliq     = f(r, FC190.ALIQ_ICMS);
    const vlBcIcms = parseBrNum(f(r, FC190.VL_BC_ICMS));
    const vlIcms   = parseBrNum(f(r, FC190.VL_ICMS));

    if (cstIcms && !isCST_ICMS_VALIDO(cstIcms)) {
      if (c190InvalidCount < 20)
        add("error", "CST001", `C190 linha ${r.lineNumber}: CST_ICMS inválido: "${cstIcms}"`, r.lineNumber, "C190");
      c190InvalidCount++;
    }
    if (cfop && !isCFOP_VALIDO(cfop)) {
      if (c190InvalidCount < 20)
        add("error", "CFOP001", `C190 linha ${r.lineNumber}: CFOP inválido: "${cfop}"`, r.lineNumber, "C190");
      c190InvalidCount++;
    }
    // Alíquota > 30% é improvável
    const aliqNum = parseBrNum(aliq);
    if (aliqNum > 30 && aliqNum !== 0) {
      if (c190InvalidCount < 20)
        add("warning", "ALQ001", `C190 linha ${r.lineNumber}: ALIQ_ICMS improvável: ${aliqNum}%`, r.lineNumber, "C190");
    }
    // VL_ICMS > VL_BC_ICMS (alíquota efetiva > 100%)
    if (vlBcIcms > 0 && vlIcms > vlBcIcms) {
      if (c190InvalidCount < 20)
        add("error", "VLR001", `C190 linha ${r.lineNumber}: VL_ICMS (${formatBrl(vlIcms)}) maior que VL_BC_ICMS (${formatBrl(vlBcIcms)})`, r.lineNumber, "C190");
      c190InvalidCount++;
    }
  }
  if (c190InvalidCount > 20) {
    add("warning", "C190X", `Mais ${c190InvalidCount - 20} ocorrências similares em C190 não exibidas`);
  }

  // 11. Validar E110 — aritmética da apuração ICMS
  for (const r of parsed.byReg.get("E110") ?? []) {
    const totDeb    = parseBrNum(f(r, FE110.VL_TOT_AJ_DEB));
    const totCred   = parseBrNum(f(r, FE110.VL_TOT_AJ_CRED));
    const sldCrAnt  = parseBrNum(f(r, FE110.VL_SLD_CRED_ANT));
    const sldApur   = parseBrNum(f(r, FE110.VL_SLD_APURADO));
    const totDed    = parseBrNum(f(r, FE110.VL_TOT_DED));
    const recolher  = parseBrNum(f(r, FE110.VL_ICMS_RECOLHER));
    const sldCrTrp  = parseBrNum(f(r, FE110.VL_SLD_CRED_TRANSP));

    // Saldo apurado = débitos - créditos - saldo credor anterior
    const saldoCalc = totDeb - totCred - sldCrAnt;
    const tolerancia = 0.05;

    if (Math.abs(saldoCalc - sldApur) > tolerancia && sldApur !== 0) {
      add("error", "E110A",
        `E110 linha ${r.lineNumber}: VL_SLD_APURADO diverge. Calculado: ${formatBrl(saldoCalc)}, Declarado: ${formatBrl(sldApur)}`,
        r.lineNumber, "E110");
    }

    // Se saldo apurado positivo → deve haver ICMS a recolher
    if (saldoCalc > tolerancia) {
      const recolherEsperado = Math.max(0, saldoCalc - totDed);
      if (Math.abs(recolherEsperado - recolher) > tolerancia) {
        add("warning", "E110B",
          `E110 linha ${r.lineNumber}: VL_ICMS_RECOLHER diverge. Esperado: ${formatBrl(recolherEsperado)}, Declarado: ${formatBrl(recolher)}`,
          r.lineNumber, "E110");
      }
      if (sldCrTrp > 0) {
        add("warning", "E110C",
          `E110 linha ${r.lineNumber}: VL_SLD_CREDOR_TRANSP informado (${formatBrl(sldCrTrp)}) mesmo com saldo devedor`,
          r.lineNumber, "E110");
      }
    }

    // Se saldo apurado ≤ 0 → ICMS a recolher deve ser zero
    if (saldoCalc <= 0 && recolher > 0) {
      add("error", "E110D",
        `E110 linha ${r.lineNumber}: VL_ICMS_RECOLHER > 0 com saldo devedor negativo/zero`,
        r.lineNumber, "E110");
    }
  }

  // 12. Aviso se Bloco H (inventário) ausente
  if (!parsed.byBlock.has("H")) {
    add("info", "INV001", "Bloco H (inventário) não encontrado — obrigatório periodicamente (encerramento de período/exercício)");
  }

  // 13. Aviso se Bloco K (controle de produção) ausente para industriais
  if (!parsed.byBlock.has("K")) {
    add("info", "IND001", "Bloco K (controle de produção e estoques) não encontrado");
  }

  // 14. Resumo de informações gerais
  const totalDocs = (parsed.byReg.get("C100") ?? []).length;
  const totalItens = (parsed.byReg.get("C170") ?? []).length;
  if (totalDocs > 0) {
    add("info", "INFO001", `Bloco C: ${totalDocs.toLocaleString("pt-BR")} documentos fiscais, ${totalItens.toLocaleString("pt-BR")} itens`);
  }
  const e110s = parsed.byReg.get("E110") ?? [];
  if (e110s.length > 0) {
    for (const r of e110s) {
      const recolher = parseBrNum(f(r, FE110.VL_ICMS_RECOLHER));
      const sldCr    = parseBrNum(f(r, FE110.VL_SLD_CRED_TRANSP));
      if (recolher > 0) add("info", "INFO002", `E110: ICMS a recolher: R$ ${formatBrl(recolher)}`, r.lineNumber, "E110");
      if (sldCr > 0)    add("info", "INFO003", `E110: Saldo credor a transportar: R$ ${formatBrl(sldCr)}`, r.lineNumber, "E110");
    }
  }

  return issues;
}

// ── UI Component ─────────────────────────────────────────────────────────────
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
      <div className="flex-shrink-0 flex gap-1.5">
        {lineNumber && <span className="text-gray-400">L{lineNumber}</span>}
        {reg && <span className={`font-mono font-semibold ${text}`}>{reg}</span>}
      </div>
    </div>
  );
}

export function SpedFiscalValidator() {
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
    if (file.size > 100 * 1024 * 1024) {
      alert("Arquivo maior que 100 MB. Considere processar em partes.");
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const p = parseSped(content);
      const v = validateFiscal(p);
      setParsed(p);
      setIssues(v);
      setLoading(false);
    };
    reader.readAsText(file, encoding);
  }, [encoding]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
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
    a.href = url; a.download = `validacao_${fileName || "sped"}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Upload area */}
      {!parsed && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
              ${dragging ? "border-blue-500 bg-blue-50 scale-[1.02]" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/40"}`}
          >
            <Upload size={36} className={`mx-auto mb-3 ${dragging ? "text-blue-500" : "text-gray-400"}`} />
            <p className="font-bold text-gray-700 text-lg">Arraste o arquivo SPED Fiscal</p>
            <p className="text-sm text-gray-400 mt-1">EFD ICMS/IPI — arquivo .txt</p>
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
            <button className="mt-4 bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors">
              Selecionar arquivo
            </button>
            <p className="text-xs text-gray-400 mt-3">Máx. 100 MB · processado localmente no navegador</p>
          </div>
          <input ref={inputRef} type="file" accept=".txt,.sped" onChange={handleChange} className="hidden" />
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center gap-3 text-blue-700">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <span className="font-semibold">Processando arquivo...</span>
        </div>
      )}

      {parsed && !loading && (
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {/* File info bar */}
          <div className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={16} className="text-blue-500 flex-shrink-0" />
              <span className="font-semibold text-gray-800 text-sm truncate">{fileName}</span>
              <span className="text-xs text-gray-400">({(fileSize / 1024).toFixed(0)} KB · {parsed.totalLines.toLocaleString("pt-BR")} linhas · {parsed.records.length.toLocaleString("pt-BR")} registros)</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={exportTxt} className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-blue-700 border border-gray-300 hover:border-blue-400 px-2.5 py-1.5 rounded-lg transition-colors">
                <Download size={12} /> Exportar
              </button>
              <button onClick={() => { setParsed(null); setIssues([]); setFileName(""); }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 px-2.5 py-1.5 rounded-lg transition-colors">
                <X size={12} /> Outro arquivo
              </button>
            </div>
          </div>

          {/* Company info */}
          {parsed.header && (
            <div className="flex items-center gap-4 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs text-blue-900 flex-shrink-0 flex-wrap">
              <span><strong>Empresa:</strong> {parsed.header.fields[5] || "—"}</span>
              <span><strong>CNPJ:</strong> {parsed.header.fields[6] || parsed.header.fields[7] || "—"}</span>
              <span><strong>UF:</strong> {parsed.header.fields[8] || "—"}</span>
              <span><strong>Período:</strong> {parsed.header.fields[3] || "—"} a {parsed.header.fields[4] || "—"}</span>
              <span><strong>Versão:</strong> {parsed.header.fields[1] || "—"}</span>
            </div>
          )}

          {/* Summary chips + search */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {(["all","error","warning","info"] as FilterType[]).map(t => {
              const count = t === "all" ? issues.length : counts[t as keyof typeof counts];
              const [label, cls] =
                t === "all"     ? ["Todos",    filter==="all"     ? "bg-gray-800 text-white"    : "bg-gray-100 text-gray-600 hover:bg-gray-200"] :
                t === "error"   ? ["Erros",    filter==="error"   ? "bg-red-600 text-white"     : "bg-red-50 text-red-700 hover:bg-red-100"] :
                t === "warning" ? ["Alertas",  filter==="warning" ? "bg-amber-500 text-white"   : "bg-amber-50 text-amber-700 hover:bg-amber-100"] :
                                  ["Infos",    filter==="info"    ? "bg-blue-600 text-white"    : "bg-blue-50 text-blue-700 hover:bg-blue-100"];
              return (
                <button key={t} onClick={() => setFilter(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${cls}`}>
                  {label} <span className="opacity-80">{count}</span>
                </button>
              );
            })}
            <div className="flex-1 min-w-32 relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar…"
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-300 rounded-full focus:outline-none focus:border-blue-400"
              />
            </div>
            {counts.error === 0 && counts.warning === 0 && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full">
                <CheckCircle size={12} /> Arquivo válido
              </span>
            )}
          </div>

          {/* Issues list */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" />
                <p className="font-semibold">Nenhuma ocorrência neste filtro</p>
              </div>
            ) : (
              filtered.map((issue, i) => <IssueRow key={i} issue={issue} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
