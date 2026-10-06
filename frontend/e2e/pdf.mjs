// Opens exported PDFs in headless Edge and screenshots the first page, for a visual review of the layout.
import {launch,newPage} from './lib.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const browser=await launch();
const page=await newPage(browser,{width:1250,height:880});
for(const n of process.argv.slice(2)){
  await page.goto(pathToFileURL(resolve(`../var/screens/export-${n}.pdf`)).href);
  await page.waitForTimeout(2500);
  await page.screenshot({path:`../var/screens/pdf-${n}.png`});
}
await browser.close();
