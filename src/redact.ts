export interface RedactionResult {
  text: string;
  redacted: boolean;
}

const ENV_SECRET_RE =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*)(?:"[\s\S]*?"|'[\s\S]*?'|[^\s'",;}]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactSecrets(text: string): RedactionResult {
  let redacted = false;

  const safeText = text
    .replace(ENV_SECRET_RE, (_match, prefix: string) => {
      redacted = true;
      return `${prefix}[REDACTED]`;
    })
    .replace(BEARER_RE, () => {
      redacted = true;
      return "Bearer [REDACTED]";
    });

  return { text: safeText, redacted };
}
