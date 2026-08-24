"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FoRouteSection } from "./fo-route-map";
import { FoSplicesSection } from "./fo-splices";
import { SiteOperationsSection } from "./site-operations";
import { ProjectDocumentsSection } from "./project-documents";
import { GoogleDriveSettings, type GoogleDriveStatus } from "./google-drive-settings";
import { fetchProjectFiles, formatCapturedAt, uploadProjectFile } from "./client-storage";
import { initialCpeCatalog, type ProjectRecord } from "./project-data";
import type { ClientFieldSummary, ProjectFieldDocumentation, RouteFieldSummary, SiteFieldSummary, SpliceFieldSummary } from "./field-documentation";

type View = "projects" | "team" | "cpe" | "drive" | "documents" | "client" | "route" | "splices" | "site";
type Modal = "project" | "edit-project" | "delete-project" | "account" | "cpe" | "edit-cpe" | null;
type ServiceType = "Internet" | "VPN" | "Internet+OL" | "OL";
type ClientPhotoKey = "report" | "speed" | "olTest" | "overview" | "detail" | "labels";

const proconectLogoUrl = "https://www.en.proconect.ro/wp-content/uploads/2021/05/logo-transparent.png";

type ClientPhoto = {
  id: string;
  name: string;
  geo: string;
  capturedAt: string;
};

const multipleClientPhotoKeys = new Set<ClientPhotoKey>(["report", "olTest"]);

const clientPhotoCatalog: Record<ClientPhotoKey, { title: string; description: string; badge: string }> = {
  report: {
    title: "Proces-verbal semnat",
    description: "Încarcă una sau mai multe fotografii cu documentul semnat.",
    badge: "PV",
  },
  speed: {
    title: "Test de viteză",
    description: "Rezultatul complet al testului pentru serviciul Internet.",
    badge: "NET",
  },
  olTest: {
    title: "Teste OL",
    description: "Încarcă toate fotografiile cu rezultatele testelor Optical Link.",
    badge: "OL",
  },
  overview: {
    title: "Ansamblu echipamente",
    description: "Cadru larg cu toate echipamentele instalate.",
    badge: "A",
  },
  detail: {
    title: "Detaliu echipamente",
    description: "Conexiuni, porturi și montajul echipamentelor.",
    badge: "D",
  },
  labels: {
    title: "Etichete",
    description: "Etichetele echipamentelor și ale conexiunilor să fie lizibile.",
    badge: "ET",
  },
};

type Project = ProjectRecord;

type Account = {
  username: string;
  name: string;
  role: "Admin" | "Manager" | "Coordonator" | "Tehnician";
  active: boolean;
  jobs: number;
};

type SignedInAccount = Account & { passwordResetRequired: boolean };

const initialAccounts: Account[] = [
  { username: "vladimir.carlan", name: "Vladimir", role: "Admin", active: true, jobs: 0 },
  { username: "vlad", name: "Vlad", role: "Tehnician", active: true, jobs: 4 },
];

const emptyProject: Project = {
  id: "",
  client: "",
  address: "",
  contact: "",
  phone: "",
  email: "",
  requirements: "",
  technician: "",
  cpe: "",
  sfp: false,
  mc: false,
  terminalBox: false,
  status: "Planificat",
  date: "",
  ipwo: "",
  splice: "",
};

const statusClass: Record<Project["status"], string> = {
  Planificat: "status status-blue",
  "În desfășurare": "status status-violet",
  "De verificat": "status status-amber",
  Finalizat: "status status-green",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Home() {
  const [authenticatedAccount, setAuthenticatedAccount] = useState<SignedInAccount | null>(null);
  const [checkingAuthentication, setCheckingAuthentication] = useState(true);
  const [authenticationPending, setAuthenticationPending] = useState(false);
  const [authenticationError, setAuthenticationError] = useState("");
  const [view, setView] = useState<View>("projects");
  const [modal, setModal] = useState<Modal>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [projectDeleting, setProjectDeleting] = useState(false);
  const [editingCpe, setEditingCpe] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [cpeList, setCpeList] = useState(initialCpeCatalog);
  const [cpeSearch, setCpeSearch] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Toate statusurile");
  const [selected, setSelected] = useState<Project | null>(null);
  const [toast, setToast] = useState("");
  const [ipwoName, setIpwoName] = useState("");
  const [spliceName, setSpliceName] = useState("");
  const [ipwoFile, setIpwoFile] = useState<File | null>(null);
  const [spliceFile, setSpliceFile] = useState<File | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectDataReady, setProjectDataReady] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [clientService, setClientService] = useState<ServiceType>("Internet");
  const [clientPhotos, setClientPhotos] = useState<Partial<Record<ClientPhotoKey, ClientPhoto[]>>>({});
  const [fieldDocumentation, setFieldDocumentation] = useState<Record<string, ProjectFieldDocumentation>>({});
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin" });
        const payload = (await response.json()) as { account?: SignedInAccount | null; error?: string };
        if (!response.ok) throw new Error(payload.error || "Autentificarea nu este disponibilă momentan.");
        if (mounted && payload.account) setAuthenticatedAccount(payload.account);
      } catch (error) {
        if (mounted) setAuthenticationError(error instanceof Error ? error.message : "Autentificarea nu este disponibilă momentan.");
      } finally {
        if (mounted) setCheckingAuthentication(false);
      }
    }

    void restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (authenticatedAccount?.role !== "Admin" || authenticatedAccount.passwordResetRequired) return;

    let mounted = true;
    async function loadAccounts() {
      try {
        const response = await fetch("/api/accounts", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const payload = (await response.json()) as { accounts?: Account[] };
        if (mounted && payload.accounts?.length) setAccounts(payload.accounts);
      } catch {
        // The authenticated session stays available if the account listing is temporarily unavailable.
      }
    }

    void loadAccounts();
    return () => {
      mounted = false;
    };
  }, [authenticatedAccount]);

  useEffect(() => {
    if (!authenticatedAccount || authenticatedAccount.passwordResetRequired || authenticatedAccount.role === "Tehnician") return;
    let mounted = true;
    fetch("/api/google-drive", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as GoogleDriveStatus;
        if (!mounted) return;
        setDriveStatus(payload);
        const query = new URLSearchParams(window.location.search);
        const driveResult = query.get("drive");
        const driveError = query.get("drive_error");
        if (driveResult || driveError) {
          setView("drive");
          showToast(driveError || "Contul Google Drive a fost conectat și proiectele sunt pregătite pentru sincronizare.");
          query.delete("drive");
          query.delete("drive_error");
          const suffix = query.toString();
          window.history.replaceState({}, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`);
        }
      })
      .catch(() => {
        // Existing project documentation remains available if Drive is temporarily unavailable.
      });
    return () => {
      mounted = false;
    };
  }, [authenticatedAccount]);

  useEffect(() => {
    if (!authenticatedAccount || authenticatedAccount.passwordResetRequired) return;

    let mounted = true;
    async function loadProjectData() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store", credentials: "same-origin" });
        const payload = (await response.json()) as {
          projects?: Project[];
          fieldDocumentation?: Record<string, ProjectFieldDocumentation>;
          cpe?: string[];
          error?: string;
        };
        if (!response.ok || !payload.projects) throw new Error(payload.error || "Proiectele nu sunt disponibile momentan.");
        if (!mounted) return;
        setProjects(payload.projects);
        setFieldDocumentation(payload.fieldDocumentation ?? {});
        setCpeList(payload.cpe ?? []);
        setClientService(payload.fieldDocumentation?.[payload.projects[0]?.id ?? ""]?.client?.service ?? "Internet");
        setActiveProjectId((current) => payload.projects!.some((project) => project.id === current) ? current : payload.projects![0]?.id ?? "");
        setProjectDataReady(true);
      } catch (error) {
        if (mounted) showToast(error instanceof Error ? error.message : "Proiectele nu au putut fi încărcate.");
      }
    }

    void loadProjectData();
    return () => {
      mounted = false;
    };
  }, [authenticatedAccount]);

  useEffect(() => {
    if (!authenticatedAccount || authenticatedAccount.passwordResetRequired || !activeProjectId || !projectDataReady) return;

    let mounted = true;
    fetchProjectFiles(activeProjectId, "client")
      .then((files) => {
        if (!mounted) return;
        const grouped: Partial<Record<ClientPhotoKey, ClientPhoto[]>> = {};
        for (const file of files) {
          const key = file.category as ClientPhotoKey;
          if (!(key in clientPhotoCatalog)) continue;
          const photo = { id: file.id, name: file.name, geo: file.geo || "GPS indisponibil", capturedAt: formatCapturedAt(file.capturedAt) };
          grouped[key] = multipleClientPhotoKeys.has(key) ? [...(grouped[key] ?? []), photo] : [photo];
        }
        setClientPhotos(grouped);
      })
      .catch(() => {
        // Previously saved project data remains available while file storage reconnects.
      });

    return () => {
      mounted = false;
    };
  }, [activeProjectId, authenticatedAccount, projectDataReady]);

  const technicians = accounts.filter((account) => account.role === "Tehnician" && account.active);
  const currentAccount = authenticatedAccount ?? accounts[0];
  const canManageDocuments = currentAccount?.role === "Admin" || currentAccount?.role === "Manager" || currentAccount?.role === "Coordonator";
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? emptyProject;
  const isDocumentationView = view === "client" || view === "route" || view === "splices" || view === "site";
  const isProjectView = isDocumentationView || view === "documents";
  const displayedAccountName = currentAccount.name;
  const displayedAccountRole = currentAccount.role;
  const activeFieldDocumentation = fieldDocumentation[activeProject.id] ?? {};
  const requiredClientPhotoKeys: ClientPhotoKey[] = [
    "report",
    ...(clientService === "Internet" || clientService === "Internet+OL" ? (["speed"] as ClientPhotoKey[]) : []),
    ...(clientService === "OL" || clientService === "Internet+OL" ? (["olTest"] as ClientPhotoKey[]) : []),
    "overview",
    "detail",
    "labels",
  ];
  const completedClientPhotos = requiredClientPhotoKeys.filter((key) => (clientPhotos[key]?.length ?? 0) > 0).length;
  const clientProgress = Math.round((completedClientPhotos / requiredClientPhotoKeys.length) * 100);
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesSearch =
        !query ||
        `${project.id} ${project.client} ${project.address} ${project.technician} ${project.requirements}`
          .toLowerCase()
          .includes(query);
      const matchesTechnician = currentAccount.role !== "Tehnician" || project.technician === currentAccount.name;
      return matchesSearch && matchesTechnician && (filter === "Toate statusurile" || project.status === filter);
    });
  }, [currentAccount.name, currentAccount.role, filter, projects, search]);
  const projectMetrics = useMemo(() => {
    const today = new Date();
    const day = String(today.getDate());
    const paddedDay = day.padStart(2, "0");
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const year = String(today.getFullYear());
    const shortMonth = new Intl.DateTimeFormat("ro-RO", { month: "short" }).format(today).replace(/\./g, "").toLocaleLowerCase("ro-RO");
    const longMonth = new Intl.DateTimeFormat("ro-RO", { month: "long" }).format(today).toLocaleLowerCase("ro-RO");

    function normalizedDate(label: string) {
      return label.trim().toLocaleLowerCase("ro-RO").replace(/\./g, "").replace(/\s+/g, " ");
    }

    function scheduledToday(label: string) {
      const normalized = normalizedDate(label);
      if (/^(astăzi|azi)\b/u.test(normalized)) return true;
      if ([`${day} ${shortMonth}`, `${paddedDay} ${shortMonth}`, `${day} ${longMonth}`, `${paddedDay} ${longMonth}`].some((value) => normalized.startsWith(value))) return true;
      return label.includes(`${year}-${month}-${paddedDay}`) || new RegExp(`(?:^|\\D)${paddedDay}[./-]${month}[./-]${year}(?:\\D|$)`).test(label);
    }

    function scheduledThisMonth(label: string) {
      if (scheduledToday(label)) return true;
      const normalized = normalizedDate(label);
      const explicitYear = normalized.match(/\b(20\d{2})\b/u)?.[1];
      if (explicitYear && explicitYear !== year) return false;
      if (new RegExp(`\\b(?:${shortMonth}|${longMonth})\\b`, "u").test(normalized)) return true;
      return label.includes(`${year}-${month}-`) || new RegExp(`(?:^|\\D)\\d{1,2}[./-]${month}[./-]${year}(?:\\D|$)`).test(label);
    }

    const plannedToday = projects.filter((project) => project.status === "Planificat" && scheduledToday(project.date));
    const scheduledHours = plannedToday
      .map((project) => project.date.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/u)?.[0] ?? "")
      .filter(Boolean)
      .map((hour) => hour.padStart(5, "0"))
      .sort();

    return {
      active: projects.filter((project) => project.status !== "Finalizat").length,
      plannedToday: plannedToday.length,
      firstScheduledHour: scheduledHours[0] ?? "",
      awaitingReview: projects.filter((project) => project.status === "De verificat").length,
      completedThisMonth: projects.filter((project) => project.status === "Finalizat" && scheduledThisMonth(project.date)).length,
    };
  }, [projects]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthenticationPending(true);
    setAuthenticationError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: String(form.get("username") || ""), password: String(form.get("password") || "") }),
      });
      const payload = (await response.json()) as { account?: SignedInAccount; error?: string };
      if (!response.ok || !payload.account) throw new Error(payload.error || "Autentificarea a eșuat.");
      setAuthenticatedAccount(payload.account);
      setView("projects");
    } catch (error) {
      setAuthenticationError(error instanceof Error ? error.message : "Autentificarea a eșuat.");
    } finally {
      setAuthenticationPending(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("passwordConfirmation") || "");

    if (password !== confirmation) {
      setAuthenticationError("Cele două parole nu coincid.");
      return;
    }

    setAuthenticationPending(true);
    setAuthenticationError("");
    try {
      const response = await fetch("/api/auth", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as { account?: SignedInAccount; error?: string };
      if (!response.ok || !payload.account) throw new Error(payload.error || "Parola nu a putut fi schimbată.");
      setAuthenticatedAccount(payload.account);
    } catch (error) {
      setAuthenticationError(error instanceof Error ? error.message : "Parola nu a putut fi schimbată.");
    } finally {
      setAuthenticationPending(false);
    }
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
    } finally {
      setAuthenticatedAccount(null);
      setProjectDataReady(false);
      setAuthenticationError("");
      setView("projects");
      setSelected(null);
      setModal(null);
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3600);
  }

  function closeModal() {
    setModal(null);
    setEditingProject(null);
    setDeletingProject(null);
    setDeleteConfirmation("");
    setEditingCpe("");
    setIpwoName("");
    setSpliceName("");
    setIpwoFile(null);
    setSpliceFile(null);
  }

  function openProjectEditor(project: Project) {
    setSelected(null);
    setEditingProject(project);
    setIpwoName(project.ipwo === "Fișier neîncărcat" ? "" : project.ipwo);
    setSpliceName(project.splice === "Fișier neîncărcat" ? "" : project.splice);
    setIpwoFile(null);
    setSpliceFile(null);
    setModal("edit-project");
  }

  function openProjectDeletion(project: Project) {
    setSelected(null);
    setDeletingProject(project);
    setDeleteConfirmation("");
    setModal("delete-project");
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawId = String(form.get("requestId") || "").replace(/^RID/i, "").trim();
    const id = `RID${rawId}`;
    if (projects.some((project) => project.id === id)) {
      showToast("Request ID există deja. Verifică numărul introdus.");
      return;
    }
    const project: Project = {
      id,
      client: String(form.get("client")),
      address: String(form.get("address")),
      contact: String(form.get("contact")),
      phone: String(form.get("phone")),
      email: String(form.get("email")),
      requirements: String(form.get("requirements")),
      technician: String(form.get("technician")),
      cpe: String(form.get("cpe")),
      sfp: form.get("sfp") === "on",
      mc: form.get("mc") === "on",
      terminalBox: form.get("terminalBox") === "on",
      status: "Planificat",
      date: "Astăzi",
      ipwo: ipwoName || "Fișier neîncărcat",
      splice: spliceName || "Fișier neîncărcat",
    };
    setProjectSaving(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const payload = (await response.json()) as { project?: Project; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "Proiectul nu a putut fi creat.");

      const uploadResults = await Promise.allSettled([
        ...(ipwoFile ? [uploadProjectFile({ projectId: id, section: "project", category: "ipwo", file: ipwoFile })] : []),
        ...(spliceFile ? [uploadProjectFile({ projectId: id, section: "project", category: "splice-diagram", file: spliceFile })] : []),
      ]);
      setProjects((current) => [payload.project!, ...current]);
      setActiveProjectId((current) => current || payload.project!.id);
      setAccounts((current) => current.map((account) => account.name === payload.project!.technician ? { ...account, jobs: account.jobs + 1 } : account));
      closeModal();
      const failedUploads = uploadResults.filter((result) => result.status === "rejected").length;
      showToast(failedUploads ? `${id} a fost salvat, dar ${failedUploads} fișier nu a putut fi încărcat.` : `${id} a fost salvat permanent și alocat tehnicianului.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Proiectul nu a putut fi creat.");
    } finally {
      setProjectSaving(false);
    }
  }

  async function saveProjectChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProject) return;
    const form = new FormData(event.currentTarget);
    const project: Project = {
      ...editingProject,
      client: String(form.get("client") || ""),
      address: String(form.get("address") || ""),
      contact: String(form.get("contact") || ""),
      phone: String(form.get("phone") || ""),
      email: String(form.get("email") || ""),
      requirements: String(form.get("requirements") || ""),
      technician: String(form.get("technician") || ""),
      cpe: String(form.get("cpe") || ""),
      sfp: form.get("sfp") === "on",
      mc: form.get("mc") === "on",
      terminalBox: form.get("terminalBox") === "on",
      status: String(form.get("status") || editingProject.status) as Project["status"],
      date: String(form.get("date") || editingProject.date),
      ipwo: ipwoFile ? ipwoName : editingProject.ipwo,
      splice: spliceFile ? spliceName : editingProject.splice,
    };

    setProjectSaving(true);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const payload = (await response.json()) as { project?: Project; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "Proiectul nu a putut fi actualizat.");

      const uploadResults = await Promise.allSettled([
        ...(ipwoFile ? [uploadProjectFile({ projectId: project.id, section: "project", category: "ipwo", file: ipwoFile })] : []),
        ...(spliceFile ? [uploadProjectFile({ projectId: project.id, section: "project", category: "splice-diagram", file: spliceFile })] : []),
      ]);
      setProjects((current) => current.map((item) => item.id === project.id ? payload.project! : item));
      if (editingProject.technician !== payload.project.technician) {
        setAccounts((current) => current.map((account) => {
          if (account.name === editingProject.technician) return { ...account, jobs: Math.max(0, account.jobs - 1) };
          if (account.name === payload.project!.technician) return { ...account, jobs: account.jobs + 1 };
          return account;
        }));
      }
      closeModal();
      const failedUploads = uploadResults.filter((result) => result.status === "rejected").length;
      showToast(failedUploads ? `${project.id} a fost actualizat, dar ${failedUploads} fișier nu a putut fi încărcat.` : `${project.id} a fost actualizat și salvat permanent.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Proiectul nu a putut fi actualizat.");
    } finally {
      setProjectSaving(false);
    }
  }

  async function removeProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deletingProject || deleteConfirmation.trim() !== deletingProject.id || projectDeleting) return;

    setProjectDeleting(true);
    try {
      const response = await fetch("/api/projects", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: deletingProject.id }),
      });
      const payload = (await response.json()) as { projectId?: string; cleanupFailures?: number; error?: string };
      if (!response.ok || !payload.projectId) throw new Error(payload.error || "Proiectul nu a putut fi șters.");

      const deletedId = payload.projectId;
      const remainingProjects = projects.filter((project) => project.id !== deletedId);
      setProjects(remainingProjects);
      setFieldDocumentation((current) => {
        const next = { ...current };
        delete next[deletedId];
        return next;
      });
      setAccounts((current) => current.map((account) => account.name === deletingProject.technician
        ? { ...account, jobs: Math.max(0, account.jobs - 1) }
        : account));
      if (activeProjectId === deletedId || !remainingProjects.length) {
        const nextProject = remainingProjects[0];
        setActiveProjectId(nextProject?.id ?? "");
        setClientService(nextProject ? fieldDocumentation[nextProject.id]?.client?.service ?? "Internet" : "Internet");
        setClientPhotos({});
      }
      setSelected(null);
      setView("projects");
      closeModal();

      if (driveStatus) {
        void fetch("/api/google-drive", { cache: "no-store", credentials: "same-origin" })
          .then(async (statusResponse) => {
            if (statusResponse.ok) setDriveStatus(await statusResponse.json() as GoogleDriveStatus);
          })
          .catch(() => {
            // Project deletion remains successful if the Drive status refresh is temporarily unavailable.
          });
      }

      showToast(payload.cleanupFailures
        ? `${deletedId} a fost șters; unele fișiere necesită curățare tehnică.`
        : `${deletedId} și documentația sa au fost șterse definitiv.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Proiectul nu a putut fi șters.");
    } finally {
      setProjectDeleting(false);
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username"));
    if (accounts.some((account) => account.username === username)) {
      showToast("Username-ul este deja folosit.");
      return;
    }
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          name: String(form.get("name")),
          role: String(form.get("role")),
          password: String(form.get("password")),
        }),
      });
      const payload = (await response.json()) as { account?: Account; error?: string };
      if (!response.ok || !payload.account) throw new Error(payload.error || "Contul nu a putut fi creat.");
      setAccounts((current) => [...current, payload.account!]);
      setModal(null);
      showToast(`Contul ${username} a fost creat.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Contul nu a putut fi creat.");
    }
  }

  async function addCpeByName(name: string) {
    if (!name || cpeList.includes(name)) {
      showToast("Echipamentul există deja sau denumirea este incompletă.");
      return;
    }
    try {
      const response = await fetch("/api/catalog", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as { name?: string; error?: string };
      if (!response.ok || !payload.name) throw new Error(payload.error || "Echipamentul nu a putut fi salvat.");
      setCpeList((current) => [...current, payload.name!]);
      showToast(`${payload.name} a fost salvat în catalogul CPE.`);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Echipamentul nu a putut fi salvat.");
      return false;
    }
  }

  async function createCpe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (await addCpeByName(String(form.get("cpeName")).trim())) closeModal();
  }

  async function saveCpeChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCpe) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("cpeName") || "").trim();
    try {
      const response = await fetch("/api/catalog", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previousName: editingCpe, name }),
      });
      const payload = (await response.json()) as { previousName?: string; name?: string; error?: string };
      if (!response.ok || !payload.name || !payload.previousName) throw new Error(payload.error || "Echipamentul nu a putut fi actualizat.");
      setCpeList((current) => current.map((item) => item === payload.previousName ? payload.name! : item));
      setProjects((current) => current.map((project) => project.cpe === payload.previousName ? { ...project, cpe: payload.name! } : project));
      setSelected((current) => current && current.cpe === payload.previousName ? { ...current, cpe: payload.name! } : current);
      closeModal();
      showToast(`${payload.name} a fost actualizat în catalog și în proiectele asociate.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Echipamentul nu a putut fi actualizat.");
    }
  }

  async function openProjectFile(projectId: string, category: "ipwo" | "splice-diagram") {
    try {
      const files = await fetchProjectFiles(projectId, "project");
      const file = [...files].reverse().find((item) => item.category === category);
      if (!file) throw new Error("Fișierul nu a fost încărcat în stocarea permanentă.");
      window.open(file.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Fișierul nu a putut fi deschis.");
    }
  }

  function captureClientPhotos(key: ClientPhotoKey, files?: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length) return;
    const projectId = activeProject.id;
    const capturedAt = new Intl.DateTimeFormat("ro-RO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    const additions = selectedFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      capturedAt,
      geo: "Se preia locația…",
    }));
    const addedIds = new Set(additions.map((photo) => photo.id));

    setClientPhotos((current) => ({
      ...current,
      [key]: multipleClientPhotoKeys.has(key)
        ? [...(current[key] ?? []), ...additions]
        : [additions[0]],
    }));

    const updateAddedPhotos = async (geo: string) => {
      setClientPhotos((current) => ({
        ...current,
        [key]: (current[key] ?? []).map((photo) =>
          addedIds.has(photo.id) ? { ...photo, geo } : photo
        ),
      }));

      const filesToUpload = multipleClientPhotoKeys.has(key) ? selectedFiles : selectedFiles.slice(0, 1);
      for (const [index, file] of filesToUpload.entries()) {
        try {
          const stored = await uploadProjectFile({ projectId, section: "client", category: key, file, geo });
          setClientPhotos((current) => ({
            ...current,
            [key]: (current[key] ?? []).map((photo) => photo.id === additions[index].id
              ? { id: stored.id, name: stored.name, geo: stored.geo || geo, capturedAt: formatCapturedAt(stored.capturedAt) }
              : photo),
          }));
        } catch (error) {
          setClientPhotos((current) => ({ ...current, [key]: (current[key] ?? []).filter((photo) => photo.id !== additions[index].id) }));
          showToast(error instanceof Error ? error.message : "Fotografia nu a putut fi salvată.");
        }
      }
    };

    if (!navigator.geolocation) {
      void updateAddedPhotos("GPS indisponibil");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void updateAddedPhotos(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      },
      () => {
        void updateAddedPhotos("Permite locația pentru geotag");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function persistFieldSection(section: "client" | "route" | "splices" | "site", content: ClientFieldSummary | RouteFieldSummary | SpliceFieldSummary | SiteFieldSummary) {
    const projectId = activeProject.id;
    const response = await fetch("/api/documentation", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, section, content }),
    });
    const payload = (await response.json()) as { documentation?: ProjectFieldDocumentation; error?: string };
    if (!response.ok || !payload.documentation) throw new Error(payload.error || "Documentația nu a putut fi salvată.");
    setFieldDocumentation((current) => ({ ...current, [projectId]: payload.documentation! }));
  }

  async function submitClientDocumentation() {
    const missing = requiredClientPhotoKeys.filter((key) => !(clientPhotos[key]?.length));
    if (missing.length) {
      showToast(`Mai trebuie încărcate ${missing.length} fotografii obligatorii.`);
      return;
    }
    const clientSummary: ClientFieldSummary = {
      service: clientService,
      equipment: [
        activeProject.cpe,
        ...(activeProject.sfp ? ["SFP optic"] : []),
        ...(activeProject.mc ? ["Media Converter"] : []),
        ...(activeProject.terminalBox ? ["Terminal Box"] : []),
      ],
    };
    try {
      await persistFieldSection("client", clientSummary);
      showToast(`Documentația clientului pentru ${activeProject.id} a fost salvată permanent.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Documentația clientului nu a putut fi salvată.");
    }
  }

  async function saveRouteSummary(summary: RouteFieldSummary) {
    await persistFieldSection("route", summary);
  }

  async function saveSpliceSummary(summary: SpliceFieldSummary) {
    await persistFieldSection("splices", summary);
  }

  async function saveSiteSummary(summary: SiteFieldSummary) {
    await persistFieldSection("site", summary);
  }

  function changeActiveProject(nextProjectId: string) {
    if (nextProjectId === activeProjectId) return;
    setActiveProjectId(nextProjectId);
    setClientService(fieldDocumentation[nextProjectId]?.client?.service ?? "Internet");
    setClientPhotos({});
    const nextProject = projects.find((project) => project.id === nextProjectId);
    if (nextProject) showToast(`${nextProject.id} este acum proiectul activ.`);
  }

  function openProject(project: Project) {
    setActiveProjectId(project.id);
    setClientService(fieldDocumentation[project.id]?.client?.service ?? "Internet");
    setClientPhotos({});
    setSelected(null);
    setView("client");
    showToast(`${project.id} a fost deschis. Toate operațiunile vor fi salvate în acest proiect.`);
  }

  function openProjectDocuments(project: Project) {
    if (!canManageDocuments) {
      showToast("Secțiunea Documente este disponibilă numai administratorilor, managerilor și coordonatorilor.");
      return;
    }
    setActiveProjectId(project.id);
    setSelected(null);
    setView("documents");
  }

  function goTo(next: View) {
    if ((next === "documents" || next === "team" || next === "cpe" || next === "drive") && !canManageDocuments) {
      showToast("Nu ai permisiunea de a accesa această secțiune administrativă.");
      return;
    }
    if ((next === "client" || next === "route" || next === "splices" || next === "site" || next === "documents") && projects.length === 0) {
      showToast("Creează mai întâi un proiect pentru a completa documentația.");
      setView("projects");
      return;
    }
    setView(next);
    setSelected(null);
  }

  if (checkingAuthentication) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-loading" aria-live="polite">
          <span className="auth-logo-surface"><img className="proconect-logo" src={proconectLogoUrl} alt="PRO CONECT" /></span>
          <p>Se verifică sesiunea...</p>
        </section>
      </main>
    );
  }

  if (!authenticatedAccount || authenticatedAccount.passwordResetRequired) {
    const changingPassword = Boolean(authenticatedAccount?.passwordResetRequired);

    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="auth-logo-surface"><img className="proconect-logo" src={proconectLogoUrl} alt="PRO CONECT" /></span>
          <span className="auth-product-label">B2B INSTALL</span>
          <div className="auth-heading">
            <p>ACCES SECURIZAT</p>
            <h1>{changingPassword ? "Setează o parolă nouă" : "Autentificare"}</h1>
            <span>{changingPassword ? `Bun venit, ${authenticatedAccount?.name}. Pentru siguranță, schimbă parola temporară.` : "Introdu datele contului pentru a accesa proiectele."}</span>
          </div>

          <form className="auth-form" onSubmit={changingPassword ? handlePasswordChange : handleSignIn}>
            {!changingPassword && (
              <label>
                <span>Username</span>
                <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus placeholder="ex. vladimir.carlan" />
              </label>
            )}
            <label>
              <span>{changingPassword ? "Parolă nouă" : "Parolă"}</span>
              <input name="password" type="password" autoComplete={changingPassword ? "new-password" : "current-password"} minLength={changingPassword ? 8 : undefined} required placeholder={changingPassword ? "Minimum 8 caractere" : "Introdu parola"} />
            </label>
            {changingPassword && (
              <label>
                <span>Confirmă parola</span>
                <input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={8} required placeholder="Repetă parola nouă" />
              </label>
            )}
            {authenticationError && <p className="auth-error" role="alert">{authenticationError}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={authenticationPending}>
              {authenticationPending ? "Se verifică..." : changingPassword ? "Salvează parola" : "Intră în cont"}<span>→</span>
            </button>
            {changingPassword && <button className="auth-back" type="button" onClick={handleSignOut}>Folosește alt cont</button>}
          </form>

          <p className="auth-footnote">Accesul este permis numai utilizatorilor autorizați Proconect.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navigare principală">
        <div className="brand">
          <span className="brand-logo-surface">
            <img className="proconect-logo" src={proconectLogoUrl} alt="PRO CONECT" />
          </span>
          <small>B2B INSTALL</small>
        </div>

        <nav className="side-nav">
          <p>MANAGEMENT</p>
          <button className={view === "projects" ? "active" : ""} onClick={() => goTo("projects")}>
            <span className="nav-symbol">P</span> Proiecte
          </button>
          {canManageDocuments && <button className={view === "team" ? "active" : ""} onClick={() => goTo("team")}>
            <span className="nav-symbol">E</span> Echipă
          </button>}
          {canManageDocuments && <button className={view === "cpe" ? "active" : ""} onClick={() => goTo("cpe")}>
            <span className="nav-symbol">C</span> Echipamente CPE
          </button>}
          {canManageDocuments && <button className={view === "drive" ? "active" : ""} onClick={() => goTo("drive")}>
            <span className="nav-symbol">GD</span> Google Drive
          </button>}
          <p>DOCUMENTAȚIE</p>
          <button className={view === "client" ? "active" : ""} onClick={() => goTo("client")}><span className="nav-symbol">CL</span> Client</button>
          <button className={view === "route" ? "active" : ""} onClick={() => goTo("route")}><span className="nav-symbol">TR</span> Traseu FO</button>
          <button className={view === "splices" ? "active" : ""} onClick={() => goTo("splices")}><span className="nav-symbol">SU</span> Suduri FO</button>
          <button className={view === "site" ? "active" : ""} onClick={() => goTo("site")}><span className="nav-symbol">ST</span> Operațiuni site</button>
          {canManageDocuments && (
            <button className={view === "documents" ? "active" : ""} onClick={() => goTo("documents")}>
              <span className="nav-symbol">DOC</span> Documente <em>Admin</em>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar avatar-green">{initials(displayedAccountName)}</div>
          <div><strong>{displayedAccountName}</strong><small>{displayedAccountRole}</small></div>
          <button onClick={handleSignOut} aria-label="Deconectare" title="Deconectare">⎋</button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => goTo("projects")} aria-label="Pagina principală">
            <img className="proconect-logo mobile-proconect-logo" src={proconectLogoUrl} alt="PRO CONECT" />
            <strong>B2B</strong>
          </button>
          <div className="breadcrumb"><span>{isProjectView ? `Proiect · ${activeProject.id}` : "Management"}</span><b>/</b><strong>{view === "projects" ? "Proiecte" : view === "team" ? "Echipă" : view === "cpe" ? "Echipamente CPE" : view === "drive" ? "Google Drive" : view === "client" ? "Client" : view === "route" ? "Traseu FO" : view === "splices" ? "Suduri FO" : view === "documents" ? "Documente" : "Operațiuni site"}</strong></div>
          <div className="top-actions">
            <button className="help-button" aria-label="Ajutor">?</button>
            <button className="bell" aria-label="Notificări">●<span>3</span></button>
            <div className="top-profile"><span className="avatar avatar-green">{initials(displayedAccountName)}</span><div><strong>{displayedAccountName}</strong><small>{displayedAccountRole}</small></div></div>
            <button className="logout-button" onClick={handleSignOut} aria-label="Deconectare" title="Deconectare">⎋</button>
          </div>
        </header>

        {isProjectView && (
          <section className="active-project-context" aria-label="Proiect activ și operațiuni">
            <label className="active-project-picker">
              <span>PROIECT ACTIV</span>
              <select value={activeProjectId} onChange={(event) => changeActiveProject(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.id} · {project.client}</option>)}
              </select>
            </label>
            <div className="active-project-summary">
              <span>{initials(activeProject.client)}</span>
              <div><small>CLIENT ȘI LOCAȚIE</small><strong>{activeProject.client}</strong><p>{activeProject.address}</p></div>
              <em className={statusClass[activeProject.status]}><i />{activeProject.status}</em>
            </div>
            <nav className="project-operation-tabs" aria-label="Operațiunile proiectului activ">
              <button className={view === "client" ? "active" : ""} onClick={() => goTo("client")}><span>1</span>Client</button>
              <button className={view === "route" ? "active" : ""} onClick={() => goTo("route")}><span>2</span>Traseu FO</button>
              <button className={view === "splices" ? "active" : ""} onClick={() => goTo("splices")}><span>3</span>Suduri FO</button>
              <button className={view === "site" ? "active" : ""} onClick={() => goTo("site")}><span>4</span>Site</button>
              {canManageDocuments && <button className={view === "documents" ? "active" : ""} onClick={() => goTo("documents")}><span>5</span>Documente</button>}
            </nav>
          </section>
        )}

        {view === "projects" && (
          <div className="page-wrap">
            <section className="page-heading">
              <div>
                <p className="eyebrow">CENTRU OPERAȚIONAL</p>
                <h1>Bună dimineața, {currentAccount.name}.</h1>
                <p>{projects.length ? <>Ai <strong>{projectMetrics.active} {projectMetrics.active === 1 ? "lucrare activă" : "lucrări active"}</strong>{projectMetrics.awaitingReview ? ` și ${projectMetrics.awaitingReview === 1 ? "o documentație care necesită verificare" : `${projectMetrics.awaitingReview} documentații care necesită verificare`}.` : "."}</> : "Nu există proiecte înregistrate momentan."}</p>
              </div>
              {canManageDocuments && <button className="primary-button" onClick={() => { setEditingProject(null); setModal("project"); }}><span>＋</span> Proiect nou</button>}
            </section>

            <section className="metrics" aria-label="Rezumat proiecte">
              <article><div className="metric-icon blue">↗</div><div><small>LUCRĂRI ACTIVE</small><strong>{projectMetrics.active}</strong><p>{projects.length ? `${projects.length} ${projects.length === 1 ? "proiect înregistrat" : "proiecte înregistrate"}` : "Niciun proiect înregistrat"}</p></div></article>
              <article><div className="metric-icon violet">◷</div><div><small>PLANIFICATE AZI</small><strong>{projectMetrics.plannedToday}</strong><p>{projectMetrics.firstScheduledHour ? <>Prima lucrare la <b>{projectMetrics.firstScheduledHour}</b></> : projectMetrics.plannedToday ? "Lucrări programate astăzi" : "Nicio lucrare planificată"}</p></div></article>
              <article><div className="metric-icon amber">!</div><div><small>DE VERIFICAT</small><strong>{projectMetrics.awaitingReview}</strong><p>{projectMetrics.awaitingReview ? "Documentații în așteptare" : "Nimic de verificat"}</p></div></article>
              <article><div className="metric-icon green">✓</div><div><small>FINALIZATE LUNA ACEASTA</small><strong>{projectMetrics.completedThisMonth}</strong><p>{projectMetrics.completedThisMonth ? "Lucrări încheiate luna curentă" : "Nicio lucrare finalizată"}</p></div></article>
            </section>

            <section className="project-card">
              <div className="card-heading">
                <div><h2>Proiecte recente</h2><p>Gestionează și urmărește lucrările de instalare.</p></div>
                <div className="view-controls"><button className="icon-toggle active" aria-label="Vizualizare listă">☷</button><button className="icon-toggle" aria-label="Vizualizare grilă">▦</button></div>
              </div>
              <div className="toolbar">
                <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caută după RID, client, adresă..." /></label>
                <div className="filters">
                  <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtru status">
                    <option>Toate statusurile</option><option>Planificat</option><option>În desfășurare</option><option>De verificat</option><option>Finalizat</option>
                  </select>
                  <button onClick={() => { setSearch(""); setFilter("Toate statusurile"); }}>↻ <span>Resetează</span></button>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>REQUEST ID</th><th>CLIENT / ADRESĂ</th><th>TEHNICIAN</th><th>STATUS</th><th>PROGRAMARE</th><th /></tr></thead>
                  <tbody>
                    {filteredProjects.map((project) => (
                      <tr className={project.id === activeProject.id ? "active-project-row" : ""} key={project.id} onClick={() => setSelected(project)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setSelected(project)}>
                        <td><strong className="rid">{project.id}</strong><small>{project.id === activeProject.id ? "Proiect activ" : "Salvat permanent"}</small></td>
                        <td><strong>{project.client}</strong><small>{project.address}</small></td>
                        <td><div className="technician"><span className="avatar">{initials(project.technician)}</span><strong>{project.technician}</strong></div></td>
                        <td><span className={statusClass[project.status]}><i />{project.status}</span></td>
                        <td><strong>{project.date}</strong></td>
                        <td>{canManageDocuments && <div style={{ display: "flex", alignItems: "center", gap: "4px" }}><button className="more" aria-label={`Editează ${project.id}`} title={`Editează ${project.id}`} onClick={(event) => { event.stopPropagation(); openProjectEditor(project); }}>Editează</button><button className="more" style={{ color: "#b42336" }} aria-label={`Șterge ${project.id}`} title={`Șterge ${project.id}`} onClick={(event) => { event.stopPropagation(); openProjectDeletion(project); }}>Șterge</button></div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredProjects.length === 0 && <div className="empty-state"><strong>{projects.length ? "Nicio lucrare găsită" : "Nu există proiecte"}</strong><p>{projects.length ? "Modifică termenul de căutare sau filtrele." : canManageDocuments ? "Adaugă un proiect nou pentru a începe." : "Nu există proiecte alocate contului tău."}</p></div>}
              </div>
              <div className="card-footer"><span>Se afișează {filteredProjects.length} din {projects.length} proiecte</span><div><button disabled>‹</button><button className="current">1</button><button>2</button><button>3</button><button>›</button></div></div>
            </section>
          </div>
        )}

        {view === "team" && canManageDocuments && (
          <div className="page-wrap inner-page">
            <section className="page-heading compact">
              <div><p className="eyebrow">ADMINISTRARE</p><h1>Echipă și conturi</h1><p>Creează conturi și gestionează accesul administratorilor și tehnicienilor.</p></div>
              <button className="primary-button" onClick={() => setModal("account")}><span>＋</span> Cont nou</button>
            </section>
            <section className="mini-metrics">
              <article><small>CONTURI ACTIVE</small><strong>{accounts.filter((a) => a.active).length}</strong></article>
              <article><small>TEHNICIENI</small><strong>{technicians.length}</strong></article>
              <article><small>ADMINISTRATORI</small><strong>{accounts.filter((a) => a.role === "Admin").length}</strong></article>
            </section>
            <section className="project-card team-card">
              <div className="card-heading"><div><h2>Utilizatori</h2><p>Parolele sunt protejate și nu sunt afișate după creare.</p></div></div>
              <div className="account-grid">
                {accounts.map((account, index) => (
                  <article className="account-card" key={account.username}>
                    <div className={`avatar big ${index === 0 ? "avatar-green" : ""}`}>{initials(account.name)}</div>
                    <div className="account-copy"><strong>{account.name}</strong><small>@{account.username}</small><span className={account.role === "Tehnician" ? "role" : "role role-dark"}>{account.role}</span></div>
                    <div className="account-meta"><span><i className={account.active ? "online" : ""} />{account.active ? "Activ" : "Inactiv"}</span><small>{account.role === "Tehnician" ? `${account.jobs} lucrări` : "Acces complet"}</small></div>
                    <button className="more" aria-label={`Opțiuni cont ${account.username}`}>•••</button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "cpe" && canManageDocuments && (
          <div className="page-wrap inner-page">
            <section className="page-heading compact">
              <div><p className="eyebrow">CONFIGURARE</p><h1>Echipamente CPE</h1><p>Lista de echipamente disponibilă la generarea unei lucrări.</p></div>
              <button className="primary-button" onClick={() => setModal("cpe")}><span>＋</span> Echipament nou</button>
            </section>
            <section className="project-card cpe-section">
              <div className="card-heading"><div><h2>Catalog CPE</h2><p>{cpeList.length} echipamente configurate</p></div><label className="search-box small"><span>⌕</span><input value={cpeSearch} onChange={(event) => setCpeSearch(event.target.value)} placeholder="Caută echipament..." /></label></div>
              <div className="cpe-grid">
                {cpeList.filter((cpe) => cpe.toLowerCase().includes(cpeSearch.trim().toLowerCase())).map((cpe) => (
                  <article className="cpe-card" key={cpe}><div className="device-icon"><i /><i /><i /></div><div><strong>{cpe}</strong><small>Disponibil pentru proiecte</small></div><span>{projects.filter((project) => project.cpe === cpe).length} utilizări</span><button className="more" aria-label={`Editează ${cpe}`} title={`Editează ${cpe}`} onClick={() => { setEditingCpe(cpe); setModal("edit-cpe"); }}>Editează</button></article>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "client" && (
          <div className="page-wrap client-page">
            <section className="page-heading client-heading">
              <div>
                <p className="eyebrow">DOCUMENTAȚIE DIN TEREN</p>
                <h1>Secțiunea client</h1>
                <p>Confirmă serviciul, echipamentele instalate și documentația foto obligatorie.</p>
              </div>
              <div className="field-technician">
                <span className="avatar">{initials(activeProject.technician)}</span>
                <div><small>TEHNICIAN ALOCAT</small><strong>{activeProject.technician}</strong></div>
              </div>
            </section>

            <div className="client-layout">
              <div className="client-main">
                <section className="client-card">
                  <div className="client-card-head">
                    <span className="step-number">1</span>
                    <div><h2>Serviciu și locație</h2><p>Completează serviciul pentru proiectul activ.</p></div>
                  </div>
                  <div className="client-card-body client-fields">
                    <label>
                      <span>Serviciu instalat</span>
                      <select value={clientService} onChange={(event) => setClientService(event.target.value as ServiceType)}>
                        <option>Internet</option>
                        <option>VPN</option>
                        <option>Internet+OL</option>
                        <option>OL</option>
                      </select>
                    </label>
                    <div className="client-address">
                      <span className="location-pin">⌖</span>
                      <div><small>LOCAȚIE CLIENT</small><strong>{activeProject.address}</strong><p>{activeProject.contact} · {activeProject.phone}</p></div>
                    </div>
                  </div>
                </section>

                <section className="client-card">
                  <div className="client-card-head">
                    <span className="step-number">2</span>
                    <div><h2>Echipamente de instalat</h2><p>Lista este preluată automat din proiect.</p></div>
                    <span className="equipment-count">{1 + Number(activeProject.sfp) + Number(activeProject.mc) + Number(activeProject.terminalBox)} poziții</span>
                  </div>
                  <div className="client-card-body equipment-list">
                    <article className="install-equipment primary-equipment">
                      <span className="equipment-symbol">CPE</span>
                      <div><small>ECHIPAMENT PRINCIPAL</small><strong>{activeProject.cpe}</strong></div>
                      <span className="install-state">De instalat</span>
                    </article>
                    {activeProject.sfp && <article className="install-equipment"><span className="equipment-symbol">SFP</span><div><small>MODUL OPTIC</small><strong>SFP conform proiectului</strong></div><span className="install-state">De instalat</span></article>}
                    {activeProject.mc && <article className="install-equipment"><span className="equipment-symbol">MC</span><div><small>MEDIA CONVERTER</small><strong>MC conform proiectului</strong></div><span className="install-state">De instalat</span></article>}
                    {activeProject.terminalBox && <article className="install-equipment"><span className="equipment-symbol">TB</span><div><small>TERMINAȚIE</small><strong>Terminal Box</strong></div><span className="install-state">De instalat</span></article>}
                  </div>
                </section>

                <section className="client-card">
                  <div className="client-card-head">
                    <span className="step-number">3</span>
                    <div><h2>Documentare foto</h2><p>Fotografiile sunt asociate cu ora și locația curentă.</p></div>
                    <span className="photo-progress">{completedClientPhotos}/{requiredClientPhotoKeys.length} încărcate</span>
                  </div>
                  <div className="client-card-body">
                    <div className="photo-upload-grid">
                      {requiredClientPhotoKeys.map((key) => {
                        const photos = clientPhotos[key] ?? [];
                        const latestPhoto = photos[photos.length - 1];
                        const item = clientPhotoCatalog[key];
                        const acceptsMultiple = multipleClientPhotoKeys.has(key);
                        return (
                          <label className={photos.length ? "client-photo-card complete" : "client-photo-card"} key={key}>
                            <input type="file" accept="image/*" capture="environment" multiple={acceptsMultiple} onChange={(event) => captureClientPhotos(key, event.target.files)} />
                            <span className="photo-badge">{photos.length ? photos.length : item.badge}</span>
                            <div className="photo-copy">
                              <span><strong>{item.title}</strong><em className={acceptsMultiple ? "multi-photo" : ""}>{acceptsMultiple ? "POZE MULTIPLE" : "OBLIGATORIU"}</em></span>
                              <p>{photos.length ? photos.map((photo) => photo.name).join(", ") : item.description}</p>
                              {latestPhoto && <small><b>⌖</b> {latestPhoto.geo} · {latestPhoto.capturedAt}</small>}
                            </div>
                            <span className="photo-action">{photos.length ? (acceptsMultiple ? "Adaugă încă" : "Schimbă") : (acceptsMultiple ? "Adaugă poze" : "Adaugă foto")}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>

              <aside className="client-summary">
                <div className="summary-title"><span>✓</span><div><h2>Validare documentație</h2><p>{activeProject.id} · {clientService}</p></div></div>
                <div className="summary-progress"><div><span>Progres</span><strong>{clientProgress}%</strong></div><i><b style={{ width: `${clientProgress}%` }} /></i></div>
                <div className="summary-checklist">
                  {requiredClientPhotoKeys.map((key) => {
                    const photoCount = clientPhotos[key]?.length ?? 0;
                    return (
                      <div className={photoCount ? "done" : ""} key={key}>
                        <span>{photoCount ? "✓" : "○"}</span>
                        <p><strong>{clientPhotoCatalog[key].title}</strong><small>{photoCount ? `${photoCount} ${photoCount === 1 ? "fotografie adăugată" : "fotografii adăugate"}` : "În așteptare"}</small></p>
                      </div>
                    );
                  })}
                </div>
                <div className="geo-notice"><span>⌖</span><p><strong>Fotografii geotagate</strong>La încărcare, permite accesul la locație pentru asocierea coordonatelor GPS.</p></div>
                <button className="primary-button submit-documentation" onClick={submitClientDocumentation}>Salvează documentația <span>→</span></button>
              </aside>
            </div>
          </div>
        )}

        {view === "drive" && canManageDocuments && <GoogleDriveSettings initialStatus={driveStatus} onStatusChange={setDriveStatus} onNotify={showToast} />}
        {view === "route" && <FoRouteSection project={activeProject} initialSummary={activeFieldDocumentation.route} onNotify={showToast} onSaved={saveRouteSummary} />}
        {view === "splices" && <FoSplicesSection project={activeProject} initialSummary={activeFieldDocumentation.splices} onNotify={showToast} onSaved={saveSpliceSummary} />}
        {view === "site" && <SiteOperationsSection project={activeProject} initialSummary={activeFieldDocumentation.site} onNotify={showToast} onSaved={saveSiteSummary} />}
        {view === "documents" && canManageDocuments && <ProjectDocumentsSection project={activeProject} fieldData={activeFieldDocumentation} onNotify={showToast} />}
      </section>

      <nav className={canManageDocuments ? "mobile-nav manager-nav" : "mobile-nav"} aria-label="Navigare mobilă">
        <button className={view === "projects" ? "active" : ""} onClick={() => goTo("projects")}><span>P</span>Proiecte</button>
        {canManageDocuments && <button className={view === "team" ? "active" : ""} onClick={() => goTo("team")}><span>E</span>Echipă</button>}
        {canManageDocuments && <button className={view === "cpe" ? "active" : ""} onClick={() => goTo("cpe")}><span>C</span>CPE</button>}
        {canManageDocuments && <button className={view === "drive" ? "active" : ""} onClick={() => goTo("drive")}><span>GD</span>Drive</button>}
        <button className={view === "client" ? "active" : ""} onClick={() => goTo("client")}><span>CL</span>Client</button>
        <button className={view === "route" ? "active" : ""} onClick={() => goTo("route")}><span>TR</span>Traseu</button>
        <button className={view === "splices" ? "active" : ""} onClick={() => goTo("splices")}><span>SU</span>Suduri</button>
        <button className={view === "site" ? "active" : ""} onClick={() => goTo("site")}><span>ST</span>Site</button>
        {canManageDocuments && <button className={view === "documents" ? "active" : ""} onClick={() => goTo("documents")}><span>DOC</span>Documente</button>}
      </nav>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
        {(modal === "project" || modal === "edit-project") && (
          <form className="modal project-modal" onSubmit={modal === "edit-project" ? saveProjectChanges : createProject}>
            <div className="modal-head"><div><span className="modal-kicker">{editingProject ? "EDITARE PROIECT" : "PROIECT NOU"}</span><h2>{editingProject ? `Actualizează ${editingProject.id}` : "Generează o lucrare"}</h2><p>{editingProject ? "Modificările se salvează permanent pentru proiectul selectat." : "Datele inițiale pentru instalarea B2B."}</p></div><button type="button" onClick={closeModal} aria-label="Închide">×</button></div>
            <div className="modal-body">
              <div className="form-section"><h3><span>1</span> Date proiect și client</h3><div className="form-grid">
                <label><span>Request ID *</span><div className="prefix-input"><b>RID</b><input name="requestId" required readOnly={Boolean(editingProject)} defaultValue={editingProject?.id.replace(/^RID/i, "")} inputMode="numeric" placeholder="ex. 10483" /></div></label>
                <label><span>Nume client *</span><input name="client" required defaultValue={editingProject?.client} placeholder="Denumirea companiei" /></label>
                <label className="wide"><span>Adresă instalare *</span><input name="address" required defaultValue={editingProject?.address} placeholder="Stradă, număr, localitate" /></label>
                <label><span>Persoană de contact *</span><input name="contact" required defaultValue={editingProject?.contact} placeholder="Nume și prenume" /></label>
                <label><span>Telefon *</span><input name="phone" required defaultValue={editingProject?.phone} placeholder="+40 7xx xxx xxx" /></label>
                <label className="wide"><span>E-mail</span><input name="email" type="email" defaultValue={editingProject?.email} placeholder="contact@companie.ro" /></label>
                <label className="wide work-requirements"><span>Cerințele lucrării *</span><textarea name="requirements" required defaultValue={editingProject?.requirements} rows={5} placeholder="Descrie lucrările solicitate, condițiile de instalare, echipamentele sau configurațiile speciale și orice alte informații utile tehnicianului..." /></label>
              </div></div>
              <div className="form-section"><h3><span>2</span> Alocare și echipamente</h3><div className="form-grid">
                <label><span>Tehnician alocat *</span><select name="technician" required defaultValue={editingProject?.technician || ""}><option value="" disabled>Selectează tehnicianul</option>{technicians.map((tech) => <option key={tech.username}>{tech.name}</option>)}</select></label>
                <label><span>Tip CPE *</span><div className="select-plus"><select name="cpe" required defaultValue={editingProject?.cpe || ""}><option value="" disabled>Selectează echipamentul</option>{cpeList.map((cpe) => <option key={cpe}>{cpe}</option>)}</select><button type="button" onClick={() => { const value = window.prompt("Denumirea echipamentului CPE"); if (value?.trim()) void addCpeByName(value.trim()); }} aria-label="Adaugă CPE">＋</button></div></label>
                {editingProject && <><label><span>Status proiect *</span><select name="status" required defaultValue={editingProject.status}><option>Planificat</option><option>În desfășurare</option><option>De verificat</option><option>Finalizat</option></select></label><label><span>Programare *</span><input name="date" required defaultValue={editingProject.date} placeholder="ex. 26 aug, 09:30" /></label></>}
                <div className="wide"><span className="field-label">Echipamente suplimentare</span><div className="switch-row">
                  <label className="switch-card"><span><b>SFP</b><small>Modul optic</small></span><input type="checkbox" name="sfp" defaultChecked={editingProject ? editingProject.sfp : true} /><i /></label>
                  <label className="switch-card"><span><b>MC</b><small>Media converter</small></span><input type="checkbox" name="mc" defaultChecked={editingProject?.mc} /><i /></label>
                  <label className="switch-card"><span><b>Terminal Box</b><small>Cutie terminală</small></span><input type="checkbox" name="terminalBox" defaultChecked={editingProject ? editingProject.terminalBox : true} /><i /></label>
                </div></div>
              </div></div>
              <div className="form-section"><h3><span>3</span> Documente</h3><div className="upload-grid">
                <label className={ipwoName ? "upload-box has-file" : "upload-box"}><input type="file" accept=".pdf,.doc,.docx" onChange={(event) => { const file = event.target.files?.[0] ?? null; setIpwoFile(file); setIpwoName(file?.name ?? editingProject?.ipwo ?? ""); }} /><b>{ipwoName ? "✓" : "↑"}</b><strong>{ipwoName || "Încarcă IPWO"}</strong><small>{ipwoFile ? "Fișier nou selectat" : editingProject && ipwoName ? "Document existent · selectează pentru înlocuire" : "PDF sau DOC, max. 20 MB"}</small></label>
                <label className={spliceName ? "upload-box has-file" : "upload-box"}><input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => { const file = event.target.files?.[0] ?? null; setSpliceFile(file); setSpliceName(file?.name ?? editingProject?.splice ?? ""); }} /><b>{spliceName ? "✓" : "↑"}</b><strong>{spliceName || "Diagrama de suduri"}</strong><small>{spliceFile ? "Fișier nou selectat" : editingProject && spliceName ? "Document existent · selectează pentru înlocuire" : "PDF, PNG sau JPG, max. 20 MB"}</small></label>
              </div></div>
              <div className="drive-note"><span className="drive-mark"><i /><i /><i /></span><div><strong>{driveStatus?.connected ? "Google Drive conectat" : "Stocare securizată proiect"}</strong><p>{driveStatus?.connected ? <>Dosarul <b>RID + Request ID</b> și subdosarele documentației se creează automat în Google Drive.</> : <>Documentele sunt salvate permanent. Configurează <b>Google Drive</b> din secțiunea administrativă pentru sincronizare automată.</>}</p></div></div>
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal}>Anulează</button><button className="primary-button" type="submit" disabled={projectSaving}>{projectSaving ? "Se salvează..." : editingProject ? "Salvează modificările" : "Generează proiectul"} <span>→</span></button></div>
          </form>
        )}
        {modal === "delete-project" && deletingProject && (
          <form className="modal small-modal" onSubmit={removeProject}>
            <div className="modal-head"><div><span className="modal-kicker">ȘTERGERE DEFINITIVĂ</span><h2>Șterge {deletingProject.id}</h2><p>{deletingProject.client} · {deletingProject.address}</p></div><button type="button" onClick={closeModal} aria-label="Închide" disabled={projectDeleting}>×</button></div>
            <div className="modal-body stacked-form">
              <div className="info-note" style={{ borderColor: "#ecc8cc", background: "#fff5f5" }}><b style={{ color: "#b42336" }}>!</b><p>Proiectul, documentația din teren, rapoartele și fotografiile salvate în aplicație vor fi șterse definitiv.</p></div>
              <label><span>Scrie {deletingProject.id} pentru confirmare *</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} required autoComplete="off" placeholder={deletingProject.id} autoFocus disabled={projectDeleting} /></label>
              <small>Dosarul existent în Google Drive este păstrat ca arhivă.</small>
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal} disabled={projectDeleting}>Anulează</button><button className="primary-button" style={{ background: "#b42336", borderColor: "#b42336" }} type="submit" disabled={projectDeleting || deleteConfirmation.trim() !== deletingProject.id}>{projectDeleting ? "Se șterge..." : "Șterge definitiv"}</button></div>
          </form>
        )}
        {modal === "account" && (
          <form className="modal small-modal" onSubmit={createAccount}>
            <div className="modal-head"><div><span className="modal-kicker">CONT NOU</span><h2>Adaugă utilizator</h2><p>Acces simplu cu username și parolă.</p></div><button type="button" onClick={() => setModal(null)}>×</button></div>
            <div className="modal-body stacked-form">
              <label><span>Nume complet *</span><input name="name" required placeholder="Nume și prenume" /></label>
              <label><span>Username *</span><input name="username" required autoComplete="off" placeholder="ex. andrei.m" /></label>
              <label><span>Parolă temporară *</span><input name="password" required type="password" minLength={8} autoComplete="new-password" placeholder="Minimum 8 caractere" /><small>Utilizatorul o va schimba la prima autentificare.</small></label>
              <label><span>Rol *</span><select name="role"><option>Tehnician</option><option>Admin</option><option>Coordonator</option><option>Manager</option></select></label>
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Anulează</button><button className="primary-button" type="submit">Creează contul</button></div>
          </form>
        )}
        {(modal === "cpe" || modal === "edit-cpe") && (
          <form className="modal small-modal" onSubmit={modal === "edit-cpe" ? saveCpeChanges : createCpe}>
            <div className="modal-head"><div><span className="modal-kicker">CATALOG CPE</span><h2>{editingCpe ? "Editează echipamentul" : "Echipament nou"}</h2><p>{editingCpe ? "Modificarea se aplică și proiectelor care folosesc acest echipament." : "Va apărea imediat în formularul de proiect."}</p></div><button type="button" onClick={closeModal}>×</button></div>
            <div className="modal-body stacked-form"><label><span>Producător și model *</span><input name="cpeName" required defaultValue={editingCpe} placeholder="ex. Cisco C1111-8P" autoFocus /></label><div className="info-note"><b>i</b><p>Folosește denumirea comercială completă pentru identificare rapidă în teren.</p></div></div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal}>Anulează</button><button className="primary-button" type="submit">{editingCpe ? "Salvează modificările" : "Adaugă echipamentul"}</button></div>
          </form>
        )}
      </div>}

      {selected && <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><aside className="detail-drawer">
        <div className="drawer-head"><div><span className={statusClass[selected.status]}><i />{selected.status}</span><h2>{selected.id}</h2><p>{selected.client}</p></div><button onClick={() => setSelected(null)} aria-label="Închide">×</button></div>
        <div className="drawer-section"><small>LOCAȚIE ȘI CONTACT</small><strong>{selected.address}</strong><p>{selected.contact} · {selected.phone}</p><p>{selected.email}</p></div>
        <div className="drawer-section"><small>CERINȚELE LUCRĂRII</small><p className="requirements-text">{selected.requirements}</p></div>
        <div className="drawer-section"><small>TEHNICIAN ALOCAT</small><div className="technician large"><span className="avatar">{initials(selected.technician)}</span><div><strong>{selected.technician}</strong><p>Programare: {selected.date}</p></div></div></div>
        <div className="drawer-section"><small>ECHIPAMENTE</small><strong>{selected.cpe}</strong><div className="tag-row">{selected.sfp && <span>SFP</span>}{selected.mc && <span>MC</span>}{selected.terminalBox && <span>Terminal Box</span>}</div></div>
        <div className="drawer-section"><small>DOCUMENTE</small><button className="file-row" onClick={() => void openProjectFile(selected.id, "ipwo")}><span>PDF</span><div><strong>{selected.ipwo}</strong><small>IPWO</small></div><b>↗</b></button><button className="file-row" onClick={() => void openProjectFile(selected.id, "splice-diagram")}><span>FO</span><div><strong>{selected.splice}</strong><small>Diagramă suduri</small></div><b>↗</b></button></div>
        <div className="drive-folder"><span className="folder-icon">▰</span><div><small>{driveStatus?.folders[selected.id] ? "GOOGLE DRIVE" : "STOCARE SECURIZATĂ"}</small><strong>Dosar {selected.id}</strong></div>{driveStatus?.folders[selected.id] ? <a className="drive-folder-open" href={driveStatus.folders[selected.id]} target="_blank" rel="noreferrer" aria-label={`Deschide dosarul Google Drive ${selected.id}`}>↗</a> : <span>✓</span>}</div>
        <div className="drawer-project-actions">
          <button className="primary-button" onClick={() => openProject(selected)}>Deschide proiectul <span>→</span></button>
          {canManageDocuments && <button className="secondary-button" onClick={() => openProjectEditor(selected)}>Editează proiectul</button>}
          {canManageDocuments && <button className="secondary-button" onClick={() => openProjectDocuments(selected)}>Documente administrative</button>}
          {canManageDocuments && <button className="secondary-button" style={{ color: "#b42336", borderColor: "#ecc8cc" }} onClick={() => openProjectDeletion(selected)}>Șterge proiectul</button>}
          <small>Client, traseu, suduri, operațiuni site și închiderea proiectului</small>
        </div>
      </aside></div>}

      {toast && <div className="toast"><span>✓</span>{toast}<button onClick={() => setToast("")}>×</button></div>}
    </main>
  );
}
