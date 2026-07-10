export type CloudHomeTheme = "noir" | "oled";

export function serviceUrl(
  hostname: string,
  localPort: number,
  tailnetPort: number,
  secure: boolean,
): string {
  return `${secure ? "https" : "http"}://${hostname}:${secure ? tailnetPort : localPort}`;
}

export function serviceHref(
  hostname: string,
  localPort: number,
  tailnetPort: number,
  secure: boolean,
  tailnetPath = "",
): string {
  return `${serviceUrl(hostname, localPort, tailnetPort, secure)}${secure ? tailnetPath : ""}`;
}

export function readTheme(cookie: string): CloudHomeTheme {
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("cloud-home_theme="))
    ?.split("=")[1];
  return value === "oled" ? "oled" : "noir";
}

export function writeTheme(theme: CloudHomeTheme, secure: boolean): string {
  return [
    `cloud-home_theme=${theme}`,
    "Path=/",
    "Max-Age=31536000",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function applyTheme(theme: CloudHomeTheme): void {
  document.documentElement.dataset.theme = theme;
  document.cookie = writeTheme(theme, window.location.protocol === "https:");
}
