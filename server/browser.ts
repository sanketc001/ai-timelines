import type { Browser, Page } from 'playwright'

let _browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser
  const { chromium } = await import('playwright')
  _browser = await chromium.launch({ headless: true })
  return _browser
}

export interface BrowseResult {
  url: string
  title: string
  text: string
  links: { text: string; href: string }[]
}

export async function browsePage(url: string): Promise<BrowseResult> {
  const browser = await getBrowser()
  let page: Page | null = null
  try {
    page = await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const title = await page.title()

    // Extract readable text — strip nav/footer noise
    const text = await page.evaluate(() => {
      const remove = document.querySelectorAll('nav,footer,header,script,style,noscript,aside')
      remove.forEach((el) => el.remove())
      return (document.body?.innerText ?? '').replace(/\s{3,}/g, '\n\n').slice(0, 2500)
    })

    // Collect visible links with non-trivial text
    const links: { text: string; href: string }[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => ({ text: (a as HTMLAnchorElement).innerText.trim(), href: (a as HTMLAnchorElement).href }))
        .filter((l) => l.text.length > 3 && l.href.startsWith('http'))
        .slice(0, 15),
    )

    return { url, title, text, links }
  } finally {
    await page?.close()
  }
}
