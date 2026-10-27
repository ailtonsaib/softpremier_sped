import { useState } from "react";
import { ArrowLeft, FileSearch, Receipt, MapPin, ChevronRight, FileCode2 } from "lucide-react";
import { SpedFiscalValidator } from "./SpedFiscalValidator";
import { SpedContribValidator } from "./SpedContribValidator";
import { DimeGenerator } from "./DimeGenerator";
import { ReinfGenerator } from "./ReinfGenerator";

type Tool = "fiscal" | "contrib" | "dime" | "reinf" | null;

interface ToolDef {
  id: Tool;
  label: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  badge?: string;
  badgeColor?: string;
}

const TOOLS: ToolDef[] = [
  {
    id: "fiscal",
    label: "Validador SPED Fiscal",
    subtitle: "EFD ICMS / IPI",
    description: "Valida estrutura, registros obrigatórios, CNPJ, datas, CFOP, CST ICMS, e aritmética da apuração E110.",
    icon: <FileSearch size={24} strokeWidth={1.75} />,
    gradient: "from-blue-500 to-indigo-600",
    badge: "Receita Federal",
    badgeColor: "bg-blue-100 text-blue-700",
  },
  {
    id: "contrib",
    label: "Validador SPED Contribuições",
    subtitle: "EFD PIS / COFINS",
    description: "Valida estrutura, CST PIS/COFINS, CFOP, aritmética dos registros M200 e M600 (apuração PIS/COFINS).",
    icon: <Receipt size={24} strokeWidth={1.75} />,
    gradient: "from-emerald-500 to-teal-600",
    badge: "Receita Federal",
    badgeColor: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "dime",
    label: "Gerador DIME-SC",
    subtitle: "Declaração ICMS — Santa Catarina",
    description: "Extrai dados do SPED Fiscal e preenche automaticamente os Quadros 02 (ICMS Próprio), 03 (ICMS-ST) e 05 (Mov. Econômica).",
    icon: <MapPin size={24} strokeWidth={1.75} />,
    gradient: "from-orange-500 to-amber-500",
    badge: "Exclusivo SC",
    badgeColor: "bg-orange-100 text-orange-700",
  },
  {
    id: "reinf",
    label: "Gerador EFD-Reinf",
    subtitle: "Serviços tomados — R-2010 e R-4020",
    description: "Importa XMLs de NFS-e, identifica retenções destacadas e prepara os eventos de serviços tomados para conferência.",
    icon: <FileCode2 size={24} strokeWidth={1.75} />,
    gradient: "from-violet-500 to-purple-600",
    badge: "Receita Federal",
    badgeColor: "bg-violet-100 text-violet-700",
  },
];

interface Props {
  onBack: () => void;
}

export function SpedApp({ onBack }: Props) {
  const [tool, setTool] = useState<Tool>(null);
  const activeTool = TOOLS.find(t => t.id === tool);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #e8f4f0 50%, #fff7ed 100%)" }}
    >
      {/* ── Top bar ── */}
      <header className="bg-white/80 backdrop-blur border-b border-gray-200 flex-shrink-0">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={tool ? () => setTool(null) : onBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} />
            {tool ? "Ferramentas" : "Meus Sistemas"}
          </button>

          {activeTool && (
            <>
              <ChevronRight size={14} className="text-gray-300" />
              <div className="flex items-center gap-2">
                <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${activeTool.gradient} flex items-center justify-center text-white`}>
                  {activeTool.icon}
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-800 leading-none">{activeTool.label}</p>
                  <p className="text-[10px] text-gray-400">{activeTool.subtitle}</p>
                </div>
              </div>
            </>
          )}

          {!activeTool && (
            <>
              <ChevronRight size={14} className="text-gray-300" />
              <div>
                <p className="text-sm font-bold text-gray-800 leading-none">Validador de SPEDs</p>
                <p className="text-[10px] text-gray-400">Selecione uma ferramenta</p>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Tool selector ── */}
      {!tool && (
        <main className="flex-1 flex items-start justify-center px-4 py-10">
          <div className="w-full max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Ferramentas SPED</h2>
              <p className="text-gray-500 text-sm">Selecione o módulo para começar</p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTool(t.id)}
                  className="flex items-center gap-5 bg-white border border-gray-200 rounded-2xl p-5 text-left hover:border-gray-400 hover:shadow-md transition-all group"
                >
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${t.gradient} flex items-center justify-center text-white flex-shrink-0 shadow-md`}>
                    {t.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="font-bold text-gray-800">{t.label}</p>
                      {t.badge && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.badgeColor}`}>{t.badge}</span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{t.subtitle}</p>
                    <p className="text-sm text-gray-500 leading-relaxed">{t.description}</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* ── Active tool ── */}
      {tool && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 flex flex-col overflow-hidden">
            {tool === "fiscal"  && <SpedFiscalValidator />}
            {tool === "contrib" && <SpedContribValidator />}
            {tool === "dime"    && <DimeGenerator />}
            {tool === "reinf"   && <ReinfGenerator />}
          </div>
        </div>
      )}
    </div>
  );
}
