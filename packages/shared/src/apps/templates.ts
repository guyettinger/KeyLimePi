import type { AppTemplate, AppTemplateConfig } from '@keylimepi/core'

/**
 * The `.gitignore` every new sub-app is seeded with.
 *
 * Not a tidiness measure. `git_status` reports untracked files as modified, so
 * without this an app that has run `install_deps` answers the agent's first
 * `git_status` with every path under `node_modules/` — on a real project that is a
 * result of several hundred kilobytes, far more than the whole context window, and
 * the request that carries it cannot succeed. Ignored *and untracked* files are
 * skipped by `statusMatrix`, which is what keeps the result small.
 *
 * `.chat-history/` is the pre-Pi transcript store. Nothing writes it any more, but an
 * app scaffolded before Key Lime Pi adopted Pi's own sessions still has one on disk, and
 * an entry that only ever matches a legacy directory is far cheaper than the alternative
 * — the backfill in `migrate-workspace.ts` writes *this* file into apps that were
 * scaffolded before there was a default at all, so anything it must cover belongs here
 * rather than in a second, divergent copy of the list.
 *
 * `memory/` is the agent's durable notes, and ignoring it is the whole reason the
 * directory works. `initGitRepo` adds every file, so without this entry every note the
 * agent writes would be tracked and auto-committed — and `rollback` is a `git checkout`,
 * which would then revert the note explaining the failure being rolled back, at exactly
 * the moment it was worth having. Ignored *and untracked*, it survives instead, and
 * costs nothing in `git_status` or the changed-files strip.
 *
 * A template may still ship its own `.gitignore`; this is only the default.
 */
export const DEFAULT_GITIGNORE = `# Dependencies
node_modules/

# Build output
dist/
build/
out/
.vite/
*.tsbuildinfo

# Logs
*.log
npm-debug.log*
yarn-debug.log*

# Environment
.env
.env.local
.env.*.local

# Key Lime Pi runtime state
.chat-sessions.json
.chat-history/
memory/

# Editor and OS
.DS_Store
Thumbs.db
.idea/
.vscode/
`

/**
 * The `AGENTS.md` every new sub-app is seeded with.
 *
 * Pi loads this file into every request, so it is the one place a fact about the app is
 * guaranteed to be in front of the model without a tool call. No template has ever
 * written one, which meant the only thing the agent knew about an app was its source.
 *
 * It is deliberately about the *app*, not about method. The method lives in the system
 * prompt and in the `plan`, `implement` and `remember` skills, and restating it here
 * would charge every request twice for the same instruction. What belongs here is what
 * only this app can say.
 *
 * It is also agent-writable under `acceptEdits` and paid for on every request, so the
 * file says so about itself. An `AGENTS.md` that grows unnoticed is a permanent tax on
 * the context window, visible in the context meter's `context-files` block and nowhere
 * else.
 */
export const DEFAULT_AGENTS_MD = `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Running It

<!-- Fill this in once you know: the command, the port, anything that has to be running
     first. Read it from package.json rather than guessing. -->

## Conventions

<!-- Record the decisions this app has made that its source does not state outright. -->

## Memory

Durable notes live in \`memory/\`. \`memory/INDEX.md\` has one line per note saying when
that note matters — read it before starting work and open only what applies. The plan for
the task in progress is \`memory/task.md\`. Load the \`remember\` skill for the format.

\`memory/\` is not committed, so it survives a rollback of the code.

---

Keep this file short — it is sent with every request. Anything longer than a screen
belongs in a memory note or a skill, not here.
`

/**
 * The starting `memory/INDEX.md`.
 *
 * Seeded rather than left for the agent to create, because an empty directory is
 * indistinguishable from a missing feature: a model told to read `memory/INDEX.md` and
 * handed a failed `read` learns that memory does not work in this app. A file that
 * exists and says it is empty teaches the format instead.
 *
 * The example line is commented out. An uncommented one would be a note about a file
 * that does not exist, which is the one thing an index must never contain.
 */
export const DEFAULT_MEMORY_INDEX = `# Memory Index

One line per note: the file name, then when that note matters. Read this before starting
work and open only the notes that apply.

<!-- - api-shape.md — the /api/items response fields, and which are optional -->
`

/**
 * Get all available templates.
 */
export function getTemplates(): AppTemplateConfig[] {
  return [
    getReactViteTemplate(),
    getNodeCliTemplate(),
    getNodeServerTemplate(),
    getStaticSiteTemplate(),
    getBlankTemplate()
  ]
}

/**
 * Get a specific template by ID.
 */
export function getTemplate(id: AppTemplate): AppTemplateConfig {
  const templates: Record<AppTemplate, () => AppTemplateConfig> = {
    'react-vite': getReactViteTemplate,
    'node-cli': getNodeCliTemplate,
    'node-server': getNodeServerTemplate,
    'static-site': getStaticSiteTemplate,
    'blank': getBlankTemplate
  }
  return templates[id]()
}

function getReactViteTemplate(): AppTemplateConfig {
  return {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'Modern React app with Vite bundler',
    files: [
      {
        path: 'src/main.tsx',
        content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)`
      },
      {
        path: 'src/App.tsx',
        content: `export function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          {{APP_NAME}}
        </h1>
        <p className="text-gray-600">{{APP_DESCRIPTION}}</p>
      </div>
    </div>
  )
}`
      },
      {
        path: 'src/index.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{APP_NAME}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()]
})`
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Development

\`\`\`bash
bun install
bun run dev
\`\`\`

## Build

\`\`\`bash
bun run build
\`\`\``
      }
    ],
    dependencies: {
      'react': '^19.0.0',
      'react-dom': '^19.0.0'
    },
    devDependencies: {
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      '@vitejs/plugin-react': '^4.0.0',
      'typescript': '^5.5.0',
      'vite': '^6.0.0',
      'tailwindcss': '^4.0.0',
      '@tailwindcss/vite': '^4.0.0'
    },
    scripts: {
      'dev': 'vite',
      'build': 'tsc && vite build',
      'preview': 'vite preview'
    }
  }
}

function getNodeCliTemplate(): AppTemplateConfig {
  return {
    id: 'node-cli',
    name: 'Node.js CLI',
    description: 'Command-line tool with TypeScript',
    files: [
      {
        path: 'src/index.ts',
        content: `#!/usr/bin/env node

/**
 * {{APP_NAME}}
 * {{APP_DESCRIPTION}}
 */

const args = process.argv.slice(2)

console.log('{{APP_NAME}}')
console.log('Arguments:', args)

// Your CLI logic here
`
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Usage

\`\`\`bash
bun run src/index.ts [args]
\`\`\``
      }
    ],
    devDependencies: {
      'typescript': '^5.5.0',
      '@types/node': '^22.0.0'
    },
    scripts: {
      'start': 'bun run src/index.ts',
      'build': 'tsc'
    }
  }
}

function getNodeServerTemplate(): AppTemplateConfig {
  return {
    id: 'node-server',
    name: 'Node.js Server',
    description: 'HTTP server with Hono framework',
    files: [
      {
        path: 'src/index.ts',
        content: `import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

app.get('/', (c) => {
  return c.json({
    name: '{{APP_NAME}}',
    description: '{{APP_DESCRIPTION}}'
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

const port = process.env.PORT ?? 3000
console.log(\`Server running at http://localhost:\${port}\`)

serve({ fetch: app.fetch, port: Number(port) })
`
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Development

\`\`\`bash
bun install
bun run dev
\`\`\`

## API

- \`GET /\` - App info
- \`GET /health\` - Health check`
      }
    ],
    dependencies: {
      'hono': '^4.0.0',
      '@hono/node-server': '^1.0.0'
    },
    devDependencies: {
      'typescript': '^5.5.0',
      '@types/node': '^22.0.0'
    },
    scripts: {
      'dev': 'bun run --watch src/index.ts',
      'start': 'bun run src/index.ts'
    }
  }
}

function getStaticSiteTemplate(): AppTemplateConfig {
  return {
    id: 'static-site',
    name: 'Static Site',
    description: 'Simple HTML/CSS/JS website',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{APP_NAME}}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>{{APP_NAME}}</h1>
    <p>{{APP_DESCRIPTION}}</p>
  </main>
  <script src="script.js"></script>
</body>
</html>`
      },
      {
        path: 'styles.css',
        content: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, sans-serif;
  line-height: 1.5;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

main {
  text-align: center;
  padding: 2rem;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  color: #333;
}

p {
  color: #666;
}`
      },
      {
        path: 'script.js',
        content: `// {{APP_NAME}}
console.log('App loaded!')
`
      },
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

## Development

Open \`index.html\` in a browser, or use a local server:

\`\`\`bash
npx serve .
\`\`\``
      }
    ],
    scripts: {
      'dev': 'npx serve .'
    }
  }
}

function getBlankTemplate(): AppTemplateConfig {
  return {
    id: 'blank',
    name: 'Blank Project',
    description: 'Empty project directory',
    files: [
      {
        path: 'README.md',
        content: `# {{APP_NAME}}

{{APP_DESCRIPTION}}

This is a blank project. Add your files here!`
      }
    ]
  }
}

/**
 * The values a template's placeholders are replaced with.
 */
export interface TemplateVars {
  /** The app's display name. */
  name: string
  /** The app's description, or an empty string. */
  description: string
  /** The app's id. */
  id: string
}

/**
 * Substitute a template's placeholders.
 *
 * Lifted out of `createApp`'s template-file loop because two other callers render the
 * same placeholders: the `AGENTS.md` seeded beside them, and the backfill in
 * `migrate-workspace.ts` that gives an existing app the one it was scaffolded without.
 * A second, divergent copy of the replacement chain is how one of them silently stops
 * substituting — leaving a literal `{{APP_NAME}}` in a file that goes into every request.
 *
 * @param content - The template text
 * @param vars - The app's name, description and id
 * @returns The text with every placeholder replaced
 */
export function applyTemplateVars(content: string, vars: TemplateVars): string {
  return content
    .replace(/\{\{APP_NAME\}\}/g, vars.name)
    .replace(/\{\{APP_DESCRIPTION\}\}/g, vars.description)
    .replace(/\{\{APP_ID\}\}/g, vars.id)
}
