// ─── SPED Parser & Validation Utilities ────────────────────────────────────
// Suporta EFD ICMS/IPI (Fiscal) e EFD-Contribuições (PIS/COFINS)

export interface SpedRecord {
  lineNumber: number;
  block: string;
  reg: string;
  fields: string[]; // fields[0] = reg, fields[1] = first data field, etc.
  raw: string;
}

export interface ParsedSped {
  records: SpedRecord[];
  byReg: Map<string, SpedRecord[]>;
  byBlock: Map<string, SpedRecord[]>;
  header: SpedRecord | null; // registro 0000
  totalLines: number;
  parseErrors: string[];
  tipo: "fiscal" | "contribuicoes" | "desconhecido";
}

export interface ValidationIssue {
  type: "error" | "warning" | "info";
  lineNumber?: number;
  reg?: string;
  field?: string;
  message: string;
  code: string;
}

// ── UFs válidas ──────────────────────────────────────────────────────────────
export const UFS_VALIDAS = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

// ── CST ICMS válidos ─────────────────────────────────────────────────────────
// Regime Normal (2 dígitos) + Simples Nacional (3 dígitos com prefixo 1, 2, 3, 4, 5, 9)
export const CST_ICMS_NORMAL = new Set([
  "00","10","20","30","40","41","50","51","60","70","90",
]);
export const CST_ICMS_SIMPLES = new Set([
  "101","102","103","201","202","203","300","400","500","900",
]);
export function isCST_ICMS_VALIDO(cst: string): boolean {
  return CST_ICMS_NORMAL.has(cst.trim()) || CST_ICMS_SIMPLES.has(cst.trim());
}

// ── CST PIS/COFINS válidos ───────────────────────────────────────────────────
export const CST_PIS_COFINS_VALIDOS = new Set([
  "01","02","03","04","05","06","07","08","09",
  "49",
  "50","51","52","53","54","55","56",
  "60","61","62","63","64","65","66",
  "70","71","72","73","74","75",
  "98","99",
]);
export function isCST_PIS_COFINS_VALIDO(cst: string): boolean {
  return CST_PIS_COFINS_VALIDOS.has(cst.trim());
}

// ── CFOP validation ──────────────────────────────────────────────────────────
// Primeiro dígito válido: 1 (entrada nacional mesma UF), 2 (entrada outra UF),
// 3 (entrada exterior), 5 (saída mesma UF), 6 (saída outra UF), 7 (saída exterior)
export function isCFOP_VALIDO(cfop: string): boolean {
  const c = cfop.trim();
  if (!/^\d{4}$/.test(c)) return false;
  return ["1","2","3","5","6","7"].includes(c[0]);
}

// ── CNPJ validation ──────────────────────────────────────────────────────────
export function validarCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const soma = (s: string, pesos: number[]) =>
    pesos.reduce((acc, p, i) => acc + parseInt(s[i]) * p, 0);
  const d1 = soma(c, [5,4,3,2,9,8,7,6,5,4,3,2]) % 11;
  const r1 = d1 < 2 ? 0 : 11 - d1;
  const d2 = soma(c, [6,5,4,3,2,9,8,7,6,5,4,3,2]) % 11;
  const r2 = d2 < 2 ? 0 : 11 - d2;
  return parseInt(c[12]) === r1 && parseInt(c[13]) === r2;
}

// ── CPF validation ───────────────────────────────────────────────────────────
export function validarCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += parseInt(c[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  return parseInt(c[9]) === calc(9) && parseInt(c[10]) === calc(10);
}

// ── Date DDMMAAAA validation ─────────────────────────────────────────────────
export function validarData(data: string): boolean {
  if (!/^\d{8}$/.test(data.trim())) return false;
  const dd = parseInt(data.slice(0, 2));
  const mm = parseInt(data.slice(2, 4));
  const yyyy = parseInt(data.slice(4, 8));
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  if (yyyy < 1990 || yyyy > 2035) return false;
  const dt = new Date(yyyy, mm - 1, dd);
  return dt.getDate() === dd && dt.getMonth() === mm - 1 && dt.getFullYear() === yyyy;
}

// ── Number parsing (BR format: comma as decimal separator) ───────────────────
export function parseBrNum(s: string): number {
  if (!s || s.trim() === "") return 0;
  const n = parseFloat(s.trim().replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export function formatBrl(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── SPED File Parser ─────────────────────────────────────────────────────────
export function parseSped(content: string): ParsedSped {
  const lines = content.split(/\r?\n/);
  const records: SpedRecord[] = [];
  const byReg = new Map<string, SpedRecord[]>();
  const byBlock = new Map<string, SpedRecord[]>();
  const parseErrors: string[] = [];
  let header: SpedRecord | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trimEnd();
    if (!raw) continue;

    if (!raw.startsWith("|")) {
      if (parseErrors.length < 10)
        parseErrors.push(`Linha ${i + 1}: não inicia com '|' — possível problema de encoding`);
      continue;
    }

    // Split and strip first/last empty strings from surrounding pipes
    const parts = raw.split("|");
    const fields = parts.slice(1, parts[parts.length - 1].trim() === "" ? -1 : undefined);

    const reg = (fields[0] ?? "").trim().toUpperCase();
    if (!reg) continue;

    const block = reg.charAt(0);
    const record: SpedRecord = { lineNumber: i + 1, block, reg, fields, raw };

    records.push(record);
    if (!byReg.has(reg)) byReg.set(reg, []);
    byReg.get(reg)!.push(record);
    if (!byBlock.has(block)) byBlock.set(block, []);
    byBlock.get(block)!.push(record);
    if (reg === "0000") header = record;
  }

  // Detect file type from 0000.COD_VER or presence of M/P blocks
  let tipo: ParsedSped["tipo"] = "desconhecido";
  if (header) {
    const codVer = (header.fields[1] ?? "").trim();
    if (byBlock.has("M") || byBlock.has("P")) {
      tipo = "contribuicoes";
    } else if (byBlock.has("C") || byBlock.has("E") || byBlock.has("D")) {
      tipo = "fiscal";
    }
  }

  return { records, byReg, byBlock, header, totalLines: lines.length, parseErrors, tipo };
}

// ── Block structure helpers ───────────────────────────────────────────────────
export function getBlockAbertura(block: string): string {
  return `${block}001`;
}
export function getBlockEncerramento(block: string): string {
  return `${block}990`;
}

// ── 9900 count map (for count validation) ────────────────────────────────────
export function build9900Map(parsed: ParsedSped): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of parsed.byReg.get("9900") ?? []) {
    const reg = (r.fields[1] ?? "").trim().toUpperCase();
    const qty = parseInt(r.fields[2] ?? "0") || 0;
    map.set(reg, qty);
  }
  return map;
}
