import { google } from "googleapis";
import { mapGoogleApiError } from "../google-api-error.js";
import { createGoogleOAuthService, type GoogleOAuthService } from "../oauth/google-oauth.service.js";

/** ADR-006 M8: read-only Google Drive (drive.readonly), built into the app. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  link: string | null;
}

export interface DriveService {
  search(refreshToken: string, query: string): Promise<DriveFile[]>;
  readText(refreshToken: string, fileId: string): Promise<{ name: string; text: string } | { name: string; unsupported: string }>;
}

const TEXT_LIMIT = 6000;
/** Google-native files are exported as text; plain text-like files are downloaded (≤ 1 MB). */
const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** Escapes a user's words for Drive's query language ('…' strings). */
export function driveQuery(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").slice(0, 200);
  return `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`;
}

export function createDriveService(dependencies?: { oauth?: GoogleOAuthService }): DriveService {
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();
  const client = (token: string) => google.drive({ version: "v3", auth: oauth.createAuthorizedClient(token) });

  return {
    async search(refreshToken, query) {
      try {
        const res = await client(refreshToken).files.list({
          q: driveQuery(query),
          pageSize: 10,
          orderBy: "modifiedTime desc",
          fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
        });
        return (res.data.files ?? []).map((file) => ({
          id: file.id ?? "",
          name: file.name ?? "(untitled)",
          mimeType: file.mimeType ?? "",
          modifiedTime: file.modifiedTime ?? null,
          link: file.webViewLink ?? null,
        }));
      } catch (err) {
        throw mapGoogleApiError(err, "Google Drive");
      }
    },

    async readText(refreshToken, fileId) {
      const drive = client(refreshToken);
      try {
        const meta = await drive.files.get({ fileId, fields: "name,mimeType,size" });
        const name = meta.data.name ?? "(untitled)";
        const mimeType = meta.data.mimeType ?? "";
        const exportType = EXPORTS[mimeType];
        let text: string;
        if (exportType) {
          const res = await drive.files.export({ fileId, mimeType: exportType }, { responseType: "text" });
          text = String(res.data ?? "");
        } else if (mimeType.startsWith("text/") || mimeType === "application/json") {
          if (Number(meta.data.size ?? 0) > 1_000_000) return { name, unsupported: "That file is too big to read here." };
          const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
          text = String(res.data ?? "");
        } else {
          return { name, unsupported: `Can't read this kind of file (${mimeType || "unknown"}) — open it in Drive instead.` };
        }
        return { name, text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text };
      } catch (err) {
        throw mapGoogleApiError(err, "Google Drive");
      }
    },
  };
}
