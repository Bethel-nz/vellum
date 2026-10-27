// Endpoints from the vendors' own MCP documentation; connections are never simulated.
export const mcpCatalog = [
  { name: 'Linear', url: 'https://mcp.linear.app/mcp', description: 'Issues, projects and comments' },
  { name: 'Notion', url: 'https://mcp.notion.com/mcp', description: 'Pages, databases and workspace search' },
  { name: 'Figma', url: 'https://mcp.figma.com/mcp', description: 'Design context and files' },
  { name: 'Vercel', url: 'https://mcp.vercel.com', description: 'Projects, deployments and build logs', note: 'Vercel may restrict access to approved clients.' },
] as const
