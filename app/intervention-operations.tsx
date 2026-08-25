"use client";

import { useEffect, useState, type FormEvent } from "react";
import { deleteProjectFile, fetchProjectFiles, formatCapturedAt, uploadProjectFile, type StoredProjectFile } from "./client-storage";
import { InterventionExecutionSection } from "./intervention-execution";
import type { InterventionDamageType, InterventionFieldSummary } from "./field-documentation";
import type { ProjectRecord } from "./project-data";

type InterventionSection = "assessment" | "execution" | "documentation";

type InterventionOperationsProps = {
  project: ProjectRecord;
  section: InterventionSection;
  initialSummary?: InterventionFieldSummary;
  driveFolderUrl?: string;
  canEdit: boolean;
  onEdit: () => void;
  onSectionChange: (section: InterventionSection) => void;
  onNotify: (message: string) => void;
  onSaved: (summary: InterventionFieldSummary) => Promise<void>;
};

const sectionTitles: Record<InterventionSection, string> = {
  assessment: "Constatare",
  execution: "Execuție",
  documentation: "Documentare",
};

function validPhotoCoordinates(value: string) {
  const coordinates = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s|$)/.exec(value.trim());
  if (!coordinates) return false;
  const latitude = Number(coordinates[1]);
  const longitude = Number(coordinates[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

async function currentPhotoLocation() {
  if (!window.isSecureContext || !navigator.geolocation) {
    throw new Error("Fotografiile intervenției necesită un dispozitiv și o conexiune cu acces GPS.");
  }

  return new Promise<string>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} · ±${Math.round(coords.accuracy)} m`);
      },
      (failure) => {
        reject(new Error(
          failure.code === failure.PERMISSION_DENIED
            ? "Permite accesul la locație pentru a încărca fotografiile intervenției."
            : failure.code === failure.TIMEOUT
              ? "Localizarea GPS a durat prea mult. Activează locația și încearcă din nou."
              : "Poziția GPS nu a putut fi determinată. Verifică localizarea dispozitivului.",
        ));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
    );
  });
}

export function InterventionOperationsSection({
  project,
  section,
  initialSummary,
  driveFolderUrl,
  canEdit,
  onEdit,
  onSectionChange,
  onNotify,
  onSaved,
}: InterventionOperationsProps) {
  const [damageType, setDamageType] = useState<InterventionDamageType | "">(initialSummary?.assessment?.damageType ?? "");
  const [photos, setPhotos] = useState<StoredProjectFile[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setDamageType(initialSummary?.assessment?.damageType ?? "");
      setPhotos([]);
      setLoadingPhotos(true);
      setError("");
    });

    fetchProjectFiles(project.id, "intervention-assessment")
      .then((assessmentPhotos) => {
        if (mounted) setPhotos(assessmentPhotos);
      })
      .catch((failure) => {
        if (mounted) setError(failure instanceof Error ? failure.message : "Fotografiile intervenției nu au putut fi încărcate.");
      })
      .finally(() => {
        if (mounted) setLoadingPhotos(false);
      });

    return () => {
      mounted = false;
    };
  }, [project.id, initialSummary?.assessment?.damageType]);

  const validPhotos = photos.filter((photo) => validPhotoCoordinates(photo.geo));
  const completedItems = Number(Boolean(damageType)) + Number(validPhotos.length > 0);
  const progress = Math.round((completedItems / 2) * 100);
  const ready = Boolean(damageType) && validPhotos.length > 0;

  async function addPhotos(selectedFiles: File[]) {
    if (!selectedFiles.length) return;

    setUploading(true);
    setError("");
    try {
      const geo = await currentPhotoLocation();
      for (const file of selectedFiles) {
        const saved = await uploadProjectFile({
          projectId: project.id,
          section: "intervention-assessment",
          category: "damage",
          file,
          geo,
        });
        setPhotos((current) => [...current, saved]);
      }
      onNotify(selectedFiles.length === 1
        ? "Fotografia avariei a fost salvată cu poziția GPS."
        : `${selectedFiles.length} fotografii ale avariei au fost salvate cu poziția GPS.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Fotografiile intervenției nu au putut fi încărcate.");
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photo: StoredProjectFile) {
    setRemovingId(photo.id);
    setError("");
    try {
      await deleteProjectFile(photo.id);
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      onNotify("Fotografia intervenției a fost ștearsă.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Fotografia nu a putut fi ștearsă.");
    } finally {
      setRemovingId("");
    }
  }

  async function saveAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!damageType || !validPhotos.length) {
      setError("Selectează tipul avariei și adaugă cel puțin o fotografie cu GPS valid.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSaved({
        ...initialSummary,
        assessment: {
          damageType,
          photoCount: photos.length,
          geotaggedPhotoCount: validPhotos.length,
          documentedAt: Date.now(),
        },
      });
      onNotify(`Constatarea intervenției ${project.id} a fost salvată.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Constatarea intervenției nu a putut fi salvată.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-wrap inner-page activity-workspace-page intervention-page">
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">INTERVENȚII TEHNICE</p>
          <h1>{sectionTitles[section]}</h1>
          <p>{project.id} · {project.client}</p>
        </div>
        {canEdit && <button className="primary-button" onClick={onEdit}>Editează lucrarea <span>→</span></button>}
      </section>

      <nav className="intervention-stage-nav" aria-label="Etapele intervenției">
        <button type="button" className={section === "assessment" ? "active" : ""} onClick={() => onSectionChange("assessment")}>
          <span>1</span><div><strong>Constatare</strong><small>Avarie și fotografii inițiale</small></div>
        </button>
        <button type="button" className={section === "execution" ? "active" : ""} onClick={() => onSectionChange("execution")}>
          <span>2</span><div><strong>Execuție</strong><small>Activități și hartă Optix</small></div>
        </button>
        <button type="button" className={section === "documentation" ? "active" : ""} onClick={() => onSectionChange("documentation")}>
          <span>3</span><div><strong>Documentare</strong><small>Închiderea intervenției</small></div>
        </button>
      </nav>

      <div className="activity-workspace-grid intervention-brief-grid">
        <section className="project-card activity-brief-card">
          <div className="card-heading"><div><h2>Cerințele intervenției</h2><p>Informațiile transmise tehnicianului pentru această lucrare.</p></div></div>
          <div className="activity-brief-content"><p>{project.requirements}</p></div>
          <div className="activity-contact-grid">
            <div><small>LOCAȚIE</small><strong>{project.address}</strong></div>
            <div><small>PERSOANĂ DE CONTACT</small><strong>{project.contact}</strong><span>{project.phone}</span></div>
          </div>
        </section>

        <aside className="project-card activity-assignment-card">
          <div className="card-heading"><div><h2>Alocare</h2><p>Intervenția activă.</p></div></div>
          <div className="activity-assignment-content">
            <div><small>TEHNICIAN</small><strong>{project.technician}</strong></div>
            <div><small>PROGRAMARE</small><strong>{project.date || "Neprogramată"}</strong></div>
            <div><small>STATUS</small><strong>{project.status}</strong></div>
            {driveFolderUrl && <a href={driveFolderUrl} target="_blank" rel="noreferrer">Deschide dosarul Google Drive ↗</a>}
          </div>
        </aside>
      </div>

      {section === "assessment" ? (
        <form className="intervention-section-layout" onSubmit={saveAssessment}>
          <section className="project-card intervention-assessment-card">
            <div className="card-heading"><div><h2>Constatare avarie</h2><p>Identifică avaria și documentează situația găsită în teren.</p></div></div>

            <div className="intervention-assessment-content">
              <label className="intervention-damage-field">
                <span>Tipul avariei <b>OBLIGATORIU</b></span>
                <select value={damageType} onChange={(event) => setDamageType(event.target.value as InterventionDamageType | "")} required>
                  <option value="">Selectează tipul avariei</option>
                  <option value="FO cut">FO cut</option>
                  <option value="Atenuare">Atenuare</option>
                  <option value="Echipament">Echipament</option>
                </select>
                <small>Alege categoria care descrie natura problemei constatate.</small>
              </label>

              <div className="intervention-photo-heading">
                <div><h3>Fotografii constatare</h3><p>Imagini clare din care reiese natura avariei.</p></div>
                <span>{validPhotos.length} {validPhotos.length === 1 ? "poză GPS" : "poze GPS"}</span>
              </div>

              <label className={`intervention-photo-upload${uploading ? " is-uploading" : ""}`}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  disabled={uploading}
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    event.currentTarget.value = "";
                    void addPhotos(selectedFiles);
                  }}
                />
                <span className="intervention-upload-icon">⌖</span>
                <strong>{uploading ? "Se identifică poziția și se încarcă..." : "Adaugă fotografii cu GPS"}</strong>
                <small>Accesul la locația dispozitivului este obligatoriu.</small>
              </label>

              {loadingPhotos && <p className="intervention-loading">Se verifică fotografiile salvate...</p>}

              {photos.length > 0 && <div className="intervention-photo-grid">
                {photos.map((photo) => <article className="intervention-photo-item" key={photo.id}>
                  <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Deschide fotografia ${photo.name}`}>
                    <img src={photo.url} alt={`Constatare avarie: ${photo.name}`} loading="lazy" />
                  </a>
                  <div className="intervention-photo-meta"><strong>{photo.name}</strong><span>⌖ {photo.geo}</span><small>{formatCapturedAt(photo.capturedAt)}</small></div>
                  <button type="button" onClick={() => void removePhoto(photo)} disabled={removingId === photo.id} aria-label={`Șterge fotografia ${photo.name}`}>{removingId === photo.id ? "..." : "Șterge"}</button>
                </article>)}
              </div>}

              {error && <p className="intervention-error" role="alert">{error}</p>}
            </div>
          </section>

          <aside className="client-summary intervention-summary">
            <div className="summary-title"><span>✓</span><div><h2>Validare constatare</h2><p>{project.id} · Intervenție</p></div></div>
            <div className="summary-progress"><div><span>Progres</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>
            <div className="summary-checklist">
              <div className={damageType ? "done" : ""}><span>{damageType ? "✓" : "○"}</span><p><strong>Tipul avariei</strong><small>{damageType || "În așteptare"}</small></p></div>
              <div className={validPhotos.length ? "done" : ""}><span>{validPhotos.length ? "✓" : "○"}</span><p><strong>Fotografii geotagate</strong><small>{validPhotos.length ? `${validPhotos.length} ${validPhotos.length === 1 ? "fotografie cu GPS valid" : "fotografii cu GPS valid"}` : "Minimum o fotografie obligatorie"}</small></p></div>
            </div>
            <div className="geo-notice"><span>⌖</span><p><strong>GPS, dată și oră obligatorii</strong>Fotografiile sunt marcate direct cu poziția, data și ora constatării.</p></div>
            {initialSummary?.assessment?.documentedAt && <p className="intervention-saved-note">Salvată: {formatCapturedAt(initialSummary.assessment.documentedAt)}</p>}
            <button className="primary-button submit-documentation" type="submit" disabled={!ready || saving || uploading || loadingPhotos}>{saving ? "Se salvează..." : "Salvează constatarea"} <span>→</span></button>
          </aside>
        </form>
      ) : section === "execution" ? (
        <InterventionExecutionSection project={project} initialSummary={initialSummary} onNotify={onNotify} onSaved={onSaved} />
      ) : (
        <section className="project-card activity-workflow-card intervention-pending-card">
          <div className="card-heading"><div><h2>Documentarea intervenției</h2><p>Secțiune separată, dedicată intervențiilor.</p></div></div>
          <p>Documentele și fotografiile finale ale intervenției vor fi configurate separat.</p>
        </section>
      )}
    </div>
  );
}
