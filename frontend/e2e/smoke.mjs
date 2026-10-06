import {launch,newPage,login,shot} from './lib.mjs';
const browser=await launch();
const page=await newPage(browser);
await login(page,'faculty1@example.com');
await page.goto('/faculty/offerings/dbe0fd57-e56c-486d-be77-275dfb54b967/gradebook');
await page.getByRole('heading',{name:'Gradebook'}).waitFor();
console.log('screenshot',await shot(page,'smoke-gradebook'));
await browser.close();
