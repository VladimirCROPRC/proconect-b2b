declare module "gdal3.js" {
  type GdalDataset = unknown;
  type GdalResult = unknown;
  type GdalApi = {
    open(files: File[]): Promise<{ datasets: GdalDataset[] }>;
    ogr2ogr(dataset: GdalDataset, options: string[]): Promise<GdalResult>;
    getFileBytes(result: GdalResult): Promise<Uint8Array>;
    close(dataset: GdalDataset): void;
  };
  export default function initGdalJs(options?: { paths?: { wasm?: string; data?: string; js?: string } }): Promise<GdalApi>;
}

declare module "gdal3.js/dist/package/gdal3.js?url" {
  const url: string;
  export default url;
}

declare module "gdal3.js/dist/package/gdal3WebAssembly.data?url" {
  const url: string;
  export default url;
}

declare module "gdal3.js/dist/package/gdal3WebAssembly.wasm?url" {
  const url: string;
  export default url;
}
