// Təhlükəsizlik siyasəti: risk səviyyələri və icazələr bir yerdə.
// Alətlər, təsdiq mərkəzi və testlər buradan oxuyur. Kodun içinə səpələnmir.

export const RISKS = ["low", "medium", "high"];

// Risk səviyyəsinə görə təsdiq tələbi. "low" olmayan alət həmişə təsdiq gözləyir.
export const RISK_POLICY = {
  low: { approval: false },
  medium: { approval: true },
  high: { approval: true },
};

// Alətlərə standart verilən icazələr (yalnız oxuma və daxili bilik bazası).
export const DEFAULT_PERMISSIONS = ["read.web", "read.knowledge", "write.knowledge"];

// Bu icazələrdən birinə sahib alət həmişə "high" riskdədir və təsdiqsiz işləmir.
export const APPROVAL_ONLY_PERMISSIONS = [
  "publish.social",
  "send.message",
  "spend.money",
  "delete.data",
  "deploy.code",
  "change.price",
  "change.stock",
  "place.order",
  "edit.video",
  "edit.product",
];

// Heç bir alətə verilmir: JARVIS özü açarı oxuya və ya dəyişə bilməz.
export const FORBIDDEN_PERMISSIONS = ["read.secrets", "change.apikey"];

// Təsdiq qeydinin saxlanma və etibarlılıq müddəti
export const APPROVAL_TTL_DAYS = 7;
