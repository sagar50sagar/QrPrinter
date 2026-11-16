/**
 * Single source of truth for the brand.
 *
 * PLACEHOLDER VALUES — nothing here is a real brand decision.
 * Rename the product, point `url` at your domain and drop a real logo in
 * `src/components/ui/Logo.jsx` before you go live. `url` is also used to build
 * the Open Graph image URL, so set it to the absolute public origin.
 */
export const brand = {
  name: 'QrPrinter',
  tagline: 'Printing & scanning management for cyber cafes',
  url: 'https://example.com',
  /** Where the product itself lives. Every "Login" / "Get Started" button
   *  builds its href from this value — change it once, site-wide. */
  appUrl: 'https://app.example.com',
  supportEmail: 'support@example.com',
  ogImage: '/og-cover.svg',
  themeColor: '#0e1c33',
  copyrightName: 'QrPrinter',
}

export const nav = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Compatibility', href: '#compatibility' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

