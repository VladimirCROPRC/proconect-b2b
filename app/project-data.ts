import type { ProjectFieldDocumentation } from "./field-documentation";

export type ProjectRecord = {
  id: string;
  client: string;
  address: string;
  contact: string;
  phone: string;
  email: string;
  requirements: string;
  technician: string;
  cpe: string;
  sfp: boolean;
  mc: boolean;
  terminalBox: boolean;
  status: "Planificat" | "În desfășurare" | "De verificat" | "Finalizat";
  date: string;
  ipwo: string;
  splice: string;
};

export const initialProjects: ProjectRecord[] = [
  {
    id: "RID10482",
    client: "Novatel Systems SRL",
    address: "Șos. Pipera 42, București",
    contact: "Marius Dinu",
    phone: "+40 722 318 449",
    email: "marius.dinu@novatel.ro",
    requirements: "Instalare serviciu business 1 Gbps, montare CPE în rack-ul existent și etichetarea completă a fibrei.",
    technician: "Vlad",
    cpe: "Cisco C1111-8P",
    sfp: true,
    mc: false,
    terminalBox: true,
    status: "În desfășurare",
    date: "21 aug, 09:30",
    ipwo: "IPWO_10482.pdf",
    splice: "Diagrama_suduri_10482.pdf",
  },
  {
    id: "RID10479",
    client: "Medica Distribution",
    address: "Str. Fabricii 18, Cluj-Napoca",
    contact: "Irina Pavel",
    phone: "+40 733 614 221",
    email: "i.pavel@medicadistribution.ro",
    requirements: "Conectare sediu nou, instalare media converter și predarea testelor de putere optică reprezentantului clientului.",
    technician: "Vlad",
    cpe: "Huawei AR651C",
    sfp: true,
    mc: true,
    terminalBox: true,
    status: "Planificat",
    date: "22 aug, 11:00",
    ipwo: "IPWO_10479.pdf",
    splice: "Diagrama_10479.png",
  },
  {
    id: "RID10471",
    client: "Logistic Hub Vest",
    address: "Calea Aradului 71, Timișoara",
    contact: "Vlad Roșu",
    phone: "+40 744 102 876",
    email: "vlad.rosu@lhv.ro",
    requirements: "Extindere traseu FO până în camera tehnică și documentarea tuturor punctelor de acces.",
    technician: "Vlad",
    cpe: "MikroTik CCR2004",
    sfp: true,
    mc: false,
    terminalBox: false,
    status: "De verificat",
    date: "20 aug, 14:15",
    ipwo: "IPWO_10471.pdf",
    splice: "Schema_10471.pdf",
  },
  {
    id: "RID10465",
    client: "Nordic Office Park",
    address: "Bd. Dimitrie Pompeiu 9, București",
    contact: "Elena Matei",
    phone: "+40 721 558 104",
    email: "elena.matei@nordicpark.ro",
    requirements: "Migrare conexiune pe noul CPE fără întreruperea serviciului principal.",
    technician: "Vlad",
    cpe: "Cisco C1111-8P",
    sfp: true,
    mc: false,
    terminalBox: true,
    status: "Finalizat",
    date: "19 aug, 10:00",
    ipwo: "IPWO_10465.pdf",
    splice: "Diagrama_10465.pdf",
  },
];

export const initialCpeCatalog = [
  "Cisco C1111-8P",
  "Huawei AR651C",
  "MikroTik CCR2004",
  "Nokia 7250 IXR-e",
];

export const initialFieldDocumentation: Record<string, ProjectFieldDocumentation> = {
  RID10482: {
    client: { service: "Internet", equipment: ["Cisco C1111-8P", "SFP optic", "Terminal Box"] },
    route: {
      segments: [
        { method: "aerial", label: "Aerian pe stâlpi", cableType: "FO ADSS 4 fibre", lengthMeters: 150 },
        { method: "duct", label: "Monotub / canalizație", cableType: "FO ADSS 4 fibre", lengthMeters: 150 },
        { method: "tray", label: "Pat de cablu", cableType: "FO LSZH 4 fibre", lengthMeters: 100 },
      ],
      totalLengthMeters: 400,
      junction: { label: "JU29738 · joncțiune documentată", documented: true, kind: "documented" },
      aerialMaterials: { boat: 4, stainlessClamp: 8, hook: 4, armorod: 4 },
    },
    splices: { count: 1, junctions: [{ label: "JU29738", documented: true, kind: "documented" }] },
    site: { odf: "ODF-L9045", odfPort: "1", etn: "ro-sb-L9045-sw1", etnPort: "1" },
  },
};
