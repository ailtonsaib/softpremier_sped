import { projectId, publicAnonKey } from "../../../utils/supabase/info";

export type LicensedProduct = "bingo" | "sped" | "erp";
export type BingoPlanId = "trial" | "bronze" | "silver" | "gold";

export interface BingoPlan {
  id: BingoPlanId;
  name: string;
  price: number;
  maxCardsPerEvent: number | null;
  trialDays: number | null;
  sellerApp: boolean;
  buyerApp: boolean;
  display: boolean;
}

export interface LicenseInfo {
  id: string;
  customerName: string;
  product: LicensedProduct;
  expiresAt: string | null;
  offlineGraceDays: number;
  maxDevices: number;
  plan?: BingoPlanId;
  price?: number;
}

export interface DeviceActivation {
  id: string;
  deviceId: string;
  deviceName: string;
  activatedAt: string;
  lastSeenAt: string;
}

export interface ActivationResponse {
  activationToken?: string;
  license: LicenseInfo;
  activation: DeviceActivation;
}

export interface LicenseActivation extends ActivationResponse {
  activationToken: string;
  lastValidatedAt: string;
}

export interface AdminLicense extends LicenseInfo {
  customerEmail: string;
  kind: "trial" | "paid";
  status: "active" | "blocked";
  createdAt: string;
  updatedAt?: string;
  activations: Array<
    DeviceActivation & {
      status: "active";
      product: LicensedProduct;
    }
  >;
  licenseKey?: string;
}

const API_URL =
  `https://${projectId}.supabase.co/functions/v1/make-server-f2d7d378/bingo/license`;
const DEVICE_KEY = "commercial:device-id";

async function request<T>(
  path: string,
  init?: RequestInit,
  adminToken?: string,
): Promise<T> {
  let ownerToken = "";
  if (adminToken === "__owner__") {
    try {
      ownerToken =
        JSON.parse(localStorage.getItem("bingo:session") || "{}")
          .access_token || "";
    } catch {
      ownerToken = "";
    }
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ownerToken || publicAnonKey}`,
      "Content-Type": "application/json",
      ...(adminToken && adminToken !== "__owner__"
        ? { "X-Admin-Token": adminToken }
        : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Falha no licenciamento (${response.status})`);
  }
  return payload;
}

function isTauriDesktop() {
  return "__TAURI_INTERNALS__" in window;
}

export async function getDeviceId(): Promise<string> {
  if (isTauriDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("device_installation_id");
  }
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

export async function getDeviceName(): Promise<string> {
  if (isTauriDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("device_name");
  }
  return `${navigator.platform || "Navegador"} · ${navigator.userAgent
    .split(" ")
    .slice(-1)[0]}`;
}

const activationCacheKey = (product: LicensedProduct) =>
  `commercial:activation:${product}`;

export function getCachedActivation(
  product: LicensedProduct,
): LicenseActivation | null {
  try {
    const value = localStorage.getItem(activationCacheKey(product));
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function cacheActivation(
  product: LicensedProduct,
  activation: LicenseActivation,
) {
  localStorage.setItem(
    activationCacheKey(product),
    JSON.stringify(activation),
  );
}

export function clearActivation(product: LicensedProduct) {
  localStorage.removeItem(activationCacheKey(product));
}

export async function activateLicense(
  product: LicensedProduct,
  licenseKey: string,
) {
  const [deviceId, deviceName] = await Promise.all([
    getDeviceId(),
    getDeviceName(),
  ]);
  const result = await request<ActivationResponse>("/activate", {
    method: "POST",
    body: JSON.stringify({
      product,
      licenseKey,
      deviceId,
      deviceName,
    }),
  });
  if (!result.activationToken) {
    throw new Error("O servidor não retornou o token de ativação.");
  }
  const activation: LicenseActivation = {
    ...result,
    activationToken: result.activationToken,
    lastValidatedAt: new Date().toISOString(),
  };
  cacheActivation(product, activation);
  return activation;
}

export async function validateLicense(
  product: LicensedProduct,
  cached: LicenseActivation,
) {
  const [deviceId, deviceName] = await Promise.all([
    getDeviceId(),
    getDeviceName(),
  ]);
  const result = await request<ActivationResponse>("/validate", {
    method: "POST",
    body: JSON.stringify({
      product,
      activationToken: cached.activationToken,
      deviceId,
      deviceName,
    }),
  });
  const activation: LicenseActivation = {
    ...result,
    activationToken: cached.activationToken,
    lastValidatedAt: new Date().toISOString(),
  };
  cacheActivation(product, activation);
  return activation;
}

export function isWithinOfflineGrace(activation: LicenseActivation) {
  const elapsed =
    Date.now() - new Date(activation.lastValidatedAt).getTime();
  return elapsed <= activation.license.offlineGraceDays * 86_400_000;
}

export async function listAdminLicenses(adminToken: string) {
  return request<AdminLicense[]>("/admin/licenses", undefined, adminToken);
}

export async function createAdminLicense(
  adminToken: string,
  data: {
    customerName: string;
    customerEmail: string;
    product: LicensedProduct;
    maxDevices: number;
    expiresAt: string | null;
    offlineGraceDays: number;
    plan?: BingoPlanId;
  },
) {
  return request<AdminLicense>(
    "/admin/licenses",
    { method: "POST", body: JSON.stringify(data) },
    adminToken,
  );
}

export async function updateAdminLicense(
  adminToken: string,
  licenseId: string,
  updates: Partial<
    Pick<AdminLicense, "status" | "maxDevices" | "expiresAt" | "offlineGraceDays" | "plan">
  >,
) {
  return request<AdminLicense>(
    `/admin/licenses/${encodeURIComponent(licenseId)}`,
    { method: "PUT", body: JSON.stringify(updates) },
    adminToken,
  );
}

export async function listBingoPlans() {
  return request<BingoPlan[]>("/plans");
}

export async function listAdminBingoPlans(adminToken: string) {
  return request<BingoPlan[]>("/admin/plans", undefined, adminToken);
}

export async function updateAdminBingoPlans(
  adminToken: string,
  plans: BingoPlan[],
) {
  return request<BingoPlan[]>(
    "/admin/plans",
    { method: "PUT", body: JSON.stringify(plans) },
    adminToken,
  );
}

export async function removeAdminDevice(
  adminToken: string,
  licenseId: string,
  deviceId: string,
) {
  return request<{ success: boolean }>(
    `/admin/licenses/${encodeURIComponent(licenseId)}/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
    adminToken,
  );
}
