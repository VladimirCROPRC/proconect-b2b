export type StoredProjectFile = {
  id: string;
  projectId: string;
  section: string;
  category: string;
  name: string;
  contentType: string;
  size: number;
  geo: string;
  capturedAt: number;
  uploadedBy: string;
  url: string;
};

export async function uploadProjectFile(input: {
  projectId: string;
  section: string;
  category: string;
  file: File;
  geo?: string;
}): Promise<StoredProjectFile> {
  const form = new FormData();
  form.set("projectId", input.projectId);
  form.set("section", input.section);
  form.set("category", input.category);
  form.set("file", input.file, input.file.name);
  if (input.geo) form.set("geo", input.geo);

  const response = await fetch("/api/files", { method: "POST", credentials: "same-origin", body: form });
  const payload = (await response.json()) as { file?: StoredProjectFile; error?: string };
  if (!response.ok || !payload.file) throw new Error(payload.error || "Fișierul nu a putut fi încărcat.");
  return payload.file;
}

export async function fetchProjectFiles(projectId: string, section?: string): Promise<StoredProjectFile[]> {
  const params = new URLSearchParams({ projectId });
  if (section) params.set("section", section);
  const response = await fetch(`/api/files?${params.toString()}`, { credentials: "same-origin", cache: "no-store" });
  const payload = (await response.json()) as { files?: StoredProjectFile[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Fișierele nu sunt disponibile.");
  return payload.files ?? [];
}

export async function deleteProjectFile(fileId: string) {
  const response = await fetch("/api/files", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Fișierul nu a putut fi șters.");
}

export function formatCapturedAt(timestamp: number) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
