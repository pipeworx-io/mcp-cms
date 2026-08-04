# mcp-cms

CMS Open Data MCP — US Centers for Medicare & Medicaid Services.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_datasets` | Find CMS dataset IDs + titles by keyword. CMS publishes Medicare/Medicaid open data (provider data, spending, enrollment, drug pricing, quality measures, hospitals, nursing homes, ACOs, etc.). Searches the CMS DCAT catalog client-side over each dataset title/description/keywords. Returns the datasetId (UUID) you pass to get_dataset and dataset_info. |
| `get_dataset` | Pull rows from a CMS dataset by datasetId (UUID from search_datasets). Returns an array of row objects whose keys are the dataset columns. Supports paging (size/offset), full-text keyword search across the dataset, and exact-match column filters via filters: {COLUMN: VALUE} (column names match the keys in returned rows, e.g. {"State": "TX"}). |
| `dataset_info` | Metadata for a CMS dataset by datasetId: title, description, total row count, last-modified date, themes/keywords, and downloadable resources (CSV files, data dictionaries). Use after search_datasets to inspect a dataset before pulling rows. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "cms": {
      "url": "https://gateway.pipeworx.io/cms/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Cms data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
