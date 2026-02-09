/**
 * Chrome extension installer - Downloads and extracts extensions from Chrome Web Store
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import AdmZip from "adm-zip";

const EXTENSIONS_DIR = path.join(os.homedir(), ".ultimate-playwright-mcp", "extensions");
const CHROME_VERSION = "120.0.0.0"; // Hardcoded version that works for most extensions

/**
 * Check if a string is a Chrome Web Store extension ID (32 lowercase letters)
 */
export function isChromeStoreId(str: string): boolean {
  return /^[a-z]{32}$/.test(str);
}

/**
 * Strip CRX header from buffer to get the ZIP content
 * CRX format: "Cr24" magic + version + header length + header + ZIP
 */
function stripCrxHeader(crxBuffer: Buffer): Buffer {
  // Check for CRX magic number "Cr24"
  if (crxBuffer.toString("utf8", 0, 4) !== "Cr24") {
    throw new Error("Invalid CRX file: missing magic number");
  }

  // Read version (4 bytes at offset 4)
  const version = crxBuffer.readUInt32LE(4);

  if (version === 2) {
    // CRX2 format: magic(4) + version(4) + pubkey_len(4) + sig_len(4) + pubkey + sig + ZIP
    const pubkeyLen = crxBuffer.readUInt32LE(8);
    const sigLen = crxBuffer.readUInt32LE(12);
    const headerSize = 16 + pubkeyLen + sigLen;
    return crxBuffer.subarray(headerSize);
  } else if (version === 3) {
    // CRX3 format: magic(4) + version(4) + header_len(4) + header + ZIP
    const headerLen = crxBuffer.readUInt32LE(8);
    const headerSize = 12 + headerLen;
    return crxBuffer.subarray(headerSize);
  } else {
    throw new Error(`Unsupported CRX version: ${version}`);
  }
}

/**
 * Get the local path for an extension (either downloaded or direct path)
 */
export async function resolveExtensionPath(extensionIdOrPath: string): Promise<string> {
  // If it's a local path that exists, use it directly
  if (fs.existsSync(extensionIdOrPath)) {
    return extensionIdOrPath;
  }

  // If it's a Chrome Web Store ID, download it
  if (isChromeStoreId(extensionIdOrPath)) {
    return await downloadExtension(extensionIdOrPath);
  }

  throw new Error(
    `Invalid extension: "${extensionIdOrPath}". ` +
    `Must be either a valid file path or a 32-character Chrome Web Store ID.`
  );
}

/**
 * Download and extract a Chrome extension from the Web Store
 */
async function downloadExtension(extensionId: string): Promise<string> {
  // Ensure extensions directory exists
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }

  const extensionDir = path.join(EXTENSIONS_DIR, extensionId);

  // If already downloaded, return the path
  if (fs.existsSync(extensionDir)) {
    console.error(`Extension ${extensionId} already downloaded`);
    return extensionDir;
  }

  console.error(`Downloading extension ${extensionId} from Chrome Web Store...`);

  // Build CRX download URL
  const crxUrl =
    `https://clients2.google.com/service/update2/crx?` +
    `response=redirect&prodversion=${CHROME_VERSION}&acceptformat=crx2,crx3&` +
    `x=id%3D${extensionId}%26uc`;

  try {
    // Download CRX file
    const response = await fetch(crxUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    // Save to temporary file
    const tempCrxPath = path.join(EXTENSIONS_DIR, `${extensionId}.crx`);
    const fileStream = createWriteStream(tempCrxPath);

    if (!response.body) {
      throw new Error("No response body");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node fetch ReadableStream vs NodeJS.ReadableStream type mismatch
    await pipeline(response.body as any, fileStream);

    // Extract CRX file (remove CRX header first)
    console.error(`Extracting extension ${extensionId}...`);
    const crxBuffer = fs.readFileSync(tempCrxPath);
    const zipBuffer = stripCrxHeader(crxBuffer);

    // Write stripped ZIP to temp file
    const tempZipPath = path.join(EXTENSIONS_DIR, `${extensionId}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);

    // Extract ZIP
    const zip = new AdmZip(tempZipPath);
    zip.extractAllTo(extensionDir, true);

    // Clean up temp files
    fs.unlinkSync(tempCrxPath);
    fs.unlinkSync(tempZipPath);

    console.error(`✓ Extension ${extensionId} installed to ${extensionDir}`);
    return extensionDir;
  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(extensionDir)) {
      fs.rmSync(extensionDir, { recursive: true });
    }

    throw new Error(
      `Failed to download extension ${extensionId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Resolve multiple extensions (mix of IDs and paths)
 */
export async function resolveExtensions(extensionsIdOrPaths: string[]): Promise<string[]> {
  const resolved: string[] = [];

  for (const item of extensionsIdOrPaths) {
    try {
      const path = await resolveExtensionPath(item);
      resolved.push(path);
    } catch (error) {
      console.error(`Warning: ${error instanceof Error ? error.message : String(error)}`);
      // Continue with other extensions even if one fails
    }
  }

  return resolved;
}
