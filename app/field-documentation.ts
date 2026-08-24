export type RouteMethod = "aerial" | "duct" | "tray" | "facade";

export type RouteSegmentSummary = {
  method: RouteMethod;
  label: string;
  cableType: string;
  lengthMeters: number;
};

export type RouteFieldSummary = {
  segments: RouteSegmentSummary[];
  totalLengthMeters: number;
  junction: {
    label: string;
    documented: boolean;
    kind: "documented" | "existing" | "new";
    network?: "mobile" | "fixed";
  };
  aerialMaterials: {
    boat: number;
    stainlessClamp: number;
    hook: number;
    armorod: number;
  };
  endpoints?: {
    a: { id: string; code: string; name: string; detail: string; documented: boolean; lat: number; lon: number };
    b: { id: string; code: string; name: string; detail: string; documented: boolean; lat: number; lon: number };
  };
  routePoints?: Array<{ lat: number; lon: number }>;
};

export type SpliceFieldSummary = {
  count: number;
  junctions: Array<{
    label: string;
    documented: boolean;
    kind: "documented" | "existing" | "new";
  }>;
  records?: Array<{
    id: string;
    projectId: string;
    junction: { id: string; code: string; name: string; region: string; documented: boolean; lat: number; lon: number };
    junctionKind: "" | "existing" | "new";
    network: "" | "mobile" | "fixed";
    siteBuffer: string;
    siteFiber: string;
    clientBuffer: string;
    clientFiber: string;
    photos: Record<"open" | "closed" | "placed", string>;
  }>;
};

export type SiteFieldSummary = {
  odf: string;
  odfPort: string;
  etn: string;
  etnPort: string;
  photos?: Record<"odfPort" | "etn" | "overview", string>;
};

export type ClientFieldSummary = {
  service: "Internet" | "VPN" | "Internet+OL" | "OL";
  equipment: string[];
};

export type ProjectFieldDocumentation = {
  client?: ClientFieldSummary;
  route?: RouteFieldSummary;
  splices?: SpliceFieldSummary;
  site?: SiteFieldSummary;
};
