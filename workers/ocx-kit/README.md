# OCX Kit Registry

A component registry for [OpenCode](https://opencode.ai) deployed on Cloudflare Workers.

## Quick Start

```bash
# Install dependencies
bun install

# Build the registry
bun run build

# Local development
bun run dev

# Deploy to Cloudflare
bun run deploy
```

## Using the Registry

```bash
# Install profile directly from registry
ocx profile add omo --source kit/omo --from https://ocx-kit.your-domain.workers.dev --global

# Or clone to customize
ocx profile add my-omo --clone omo --global
```

## Project Structure

```
├── registry.jsonc      # Registry manifest
├── files/              # Component source files
│   └── profiles/       # Profile configurations
├── dist/               # Built output (generated)
└── wrangler.jsonc      # Cloudflare Workers config
```

## Adding Components

1. Create your component files in `files/`
2. Register in `registry.jsonc`
3. Build and deploy: `bun run build && bun run deploy`

## Documentation

- [OCX CLI](https://github.com/kdcokenny/ocx)
- [OpenCode](https://opencode.ai)

## License

MIT
