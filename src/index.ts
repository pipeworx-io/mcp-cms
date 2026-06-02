interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * CMS Open Data MCP — US Centers for Medicare & Medicaid Services.
 *
 * Keyless. Covers Medicare & Medicaid public datasets: provider data,
 * spending, enrollment, drug pricing, quality measures, ACOs, hospitals,
 * nursing homes, physician/supplier utilization, etc.
 *
 * Datasets are addressed by a UUID `datasetId`. CMS exposes no list/search
 * endpoint on the data-api, so dataset discovery is done client-side against
 * the DCAT catalog at https://data.cms.gov/data.json (~155 datasets). Use
 * `search_datasets` to find datasetIds + titles, then `get_dataset` to pull
 * rows from `/dataset/{datasetId}/data`.
 */


const BASE = 'https://data.cms.gov/data-api/v1';
const CATALOG = 'https://data.cms.gov/data.json';
const UA = 'pipeworx-mcp-cms/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_datasets',
    description:
      'Find CMS dataset IDs + titles by keyword. CMS publishes Medicare/Medicaid open data (provider data, spending, enrollment, drug pricing, quality measures, hospitals, nursing homes, ACOs, etc.). Searches the CMS DCAT catalog client-side over each dataset title/description/keywords. Returns the datasetId (UUID) you pass to get_dataset and dataset_info.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search term, e.g. "hospital", "drug spending", "nursing home", "enrollment".' },
        limit: { type: 'number', description: 'Max datasets to return (default 25, max 100).' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_dataset',
    description:
      'Pull rows from a CMS dataset by datasetId (UUID from search_datasets). Returns an array of row objects whose keys are the dataset columns. Supports paging (size/offset), full-text keyword search across the dataset, and exact-match column filters via filters: {COLUMN: VALUE} (column names match the keys in returned rows, e.g. {"State": "TX"}).',
    inputSchema: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'Dataset UUID from search_datasets, e.g. "9767cb68-8ea9-4f0b-8179-9431abc89f11".' },
        size: { type: 'number', description: 'Rows per page (default 100).' },
        offset: { type: 'number', description: 'Row offset for paging (default 0).' },
        keyword: { type: 'string', description: 'Optional full-text search across all columns.' },
        filters: { type: 'object', description: 'Optional exact-match column filters, e.g. {"State": "TX", "Provider_Type": "Hospital"}. Becomes filter[COLUMN]=VALUE.' },
      },
      required: ['datasetId'],
    },
  },
  {
    name: 'dataset_info',
    description:
      'Metadata for a CMS dataset by datasetId: title, description, total row count, last-modified date, themes/keywords, and downloadable resources (CSV files, data dictionaries). Use after search_datasets to inspect a dataset before pulling rows.',
    inputSchema: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'Dataset UUID from search_datasets.' },
      },
      required: ['datasetId'],
    },
  },
];

interface CatalogDataset {
  title?: string;
  description?: string;
  keyword?: string[];
  theme?: string[];
  modified?: string;
  identifier?: string;
  distribution?: Array<{ format?: string; description?: string; accessURL?: string }>;
}

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function datasetIdOf(d: CatalogDataset): string | null {
  // The `identifier` is a /dataset/{uuid}/data-viewer URL on every dataset
  // (even CSV-only ones). Fall back to the latest API distribution accessURL.
  const fromId = d.identifier?.match(UUID_RE)?.[1];
  if (fromId) return fromId;
  const api = d.distribution?.find((x) => x.format === 'API' && x.description === 'latest');
  return api?.accessURL?.match(UUID_RE)?.[1] ?? null;
}

function hasApi(d: CatalogDataset): boolean {
  return !!d.distribution?.some((x) => x.format === 'API');
}

async function cmsGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`CMS: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  return res.json();
}

async function getCatalog(): Promise<CatalogDataset[]> {
  const res = await fetch(CATALOG, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`CMS: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  const json = (await res.json()) as { dataset?: CatalogDataset[] };
  return json.dataset ?? [];
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_datasets': {
      const kw = reqStr(args, 'keyword', '"hospital"').toLowerCase();
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      const datasets = await getCatalog();
      const matches = datasets
        .filter((d) => {
          const hay = [d.title, d.description, ...(d.keyword ?? []), ...(d.theme ?? [])].join(' ').toLowerCase();
          return hay.includes(kw);
        })
        .map((d) => ({
          datasetId: datasetIdOf(d),
          title: d.title,
          description: d.description?.slice(0, 300),
          themes: d.theme ?? [],
          keywords: d.keyword ?? [],
          modified: d.modified,
          apiAvailable: hasApi(d),
        }))
        .filter((d) => d.datasetId);
      return { keyword: args.keyword, total_matches: matches.length, returned: Math.min(matches.length, limit), datasets: matches.slice(0, limit) };
    }

    case 'get_dataset': {
      const id = reqStr(args, 'datasetId', '"9767cb68-8ea9-4f0b-8179-9431abc89f11"');
      const params = new URLSearchParams();
      params.set('size', String(args.size != null ? Number(args.size) : 100));
      if (args.offset != null) params.set('offset', String(Number(args.offset)));
      if (typeof args.keyword === 'string' && args.keyword.trim()) params.set('keyword', args.keyword);
      const filters = args.filters;
      if (filters && typeof filters === 'object') {
        for (const [col, val] of Object.entries(filters as Record<string, unknown>)) {
          params.set(`filter[${col}]`, String(val));
        }
      }
      const rows = await cmsGet(`/dataset/${encodeURIComponent(id)}/data?${params.toString()}`);
      return { datasetId: id, count: Array.isArray(rows) ? rows.length : 0, rows };
    }

    case 'dataset_info': {
      const id = reqStr(args, 'datasetId', '"9767cb68-8ea9-4f0b-8179-9431abc89f11"');
      const [catalog, statsRaw, resourcesRaw] = await Promise.all([
        getCatalog(),
        cmsGet(`/dataset/${encodeURIComponent(id)}/data/stats`).catch(() => null),
        cmsGet(`/dataset-resources/${encodeURIComponent(id)}`).catch(() => null),
      ]);
      const meta = catalog.find((d) => datasetIdOf(d) === id);
      const stats = statsRaw as { total_rows?: number } | null;
      const resources = (resourcesRaw as { data?: Array<{ name?: string; fileSize?: number; downloadURL?: string }> } | null)?.data ?? [];
      return {
        datasetId: id,
        title: meta?.title,
        description: meta?.description,
        themes: meta?.theme ?? [],
        keywords: meta?.keyword ?? [],
        modified: meta?.modified,
        total_rows: stats?.total_rows ?? null,
        apiAvailable: meta ? hasApi(meta) : null,
        resources: resources.map((r) => ({ name: r.name, fileSize: r.fileSize, downloadURL: r.downloadURL })),
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
