import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCode2,
  FileWarning,
  Info,
  Trash2,
  Upload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface Retentions {
  inss: number;
  ir: number;
  pis: number;
  cofins: number;
  csll: number;
}

interface ServiceDocument {
  id: string;
  fileName: string;
  number: string;
  series: string;
  issueDate: string;
  eventDate: string;
  providerName: string;
  providerCnpj: string;
  customerCnpj: string;
  grossValue: number;
  retentions: Retentions;
  otherRetention: number;
  serviceType: string;
  incomeNature: string;
}

interface ImportProblem {
  fileName: string;
  message: string;
}

const REINF_VERSION = "2_01_02";
const PROCESS_VERSION = "ValidadorSPED-1.0";

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function xmlElements(root: ParentNode, names: string[]): Element[] {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return Array.from(root.querySelectorAll("*")).filter((element) =>
    wanted.has(element.localName.toLowerCase()),
  );
}

function firstText(root: ParentNode, names: string[]): string {
  return xmlElements(root, names)[0]?.textContent?.trim() ?? "";
}

function firstScope(root: ParentNode, names: string[]): Element | ParentNode {
  return xmlElements(root, names)[0] ?? root;
}

function parseMoney(value: string): number {
  if (!value) return 0;
  const normalized = value.trim().replace(/\s/g, "");
  const decimal =
    normalized.includes(",") && normalized.includes(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(",", ".");
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstMoney(root: ParentNode, names: string[]): number {
  return parseMoney(firstText(root, names));
}

function normalizeDate(value: string): string {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const brMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  return "";
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function xmlMoney(value: number): string {
  return value.toFixed(2);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function makeEventId(cnpj: string, sequence: number): string {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `ID1${onlyDigits(cnpj).padStart(14, "0")}${timestamp}${String(sequence).padStart(5, "0")}`;
}

function parseServiceXml(xml: string, fileName: string): ServiceDocument {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = parsed.querySelector("parsererror");
  if (parserError) throw new Error("XML inválido ou malformado.");

  const noteScope = firstScope(parsed, [
    "InfNfse",
    "infNFSe",
    "CompNfse",
    "Nfse",
  ]);
  const providerScope = firstScope(noteScope, [
    "PrestadorServico",
    "prestador",
    "emit",
  ]);
  const customerScope = firstScope(noteScope, [
    "TomadorServico",
    "tomador",
    "toma",
  ]);
  const valuesScope = firstScope(noteScope, [
    "ValoresNfse",
    "Valores",
    "valores",
    "vServPrest",
  ]);

  const providerCnpj = onlyDigits(
    firstText(providerScope, ["Cnpj", "CNPJ", "CNPJPrestador", "CNPJEmitente"]),
  );
  const customerCnpj = onlyDigits(
    firstText(customerScope, ["Cnpj", "CNPJ", "CNPJTomador"]),
  );
  const number = firstText(noteScope, [
    "Numero",
    "nNFSe",
    "NumeroNfse",
    "NumeroNota",
  ]);
  const issueDate = normalizeDate(
    firstText(noteScope, ["DataEmissao", "dhEmi", "dEmi", "Competencia"]),
  );

  if (!number && !providerCnpj) {
    throw new Error("O arquivo não parece ser uma NFS-e reconhecida.");
  }

  return {
    id: `${fileName}-${crypto.randomUUID()}`,
    fileName,
    number: number || "Sem número",
    series: firstText(noteScope, ["Serie", "serie", "cSerie"]) || "Única",
    issueDate,
    eventDate: issueDate,
    providerName:
      firstText(providerScope, [
        "RazaoSocial",
        "xNome",
        "NomeFantasia",
        "Nome",
      ]) || "Prestador não identificado",
    providerCnpj,
    customerCnpj,
    grossValue: firstMoney(valuesScope, [
      "ValorServicos",
      "vServ",
      "vServPrest",
      "ValorLiquidoNfse",
    ]),
    retentions: {
      inss: firstMoney(valuesScope, ["ValorInss", "vINSS", "vRetCP"]),
      ir: firstMoney(valuesScope, ["ValorIr", "ValorIR", "vIR", "vRetIR"]),
      pis: firstMoney(valuesScope, ["ValorPis", "ValorPIS", "vPIS"]),
      cofins: firstMoney(valuesScope, [
        "ValorCofins",
        "ValorCOFINS",
        "vCOFINS",
      ]),
      csll: firstMoney(valuesScope, ["ValorCsll", "ValorCSLL", "vCSLL"]),
    },
    otherRetention: firstMoney(valuesScope, [
      "OutrasRetencoes",
      "ValorOutrasRetencoes",
      "vOutRet",
    ]),
    serviceType: "",
    incomeNature: "",
  };
}

function totalFederal(document: ServiceDocument): number {
  return (
    document.retentions.ir +
    document.retentions.pis +
    document.retentions.cofins +
    document.retentions.csll
  );
}

function eventStatus(document: ServiceDocument): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  const hasInss = document.retentions.inss > 0;
  const hasFederal = totalFederal(document) > 0;
  if (!hasInss && !hasFederal) {
    return { label: "Sem retenção", variant: "secondary" };
  }
  if ((hasInss && !document.serviceType) || (hasFederal && !document.incomeNature)) {
    return { label: "Classificação pendente", variant: "destructive" };
  }
  return { label: "Pronto para prévia", variant: "default" };
}

function buildR2010(
  document: ServiceDocument,
  contributorCnpj: string,
  period: string,
  environment: string,
  sequence: number,
): string {
  const contributorRoot = onlyDigits(contributorCnpj).slice(0, 8);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtServTom/v${REINF_VERSION}">
  <evtServTom id="${makeEventId(contributorCnpj, sequence)}">
    <ideEvento>
      <indRetif>1</indRetif>
      <perApur>${escapeXml(period)}</perApur>
      <tpAmb>${escapeXml(environment)}</tpAmb>
      <procEmi>1</procEmi>
      <verProc>${PROCESS_VERSION}</verProc>
    </ideEvento>
    <ideContri>
      <tpInsc>1</tpInsc>
      <nrInsc>${contributorRoot}</nrInsc>
    </ideContri>
    <infoServTom>
      <ideEstabObra>
        <tpInscEstab>1</tpInscEstab>
        <nrInscEstab>${onlyDigits(contributorCnpj)}</nrInscEstab>
        <idePrestServ>
          <cnpjPrestador>${document.providerCnpj}</cnpjPrestador>
          <indObra>0</indObra>
          <vlrTotalBruto>${xmlMoney(document.grossValue)}</vlrTotalBruto>
          <vlrTotalBaseRet>${xmlMoney(document.grossValue)}</vlrTotalBaseRet>
          <vlrTotalRetPrinc>${xmlMoney(document.retentions.inss)}</vlrTotalRetPrinc>
          <nfs>
            <serie>${escapeXml(document.series)}</serie>
            <numDocto>${escapeXml(document.number)}</numDocto>
            <dtEmissaoNF>${escapeXml(document.issueDate)}</dtEmissaoNF>
            <vlrBruto>${xmlMoney(document.grossValue)}</vlrBruto>
            <infoTpServ>
              <tpServico>${escapeXml(document.serviceType)}</tpServico>
              <vlrBaseRet>${xmlMoney(document.grossValue)}</vlrBaseRet>
              <vlrRetencao>${xmlMoney(document.retentions.inss)}</vlrRetencao>
            </infoTpServ>
          </nfs>
        </idePrestServ>
      </ideEstabObra>
    </infoServTom>
  </evtServTom>
</Reinf>`;
}

function buildR4020(
  document: ServiceDocument,
  contributorCnpj: string,
  period: string,
  environment: string,
  sequence: number,
): string {
  const contributorRoot = onlyDigits(contributorCnpj).slice(0, 8);
  const aggregate =
    document.retentions.pis +
    document.retentions.cofins +
    document.retentions.csll;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtRetPJ/v${REINF_VERSION}">
  <evtRetPJ id="${makeEventId(contributorCnpj, sequence)}">
    <ideEvento>
      <indRetif>1</indRetif>
      <perApur>${escapeXml(period)}</perApur>
      <tpAmb>${escapeXml(environment)}</tpAmb>
      <procEmi>1</procEmi>
      <verProc>${PROCESS_VERSION}</verProc>
    </ideEvento>
    <ideContri>
      <tpInsc>1</tpInsc>
      <nrInsc>${contributorRoot}</nrInsc>
    </ideContri>
    <ideEstab>
      <tpInscEstab>1</tpInscEstab>
      <nrInscEstab>${onlyDigits(contributorCnpj)}</nrInscEstab>
      <ideBenef>
        <cnpjBenef>${document.providerCnpj}</cnpjBenef>
        <idePgto>
          <natRend>${escapeXml(document.incomeNature)}</natRend>
          <dtFG>${escapeXml(document.eventDate)}</dtFG>
          <vlrBruto>${xmlMoney(document.grossValue)}</vlrBruto>
          <retencoes>
            <vlrBaseIR>${xmlMoney(document.grossValue)}</vlrBaseIR>
            <vlrIR>${xmlMoney(document.retentions.ir)}</vlrIR>
            <vlrBaseAgreg>${xmlMoney(document.grossValue)}</vlrBaseAgreg>
            <vlrAgreg>${xmlMoney(aggregate)}</vlrAgreg>
          </retencoes>
        </idePgto>
      </ideBenef>
    </ideEstab>
  </evtRetPJ>
</Reinf>`;
}

function downloadXml(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReinfGenerator() {
  const [documents, setDocuments] = useState<ServiceDocument[]>([]);
  const [problems, setProblems] = useState<ImportProblem[]>([]);
  const [contributorCnpj, setContributorCnpj] = useState("");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [environment, setEnvironment] = useState("2");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(
    () =>
      documents.reduce(
        (result, document) => ({
          gross: result.gross + document.grossValue,
          inss: result.inss + document.retentions.inss,
          federal: result.federal + totalFederal(document),
          retained:
            result.retained + document.retentions.inss + totalFederal(document),
        }),
        { gross: 0, inss: 0, federal: 0, retained: 0 },
      ),
    [documents],
  );

  const validContributor = onlyDigits(contributorCnpj).length === 14;

  async function importFiles(files: FileList | null) {
    if (!files) return;
    const imported: ServiceDocument[] = [];
    const importProblems: ImportProblem[] = [];

    for (const file of Array.from(files)) {
      try {
        const document = parseServiceXml(await file.text(), file.name);
        imported.push(document);
      } catch (error) {
        importProblems.push({
          fileName: file.name,
          message: error instanceof Error ? error.message : "Falha ao ler o XML.",
        });
      }
    }

    setDocuments((current) => [...current, ...imported]);
    setProblems(importProblems);
    if (!contributorCnpj) {
      const detectedCustomer = imported.find(
        (document) => document.customerCnpj.length === 14,
      )?.customerCnpj;
      if (detectedCustomer) setContributorCnpj(detectedCustomer);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function updateDocument(
    id: string,
    field: "serviceType" | "incomeNature" | "eventDate",
    value: string,
  ) {
    setDocuments((current) =>
      current.map((document) =>
        document.id === id ? { ...document, [field]: value } : document,
      ),
    );
  }

  function downloadEvent(document: ServiceDocument, type: "R2010" | "R4020") {
    if (!validContributor) return;
    const sequence = documents.findIndex((item) => item.id === document.id) + 1;
    const safeNumber = document.number.replace(/[^\w-]/g, "_");
    if (type === "R2010") {
      downloadXml(
        `R-2010_${safeNumber}.xml`,
        buildR2010(
          document,
          contributorCnpj,
          period,
          environment,
          sequence,
        ),
      );
      return;
    }
    downloadXml(
      `R-4020_${safeNumber}.xml`,
      buildR4020(
        document,
        contributorCnpj,
        period,
        environment,
        sequence,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto pb-6">
      <Alert>
        <Info />
        <AlertTitle>O XML identifica valores, não toda a obrigação fiscal</AlertTitle>
        <AlertDescription>
          Nem toda NFS-e tem retenção. O sistema considera somente valores
          destacados no XML e exige a classificação fiscal antes de preparar os
          eventos. Confirme os dados com o responsável fiscal.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="text-primary" />
            Gerador EFD-Reinf
          </CardTitle>
          <CardDescription>
            Serviços tomados: retenção previdenciária R-2010 e retenções
            federais R-4020.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="reinf-cnpj">CNPJ do declarante</Label>
            <Input
              id="reinf-cnpj"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              value={contributorCnpj}
              onChange={(event) => setContributorCnpj(event.target.value)}
              aria-invalid={Boolean(contributorCnpj) && !validContributor}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reinf-period">Período de apuração</Label>
            <Input
              id="reinf-period"
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Ambiente</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">Produção restrita (testes)</SelectItem>
                <SelectItem value="1">Produção</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              multiple
              onChange={(event) => void importFiles(event.target.files)}
              className="sr-only"
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-auto w-full flex-col border-dashed py-8"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              Importar XMLs de NFS-e
              <span className="text-xs font-normal text-muted-foreground">
                É possível selecionar vários arquivos de municípios diferentes
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {problems.length > 0 && (
        <Alert variant="destructive">
          <FileWarning />
          <AlertTitle>Alguns arquivos não foram importados</AlertTitle>
          <AlertDescription>
            {problems.map((problem) => (
              <p key={problem.fileName}>
                {problem.fileName}: {problem.message}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {documents.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Notas importadas", String(documents.length)],
              ["Valor dos serviços", formatMoney(totals.gross)],
              ["INSS identificado", formatMoney(totals.inss)],
              ["Retenções federais", formatMoney(totals.federal)],
            ].map(([label, value]) => (
              <Card key={label} className="gap-2">
                <CardHeader className="pb-0">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle>{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Conferência e classificação</CardTitle>
              <CardDescription>
                Os códigos de tipo de serviço e natureza do rendimento não são
                determinados com segurança pela NFS-e.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nota / prestador</TableHead>
                    <TableHead>Valores identificados</TableHead>
                    <TableHead>Classificação fiscal</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => {
                    const status = eventStatus(document);
                    const hasInss = document.retentions.inss > 0;
                    const hasFederal = totalFederal(document) > 0;
                    return (
                      <TableRow key={document.id}>
                        <TableCell className="min-w-56 whitespace-normal">
                          <p className="font-medium">NFS-e {document.number}</p>
                          <p className="text-xs text-muted-foreground">
                            {document.providerName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            CNPJ {document.providerCnpj || "não identificado"} ·{" "}
                            {document.issueDate || "data não identificada"}
                          </p>
                        </TableCell>
                        <TableCell className="min-w-44 whitespace-normal">
                          <p>Serviço: {formatMoney(document.grossValue)}</p>
                          <p className="text-xs text-muted-foreground">
                            INSS: {formatMoney(document.retentions.inss)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            IR/PIS/COFINS/CSLL:{" "}
                            {formatMoney(totalFederal(document))}
                          </p>
                          {document.otherRetention > 0 && (
                            <p className="text-xs text-destructive">
                              Outras retenções:{" "}
                              {formatMoney(document.otherRetention)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="min-w-64 whitespace-normal">
                          <div className="grid gap-2">
                            {hasInss && (
                              <Input
                                aria-label={`Tipo de serviço da nota ${document.number}`}
                                placeholder="Código tpServico (Tabela 06)"
                                value={document.serviceType}
                                onChange={(event) =>
                                  updateDocument(
                                    document.id,
                                    "serviceType",
                                    event.target.value,
                                  )
                                }
                              />
                            )}
                            {hasFederal && (
                              <>
                                <Input
                                  aria-label={`Natureza do rendimento da nota ${document.number}`}
                                  placeholder="Código natRend (Tabela 01)"
                                  value={document.incomeNature}
                                  onChange={(event) =>
                                    updateDocument(
                                      document.id,
                                      "incomeNature",
                                      event.target.value,
                                    )
                                  }
                                />
                                <Input
                                  aria-label={`Data do fato gerador da nota ${document.number}`}
                                  type="date"
                                  value={document.eventDate}
                                  onChange={(event) =>
                                    updateDocument(
                                      document.id,
                                      "eventDate",
                                      event.target.value,
                                    )
                                  }
                                />
                              </>
                            )}
                            {!hasInss && !hasFederal && (
                              <span className="text-xs text-muted-foreground">
                                Nenhum evento será gerado.
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            {hasInss && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !validContributor ||
                                  !document.serviceType ||
                                  !document.issueDate ||
                                  document.providerCnpj.length !== 14
                                }
                                onClick={() => downloadEvent(document, "R2010")}
                              >
                                <Download />
                                R-2010
                              </Button>
                            )}
                            {hasFederal && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !validContributor ||
                                  !document.incomeNature ||
                                  !document.eventDate ||
                                  document.providerCnpj.length !== 14
                                }
                                onClick={() => downloadEvent(document, "R4020")}
                              >
                                <Download />
                                R-4020
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Excluir nota ${document.number}`}
                              onClick={() =>
                                setDocuments((current) =>
                                  current.filter(
                                    (item) => item.id !== document.id,
                                  ),
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Alert>
            {totals.retained > 0 ? <CheckCircle2 /> : <AlertCircle />}
            <AlertTitle>Prévia XML sem assinatura digital</AlertTitle>
            <AlertDescription>
              O arquivo baixado é uma prévia técnica individual do evento. Antes
              do envio, valide no leiaute vigente da Receita Federal, agrupe
              eventos quando aplicável, assine com certificado digital e
              transmita pelo Web Service da EFD-Reinf.
            </AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}
