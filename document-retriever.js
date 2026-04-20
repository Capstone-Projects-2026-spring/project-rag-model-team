import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_DIR = path.join(__dirname, 'sample-docs');

// Import OneDrive service
let onedriveServiceUser;
let tokenManager;
try {
  onedriveServiceUser = await import('./microsoft_api/onedriveServiceUser.js');
  tokenManager = await import('./microsoft_api/tokenManager.js');
} catch (err) {
  console.log('OneDrive service not available');
  onedriveServiceUser = null;
  tokenManager = null;
}

export async function retrieveDocumentFromOneDrive(query, slackUserId) {
  if (!onedriveServiceUser || !tokenManager) return null;
  
  try {
    const accessToken = await tokenManager.getValidAccessToken(slackUserId);
    const onedrive = new onedriveServiceUser.default(accessToken);
    const files = await onedrive.searchFiles(query);
    
    if (files.length > 0) {
      const file = files[0];
      return {
        id: file.id,
        name: file.name,
        source: 'onedrive',
        link: file.webUrl
      };
    }
  } catch (error) {
    console.error('Error retrieving from OneDrive:', error);
  }
  return null;
}

export function retrieveDocument(query) {
  try {
    const normalizedQuery = query.toLowerCase().trim();

    const files = fs.readdirSync(DOCS_DIR).filter(file => file.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(DOCS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const document = JSON.parse(content);

      if (
        document.name.toLowerCase().includes(normalizedQuery) ||
        document.id.toLowerCase().includes(normalizedQuery) ||
        normalizedQuery.includes(document.name.toLowerCase())
      ) {
        return document;
      }
    }

    return null;
  } catch (error) {
    console.error('Error retrieving document:', error);
    return null;
  }
}

export function listAllProjects() {
  try {
    const files = fs.readdirSync(DOCS_DIR).filter(file => file.endsWith('.json'));

    return files.map(file => {
      const filePath = path.join(DOCS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const document = JSON.parse(content);

      return {
        id: document.id,
        name: document.name,
        description: document.description
      };
    });
  } catch (error) {
    console.error('Error listing projects:', error);
    return [];
  }
}

export function formatDocumentForSlack(document) {
  if (!document) {
    return "Sorry, I couldn't find any documentation for that project. Try asking about 'Project Alpha', 'Project Beta', or 'Project Gamma'.";
  }

  const message = `
📄 *${document.name}*

*Description:*
${document.description}

*Tech Stack:*
${document.tech_stack.join(', ')}

*Repository:*
${document.repository}

*Setup Instructions:*
${document.setup_instructions}

*Key Contacts:*
• Tech Lead: ${document.key_contacts.tech_lead}
• Product Owner: ${document.key_contacts.product_owner}

*Documentation Links:*
${document.documentation_links.map(link => `• ${link}`).join('\n')}

*Onboarding Notes:*
${document.onboarding_notes}
  `.trim();

  return message;
}

export function searchDocuments(keywords) {
  try {
    const normalizedKeywords = keywords.toLowerCase().trim();
    const files = fs.readdirSync(DOCS_DIR).filter(file => file.endsWith('.json'));
    const matches = [];

    for (const file of files) {
      const filePath = path.join(DOCS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const document = JSON.parse(content);

      const searchableText = [
        document.name,
        document.description,
        document.tech_stack.join(' '),
        document.onboarding_notes
      ].join(' ').toLowerCase();

      if (searchableText.includes(normalizedKeywords)) {
        matches.push(document);
      }
    }

    return matches;
  } catch (error) {
    console.error('Error searching documents:', error);
    return [];
  }
}
