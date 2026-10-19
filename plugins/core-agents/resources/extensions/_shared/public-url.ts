import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AddressLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly { address: string; family: number }[]>;

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const blockedHostSuffixes = [".localhost", ".local", ".internal"];

/** Resolve and authorize one public HTTP(S) URL before network use. */
export async function assertPublicHttpUrl(
  input: string | URL,
  lookup: AddressLookup = nodeLookup,
): Promise<URL> {
  const url = input instanceof URL ? new URL(input.href) : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  if (url.username || url.password) throw new Error("URL credentials are not allowed");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.length === 0 ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Local or internal hostnames are not allowed");
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Hostname did not resolve");
  for (const { address } of addresses) {
    if (!isPublicAddress(address)) {
      throw new Error(`URL resolves to a non-public address: ${address}`);
    }
  }
  return url;
}

/** Fetch a public URL while revalidating every redirect target. */
export async function fetchPublicUrl(
  input: string | URL,
  init: RequestInit = {},
  dependencies: {
    lookup?: AddressLookup;
    fetch?: typeof fetch;
    maxRedirects?: number;
  } = {},
): Promise<Response> {
  const lookup = dependencies.lookup ?? nodeLookup;
  const fetchFn = dependencies.fetch ?? globalThis.fetch;
  const maxRedirects = dependencies.maxRedirects ?? 5;
  let current = await assertPublicHttpUrl(input, lookup);

  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchFn(current, { ...init, redirect: "manual" });
    if (!redirectStatuses.has(response.status)) return response;
    if (redirects >= maxRedirects) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect response has no Location header");
    current = await assertPublicHttpUrl(new URL(location, current), lookup);
  }
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPublicIpv4(mapped);
    const [high, low] = mapped.split(":").map((part) => Number.parseInt(part, 16));
    if (high !== undefined && low !== undefined && Number.isFinite(high) && Number.isFinite(low)) {
      return isPublicIpv4(
        `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`,
      );
    }
    return false;
  }
  if (normalized === "::" || normalized === "::1") return false;
  const first = Number.parseInt(normalized.split(":", 1)[0] ?? "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast ff00::/8
  if (normalized.startsWith("2001:db8:")) return false; // documentation
  return true;
}

function isPublicIpv4(address: string): boolean {
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}
