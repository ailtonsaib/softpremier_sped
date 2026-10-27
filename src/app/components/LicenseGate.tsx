import { useCallback, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  activateLicense,
  clearActivation,
  getCachedActivation,
  isWithinOfflineGrace,
  validateLicense,
  type LicenseActivation,
  type LicensedProduct,
} from "../services/licensing";
import { hasOwnerAccess } from "../services/auth";

const PRODUCT_NAMES: Record<LicensedProduct, string> = {
  bingo: "Bingo Eletrônico",
  sped: "Validador de SPEDs",
  erp: "MasterERP",
};

export function LicenseGate({
  product,
  children,
}: {
  product: LicensedProduct;
  children: React.ReactNode;
}) {
  const [activation, setActivation] = useState<LicenseActivation | null>(null);
  const [checking, setChecking] = useState(!import.meta.env.DEV);
  const [offline, setOffline] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);
  const [ownerAccess, setOwnerAccess] = useState(false);

  const checkLicense = useCallback(async () => {
    const cached = getCachedActivation(product);
    if (!cached) {
      setChecking(false);
      return;
    }
    try {
      const valid = await validateLicense(product, cached);
      setActivation(valid);
      setOffline(false);
      setError("");
    } catch (validationError) {
      if (isWithinOfflineGrace(cached)) {
        setActivation(cached);
        setOffline(true);
      } else {
        clearActivation(product);
        setActivation(null);
        setError(
          validationError instanceof Error
            ? validationError.message
            : "Não foi possível validar a licença.",
        );
      }
    } finally {
      setChecking(false);
    }
  }, [product]);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    void hasOwnerAccess().then(isOwner => {
      if (isOwner) {
        setOwnerAccess(true);
        setChecking(false);
      } else {
        void checkLicense();
      }
    });
    const heartbeat = window.setInterval(
      () => {
        if (!ownerAccess) void checkLicense();
      },
      5 * 60 * 1000,
    );
    return () => window.clearInterval(heartbeat);
  }, [checkLicense, ownerAccess]);

  if (import.meta.env.DEV) return children;

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          <span>Validando licença...</span>
        </div>
      </div>
    );
  }

  if (activation || ownerAccess) {
    return (
      <>
        {offline && (
          <Alert className="rounded-none border-x-0 border-t-0">
            <WifiOff />
            <AlertTitle>Funcionamento offline</AlertTitle>
            <AlertDescription>
              A licença será validada novamente quando a conexão retornar.
            </AlertDescription>
          </Alert>
        )}
        {children}
      </>
    );
  }

  const handleActivation = async () => {
    if (!licenseKey.trim()) return;
    setActivating(true);
    setError("");
    try {
      const result = await activateLicense(product, licenseKey);
      setActivation(result);
      setLicenseKey("");
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Não foi possível ativar a licença.",
      );
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LockKeyhole />
          </div>
          <CardTitle className="text-xl">
            Ativar {PRODUCT_NAMES[product]}
          </CardTitle>
          <CardDescription>
            Informe a chave fornecida na contratação. Cada ativação utiliza uma
            vaga de dispositivo da licença.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível ativar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="license-key">
              Chave de licença
            </Label>
            <Input
              id="license-key"
              value={licenseKey}
              onChange={event => setLicenseKey(event.target.value.toUpperCase())}
              onKeyDown={event => {
                if (event.key === "Enter") void handleActivation();
              }}
              placeholder={`${product.toUpperCase()}-XXXXX-XXXXX-XXXXX-XXXXX`}
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={activating || !licenseKey.trim()}
            onClick={handleActivation}
          >
            {activating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <KeyRound />
            )}
            Ativar nesta máquina
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            A licença será vinculada a este dispositivo.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
