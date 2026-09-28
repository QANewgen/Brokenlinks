const { test, request } = require('@playwright/test');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

test('Find Broken Links and Images', async ({ browser }) => {

  test.setTimeout(60 * 60 * 1000); // 1 Hour

  const START_URL = 'https://www.hyderabad.aero/';
  const DOMAIN = new URL(START_URL).origin;

  const visitedPages = new Set();
  const queuedPages = new Set();

  const checkedLinks = new Set();
  const checkedImages = new Set();

  const pagesToVisit = [START_URL];
  queuedPages.add(START_URL);

  const results = [];

  const context = await browser.newContext();

  const page = await context.newPage();

  const apiContext = await request.newContext({
    ignoreHTTPSErrors: true,
  });

  function normalize(url) {
    try {
      const u = new URL(url);

      u.hash = '';
      u.search = '';
      u.pathname = u.pathname.replace(/\/$/, '');

      return u.toString();
    } catch {
      return url;
    }
  }

  async function checkUrl(url) {

    try {

      let response = await apiContext.fetch(url, {
        method: 'HEAD',
        timeout: 15000,
      });

      if (
        response.status() === 405 ||
        response.status() === 501
      ) {
        response = await apiContext.get(url, {
          timeout: 15000,
        });
      }

      return response.status();

    } catch {

      return 'ERROR';

    }

  }

  while (pagesToVisit.length) {

    const currentUrl = normalize(pagesToVisit.shift());

    if (
      visitedPages.has(currentUrl) ||
      !currentUrl.startsWith(DOMAIN)
    ) {
      continue;
    }

    visitedPages.add(currentUrl);

    console.log(
      `\nScanning: ${currentUrl}`
    );

    console.log(
      `Visited: ${visitedPages.size} | Queue: ${pagesToVisit.length}`
    );

    try {

      await page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // ===========================
      // LINKS
      // ===========================

      const links = await page.$$eval(
        'a[href]',
        els => els.map(e => e.href)
      );

      for (let link of links) {

        if (!link) continue;

        if (
          link.startsWith('mailto:') ||
          link.startsWith('tel:') ||
          link.startsWith('javascript:')
        ) continue;

        link = normalize(link);

        if (checkedLinks.has(link))
          continue;

        checkedLinks.add(link);

        const status = await checkUrl(link);

        results.push({
          page: currentUrl,
          type: 'Link',
          url: link,
          status,
          result:
            status === 'ERROR' || status >= 400
              ? 'Broken'
              : 'Working',
        });

        if (
          typeof status === 'number' &&
          status < 400 &&
          link.startsWith(DOMAIN)
        ) {

          if (
            !visitedPages.has(link) &&
            !queuedPages.has(link)
          ) {

            if (
              !/\.(pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|mp3|xls|xlsx|doc|docx|ppt|pptx)$/i.test(link)
            ) {

              queuedPages.add(link);
              pagesToVisit.push(link);

            }

          }

        }

      }

      // ===========================
      // IMAGES
      // ===========================

      const images = await page.$$eval(
        'img[src]',
        imgs => imgs.map(img => img.src)
      );

      for (let image of images) {

        if (!image)
          continue;

        image = normalize(image);

        if (checkedImages.has(image))
          continue;

        checkedImages.add(image);

        const status = await checkUrl(image);

        results.push({
          page: currentUrl,
          type: 'Image',
          url: image,
          status,
          result:
            status === 'ERROR' || status >= 400
              ? 'Broken'
              : 'Working',
        });

      }

    } catch (e) {

      console.log(`Failed: ${currentUrl}`);

      results.push({
        page: currentUrl,
        type: 'Page',
        url: currentUrl,
        status: 'ERROR',
        result: 'Page Failed',
      });

    }

  }

  const csvWriter = createCsvWriter({
    path: 'broken-links-images-report.csv',
    header: [
      { id: 'page', title: 'PAGE' },
      { id: 'type', title: 'TYPE' },
      { id: 'url', title: 'URL' },
      { id: 'status', title: 'STATUS' },
      { id: 'result', title: 'RESULT' },
    ],
  });

  await csvWriter.writeRecords(results);

  console.log('\n===================================');
  console.log(`Pages Crawled : ${visitedPages.size}`);
  console.log(`Links Checked : ${checkedLinks.size}`);
  console.log(`Images Checked: ${checkedImages.size}`);
  console.log(`Records Saved : ${results.length}`);
  console.log('CSV Generated : broken-links-images-report.csv');
  console.log('===================================\n');

  await context.close();

});