import { brand } from './brand.js'

/**
 * Every outbound destination in one table. Login and sign-up both open the
 * counter panel at /panel/ — same origin, served by Vite in dev and Express in
 * production — which shows its own sign-in / create-shop gate. The rest are
 * defined here rather than scattered through the components.
 */
export const links = {
  login: '/panel/',
  signup: '/panel/',
  contact: `mailto:${brand.supportEmail}?subject=Enquiry%20about%20${encodeURIComponent(brand.name)}`,
  support: `mailto:${brand.supportEmail}?subject=Support%20request`,
  help: '/help.html',
  privacy: '/privacy.html',
  terms: '/terms.html',
}

/**
 * Content files describe intent ('signup', 'contact') rather than a URL so the
 * same entry can be reused in the navbar, a section and the footer.
 */
export function resolveHref({ href, kind }) {
  if (href) return href
  return links[kind] ?? links.signup
}

export function isExternal(href) {
  return /^(https?:|mailto:|tel:)/.test(href)
}
