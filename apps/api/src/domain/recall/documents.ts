import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, relative, sep } from "node:path";

/** ADR-006 §7: the folder Zara indexes — default Documents\Zara, with notes in its Notes subfolder. */
export function defaultDocumentsFolder(): string {
  // Override for tests, so they never touch the real Documents folder.
  return process.env.ZARA_DOCUMENTS_FOLDER || join(homedir(), "Documents", "Zara");
}

export const NOTES_SUBFOLDER = "Notes";
export const DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".pdf", ".docx"]);
/** Bigger files are skipped — this is for the user's own notes and papers, not archives. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2000;

export interface FolderFile {
  /** Relative to the folder, with forward slashes — the stable id in the index. */
  relativePath: string;
  absolutePath: string;
  isNote: boolean;
  /** Size + modified time — changes when the file does. */
  fingerprint: string;
  modifiedAt: Date;
}

/** Creates the folder (and Notes/) if missing, so the user has somewhere to drop files. */
export async function ensureDocumentsFolder(folder: string): Promise<void> {
  await mkdir(join(folder, NOTES_SUBFOLDER), { recursive: true });
}

/** Every supported file under the folder (hidden files/folders skipped). */
export async function listDocumentFiles(folder: string): Promise<FolderFile[]> {
  const files: FolderFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES || entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const info = await stat(absolutePath).catch(() => null);
        if (!info || info.size > MAX_FILE_BYTES) continue;
        const relativePath = relative(folder, absolutePath).split(sep).join("/");
        files.push({
          relativePath,
          absolutePath,
          isNote: relativePath.toLowerCase().startsWith(`${NOTES_SUBFOLDER.toLowerCase()}/`),
          fingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}`,
          modifiedAt: info.mtime,
        });
      }
    }
  }
  await walk(folder);
  return files;
}

/** Plain text of a supported file. PDF (text layer only — scanned images are out of scope) and Word via pure-JS parsers. */
export async function readDocumentText(absolutePath: string): Promise<string> {
  const extension = extname(absolutePath).toLowerCase();
  if (extension === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(absolutePath)));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : text;
  }
  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: await readFile(absolutePath) });
    return value;
  }
  return readFile(absolutePath, "utf-8");
}

/** "Budget plan" from "Notes/budget plan.md". */
export function titleFromPath(relativePath: string): string {
  const name = relativePath.split("/").pop() ?? relativePath;
  return name.replace(/\.[^.]+$/, "");
}
