# OCX Registry Protocol v2

This document specifies the HTTP API that OCX-compatible registries must implement.

> **V2 Changes:** Registry targets are now root-relative (no `.opencode/` prefix required). The OCX CLI handles path resolution based on component type.

## Discovery (Optional)

```
GET /.well-known/ocx.json
```

Enables automatic registry discovery from a domain. If provided, clients can register using just the domain URL.

**Response:**

```json
{
  "version": 1,
  "registry": "/index.json"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Protocol version (currently `1`) |
| `registry` | string | Path to the registry index endpoint |

If not provided, clients must be configured with the full registry URL.

## Required Endpoints

### Registry Index

```
GET /index.json
```

Returns registry metadata and a list of available components. Must conform to [`registry.schema.json`](./schemas/registry.schema.json).

**Response:**

```json
{
  "$schema": "https://ocx.kdco.dev/schemas/registry.json",
  "name": "My Registry",
  "namespace": "myregistry",
  "version": "1.0.0",
  "author": "Your Name",
  "components": [
    {
      "name": "my-skill",
      "type": "skill",
      "version": "1.0.0",
      "description": "A helpful skill"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | No | Schema URL for validation |
| `name` | string | Yes | Human-readable registry name |
| `namespace` | string | Yes | Unique identifier (kebab-case) |
| `version` | string | Yes | Registry version (semver recommended) |
| `author` | string | Yes | Registry author or organization |
| `components` | array | Yes | List of available components |

### Component Packument

```
GET /components/{name}.json
```

Returns full component metadata in npm-style packument format.

**Response:**

```json
{
  "name": "my-skill",
  "dist-tags": {
    "latest": "1.0.0"
  },
  "versions": {
    "1.0.0": {
      "name": "my-skill",
      "type": "skill",
      "version": "1.0.0",
      "description": "A helpful skill",
      "files": [
        {
          "path": "SKILL.md",
          "target": "skills/my-skill/SKILL.md"
        }
      ],
      "dependencies": [],
      "opencode": {}
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Component identifier |
| `dist-tags` | object | Version aliases (`latest` required) |
| `versions` | object | Map of version string to component manifest |

See [`registry.schema.json`](./schemas/registry.schema.json) for the full component manifest schema.

### File Content

```
GET /components/{name}/{path}
```

Returns raw file content for installation.

**Response:** Raw file content with appropriate MIME type.

| Path | Content-Type |
|------|--------------|
| `*.md` | `text/markdown` |
| `*.ts` | `text/typescript` |
| `*.json` | `application/json` |
| Other | `text/plain` |

## Component Types

| Type | Install Location | Description |
|------|------------------|-------------|
| `skill` | `skills/{name}/` | AI behavior instructions |
| `plugin` | `plugin/` | OpenCode plugins |
| `agent` | `agent/` | Custom agent definitions |
| `command` | `command/` | Custom CLI commands |
| `tool` | `tool/` | Custom tools |
| `bundle` | (varies) | Meta-package grouping other components |
| `profile` | `~/.config/opencode/profiles/{name}/` | Shareable profile configuration |

**Note:** Targets in registry files are root-relative. The OCX CLI resolves them to the appropriate `.opencode/` subdirectory based on component type.

## Example: Minimal Compliant Registry

```
/index.json
/components/my-skill.json
/components/my-skill/SKILL.md
```

**`/index.json`:**

```json
{
  "name": "Minimal Registry",
  "namespace": "minimal",
  "version": "1.0.0",
  "author": "Your Name",
  "components": [
    { "name": "my-skill", "type": "skill", "version": "1.0.0" }
  ]
}
```

**`/components/my-skill.json`:**

```json
{
  "name": "my-skill",
  "dist-tags": { "latest": "1.0.0" },
  "versions": {
    "1.0.0": {
      "name": "my-skill",
      "type": "skill",
      "version": "1.0.0",
      "files": [{ "path": "SKILL.md" }]
    }
  }
}
```

## Hosting Options

Registries can be hosted on:

- **Static hosting** (GitHub Pages, Netlify, Vercel) - Pre-build with `ocx build`
- **Cloudflare Workers** - Dynamic generation from source
- **Any HTTP server** - As long as it serves the required endpoints

## Related Documentation

- [Registry Schema](./schemas/registry.schema.json) - Full JSON Schema for validation
- [Creating a Registry](../registry/REGISTRY.md) - Guide to building your own registry
- [Enterprise Features](./ENTERPRISE.md) - Locking, versioning, and integrity verification
