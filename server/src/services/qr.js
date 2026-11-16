import QRCode from 'qrcode'
import { config } from '../config.js'

/** The permanent customer link a shop's QR encodes. */
export const shopLink = (slug) => `${config.publicBaseUrl}/s/${slug}`

export function qrPng(slug) {
  return QRCode.toBuffer(shopLink(slug), {
    type: 'png',
    width: 640,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}

export function qrSvg(slug) {
  return QRCode.toString(shopLink(slug), {
    type: 'svg',
    width: 640,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}