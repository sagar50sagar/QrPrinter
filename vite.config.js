import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { brand } from './src/config/brand.js'

/** Keeps index.html metadata in sync with src/config/brand.js. */
function brandMeta() {
  const tokens = {
    '%BRAND_NAME%': brand.name,
    '%OG_TITLE%': `Complete Printing & Scanning Management for Cyber Cafes | ${brand.name}`,
    '%DESCRIPTION%':
      `${brand.name} helps cyber cafes and document service centres manage document scanning, ` +
      'printing, multiple printers and print jobs from one simple web dashboard.',
    '%THEME_COLOR%': brand.themeColor,
    '%SITE_URL%': brand.url,
    '%OG_IMAGE_URL%': `${brand.url}${brand.ogImage}`,
  }
  return {
    name: 'brand-meta',
    transformIndexHtml(html) {
      return html.replace(/%[A-Z_]+%/g, (token) => tokens[token] ?? token)
    },
  }
}

/** In dev, serve the customer upload entry for any permanent /s/:shop link. */
function customerRoute() {
  return {
    name: 'customer-route',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/s/')) req.url = '/customer.html'
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandMeta(), customerRoute()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) },
  },
  build: {
    assetsDir: 'assets',
    modulePreload: { polyfill: false },
    rollupOptions: {
      // The marketing page, the counter panel, the customer upload page and the
      // platform console are one project with four entries, sharing the token
      // file and React.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        panel: fileURLToPath(new URL('./panel/index.html', import.meta.url)),
        customer: fileURLToPath(new URL('./customer.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
      },
    },
  },
  // '::' dual-stacks on Windows: the default 'localhost' binds ::1 only, and
  // Chrome then refuses whichever module request it races down IPv4.
  server: {
    port: 5173,
    host: '::',
    // The product server owns the API, the agent channel and document bytes.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/documents': 'http://127.0.0.1:8787',
      '/download': 'http://127.0.0.1:8787',
      '/agent': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
})
