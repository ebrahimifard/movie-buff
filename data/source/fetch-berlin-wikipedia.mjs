import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs';

const BASE_URL = 'https://en.wikipedia.org/wiki/Berlin_International_Film_Festival';

async function fetchBerlinData() {
  try {
    const response = await fetch(BASE_URL);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Debugging: Log all H2 headings to verify section names
    const allHeadings = Array.from(document.querySelectorAll('h2')).map(h2 => h2.textContent.trim());
    console.log('All H2 Headings:', allHeadings);

    // Placeholder for extraction logic
    const data = [];

    // Enhanced logic for History Section
    const historySection = Array.from(document.querySelectorAll('h2')).find(h2 => h2.textContent.includes('History'));
    if (historySection) {
      console.log('Processing History Section with refined logic for deeper content');
      let sibling = historySection.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2') {
        if (!['SPAN'].includes(sibling.tagName)) {
          if (['UL', 'TABLE', 'DIV', 'P'].includes(sibling.tagName)) {
            const text = sibling.textContent.trim();
            if (text) {
              data.push({ section: 'History', text });
            }
          } else if (sibling.children.length > 0) {
            Array.from(sibling.children).forEach(child => {
              const childText = child.textContent.trim();
              if (childText) {
                data.push({ section: 'History', text: childText });
              }
            });
          }
        }
        sibling = sibling.nextElementSibling;
      }
      // Log raw HTML for History Section
      console.log('Raw HTML for History Section:', historySection.outerHTML);
    }

    // Enhanced logic for Festival Programme Section
    const festivalProgrammeSection = Array.from(document.querySelectorAll('h2')).find(h2 => h2.textContent.includes('Festival programme'));
    if (festivalProgrammeSection) {
      console.log('Processing Festival Programme Section with refined logic for deeper content');
      let sibling = festivalProgrammeSection.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2') {
        if (!['SPAN'].includes(sibling.tagName)) {
          if (['UL', 'TABLE', 'DIV', 'P'].includes(sibling.tagName)) {
            const text = sibling.textContent.trim();
            if (text) {
              data.push({ section: 'Festival Programme', text });
            }
          } else if (sibling.children.length > 0) {
            Array.from(sibling.children).forEach(child => {
              const childText = child.textContent.trim();
              if (childText) {
                data.push({ section: 'Festival Programme', text: childText });
              }
            });
          }
        }
        sibling = sibling.nextElementSibling;
      }
      // Log raw HTML for Festival Programme Section
      console.log('Raw HTML for Festival Programme Section:', festivalProgrammeSection.outerHTML);
    }

    // Enhanced logic for Awards Section
    const awardsSection = Array.from(document.querySelectorAll('h2')).find(h2 => h2.textContent.includes('Awards'));
    if (awardsSection) {
      console.log('Processing Awards Section with refined logic for deeper content');
      let sibling = awardsSection.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2') {
        if (!['SPAN'].includes(sibling.tagName)) {
          if (['UL', 'TABLE', 'DIV', 'P'].includes(sibling.tagName)) {
            const text = sibling.textContent.trim();
            if (text) {
              data.push({ section: 'Awards', text });
            }
          } else if (sibling.children.length > 0) {
            Array.from(sibling.children).forEach(child => {
              const childText = child.textContent.trim();
              if (childText) {
                data.push({ section: 'Awards', text: childText });
              }
            });
          }
        }
        sibling = sibling.nextElementSibling;
      }
      // Log raw HTML for Awards Section
      console.log('Raw HTML for Awards Section:', awardsSection.outerHTML);
    }

    // Debugging: Log extracted data before saving
    console.log('Extracted Data:', JSON.stringify(data, null, 2));

    // Save data to JSON file
    fs.writeFileSync('data/source/berlin-wikipedia.json', JSON.stringify(data, null, 2));
    console.log('Data saved to data/source/berlin-wikipedia.json');
  } catch (error) {
    console.error('Error fetching Berlin Film Festival data:', error);
  }
}

fetchBerlinData();